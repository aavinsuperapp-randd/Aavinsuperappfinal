// gm-bmcs.js — GM BMC Management (Full Form, Address Geocoding & Silo Management)

let allBmcs = [];
let editingBmcId = null;
let selectedFile = null;
let detectedLat = null;
let detectedLng = null;
let mapInstance = null;
let markersGroup = null;
let currentSilos = [];
let allRoutes = [];

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('bmc-grid')) return;

  const profile = await checkAuth('gm');
  if (!profile) return;

  if (document.getElementById('header-gm-name')) {
    document.getElementById('header-gm-name').textContent = profile.name || 'General Manager';
  }

  await loadRoutes();
  await loadBmcs();
  bindEvents();
});

// ── Load Routes ───────────────────────────────────────────────────────────────
async function loadRoutes() {
  try {
    let routes = [];
    try {
      const fetchFunc = typeof gmFetch === 'function' ? gmFetch : fetch;
      const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
      const token = window.localStorage.getItem('sb-access-token') || '';
      const res = await fetchFunc(`${baseUrl}/api/gm/routes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = typeof res.json === 'function' ? await res.json() : res;
      if (data && data.routes) routes = data.routes;
    } catch (apiErr) {
      console.warn('Backend route load failed, using direct Supabase fallback:', apiErr);
    }

    if (!routes || routes.length === 0) {
      const client = await initSupabase();
      if (client) {
        const { data } = await client.from('bmc_routes').select('*').order('name');
        if (data) routes = data;
      }
    }

    allRoutes = routes || [];
    
    // Populate filter dropdown
    const filterSelect = document.getElementById('bmc-filter-route');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="all">All Routes</option><option value="none">No Route</option>' + 
        allRoutes.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
    }
    
    // Populate modal dropdown
    const modalSelect = document.getElementById('bmc-route');
    if (modalSelect) {
      modalSelect.innerHTML = '<option value="">No Route</option>' + 
        allRoutes.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to load routes:', err);
  }
}

// ── Load All BMCs ─────────────────────────────────────────────────────────────
async function loadBmcs() {
  const grid = document.getElementById('bmc-grid');
  if (grid) {
    grid.innerHTML = `<div class="bmc-empty-state"><div class="bmc-empty-icon">⏳</div><div class="bmc-empty-title">Loading…</div></div>`;
  }

  try {
    const res = await apiGetGmBmcs();
    allBmcs = res.bmcs || [];
  } catch (err) {
    console.warn('Backend API load failed, trying direct database fetch:', err);
    const client = await initSupabase();
    if (client) {
      const { data, error } = await client
        .from('bmcs')
        .select('*, bmc_routes(id, name)')
        .order('created_at', { ascending: false });

      if (!error && data) {
        allBmcs = data;
        // Try fetching silos as well
        try {
          const { data: sData } = await client.from('bmc_silos').select('*').order('silo_number', { ascending: true });
          if (sData) {
            const sMap = {};
            sData.forEach(s => {
              if (!sMap[s.bmc_id]) sMap[s.bmc_id] = [];
              sMap[s.bmc_id].push(s);
            });
            allBmcs.forEach(b => { b.silos = sMap[b.id] || []; });
          }
        } catch (e) {}
      } else {
        if (typeof showToast === 'function') showToast('Failed to load BMCs: ' + (error?.message || err.message), 'error');
        allBmcs = [];
      }
    } else {
      if (typeof showToast === 'function') showToast('Database offline.', 'error');
      allBmcs = [];
    }
  }

  renderStats();
  renderMap(allBmcs);
  applyFilters();
}

// ── Render Stats ──────────────────────────────────────────────────────────────
function renderStats() {
  const total = allBmcs.length;
  const active = allBmcs.filter(b => b.is_active !== false).length;

  const totalEl = document.getElementById('stat-total');
  const activeEl = document.getElementById('stat-active');
  const inactiveEl = document.getElementById('stat-inactive');

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (inactiveEl) inactiveEl.textContent = total - active;
}

// ── Render Leaflet Map ────────────────────────────────────────────────────────
function renderMap(list) {
  const mapEl = document.getElementById('bmc-leaflet-map');
  if (!mapEl || typeof L === 'undefined') return;

  if (!mapInstance) {
    mapInstance = L.map('bmc-leaflet-map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([11.1271, 78.6569], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance);

    markersGroup = L.layerGroup().addTo(mapInstance);
  } else {
    markersGroup.clearLayers();
  }

  const validMarkers = [];

  list.forEach(bmc => {
    const lat = parseFloat(bmc.latitude);
    const lng = parseFloat(bmc.longitude);

    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      const marker = L.marker([lat, lng]);

      const statusBadge = bmc.is_active !== false
        ? `<span class="bmc-status-badge bmc-status-active">● Active</span>`
        : `<span class="bmc-status-badge bmc-status-inactive">● Inactive</span>`;

      const capacityKg = bmc.total_capacity ? Number(bmc.total_capacity).toLocaleString() + ' KG' : '—';
      const siloCount = bmc.silos ? bmc.silos.length : 0;

      const popupContent = `
        <div style="font-family: inherit; min-width: 180px; padding: 2px;">
          <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; font-weight: 700; color: #0f172a;">${escHtml(bmc.name)}</h4>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">🗺️ <b>District:</b> ${escHtml(bmc.district)}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">📍 <b>Location:</b> ${escHtml(bmc.location)}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">📞 <b>Contact:</b> ${escHtml(bmc.contact_number || '—')}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">🏋️ <b>Capacity:</b> ${capacityKg}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 6px;">🛢️ <b>Silos:</b> ${siloCount} Silos</div>
          <div>${statusBadge}</div>
        </div>
      `;

      marker.bindPopup(popupContent);
      markersGroup.addLayer(marker);
      validMarkers.push(marker);
    }
  });

  if (validMarkers.length > 0) {
    const group = L.featureGroup(validMarkers);
    if (validMarkers.length === 1) {
      mapInstance.setView(validMarkers[0].getLatLng(), 13);
    } else {
      mapInstance.fitBounds(group.getBounds().pad(0.15));
    }
  } else {
    mapInstance.setView([11.1271, 78.6569], 7);
  }

  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 300);
}

function getRouteName(bmc) {
  if (bmc.bmc_routes && bmc.bmc_routes.name) return bmc.bmc_routes.name;
  if (bmc.route_name) return bmc.route_name;
  if (bmc.route_id && Array.isArray(allRoutes) && allRoutes.length > 0) {
    const found = allRoutes.find(r => String(r.id) === String(bmc.route_id));
    if (found) return found.name;
  }
  return 'Unassigned Route';
}

// ── Render Grid ───────────────────────────────────────────────────────────────
function renderGrid(list) {
  const grid = document.getElementById('bmc-grid');
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = `
      <div class="bmc-empty-state" style="grid-column: 1 / -1;">
        <div class="bmc-empty-icon">🏭</div>
        <div class="bmc-empty-title">No BMCs found</div>
        <div class="bmc-empty-desc">Click "Add New BMC" to register a Bulk Milk Cooler or adjust filters.</div>
      </div>`;
    return;
  }

  // Group BMCs by route name
  const groups = {};
  list.forEach(bmc => {
    const rName = getRouteName(bmc);
    if (!groups[rName]) groups[rName] = [];
    groups[rName].push(bmc);
  });

  let html = '';
  const groupNames = Object.keys(groups);

  groupNames.forEach((rName, groupIdx) => {
    const groupBmcs = groups[rName];
    html += `
      <div class="bmc-route-group-header" style="grid-column: 1 / -1; margin-top: ${groupIdx === 0 ? '0' : '20px'}; margin-bottom: 8px; padding: 10px 16px; background: linear-gradient(135deg, #1e293b, #334155); color: #ffffff; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.06);">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.1rem;">🛣️</span>
          <span style="font-size:1rem; letter-spacing:0.3px;">${escHtml(rName)}</span>
        </div>
        <span style="background: rgba(255,255,255,0.2); font-size: 0.78rem; padding: 3px 10px; border-radius: 20px; font-weight: 600;">
          ${groupBmcs.length} BMC${groupBmcs.length !== 1 ? 's' : ''}
        </span>
      </div>
    `;

    html += groupBmcs.map(bmc => {
      const capacityKg = bmc.total_capacity ? Number(bmc.total_capacity).toLocaleString() + ' KG' : '—';
      const siloCount = bmc.silos ? bmc.silos.length : 0;

      return `
      <div class="bmc-card ${bmc.is_active === false ? 'inactive-card' : ''}">
        ${bmc.profile_image_url
          ? `<img src="${escHtml(bmc.profile_image_url)}" class="bmc-card-image" alt="${escHtml(bmc.name)}">`
          : `<div class="bmc-card-image-placeholder">🏭</div>`}
        <div class="bmc-card-body">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:4px;">
            <div class="bmc-card-title">${escHtml(bmc.name)}</div>
            ${bmc.bmc_code ? `<span style="font-size:0.75rem; background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:600; white-space:nowrap;">Code: ${escHtml(bmc.bmc_code)}</span>` : ''}
          </div>
          <div class="bmc-card-meta">
            <div class="bmc-card-meta-item" style="color:#0284c7; font-weight:600;"><span>🛣️</span>${escHtml(rName)}</div>
            <div class="bmc-card-meta-item"><span>🗺️</span>${escHtml(bmc.district)}</div>
            <div class="bmc-card-meta-item"><span>📍</span>${escHtml(bmc.location)}</div>
            <div class="bmc-card-meta-item"><span>📞</span>${escHtml(bmc.contact_number)}</div>
            <div class="bmc-card-meta-item"><span>🏋️</span>Capacity: <b>${capacityKg}</b> | 🛢️ <b>${siloCount}</b> Silo${siloCount !== 1 ? 's' : ''}</div>
            ${bmc.latitude ? `<div class="bmc-card-meta-item"><span>🛰️</span>${Number(bmc.latitude).toFixed(5)}, ${Number(bmc.longitude).toFixed(5)}</div>` : ''}
          </div>
          <div class="bmc-card-status">
            <span class="bmc-status-badge ${bmc.is_active !== false ? 'bmc-status-active' : 'bmc-status-inactive'}">
              ${bmc.is_active !== false ? '● Active' : '● Inactive'}
            </span>
          </div>
        </div>
        <div class="bmc-card-actions">
          <button class="btn btn-outline btn-sm" onclick="openEditModal('${bmc.id || bmc.bmc_code}')" style="flex:1;">✏️ Edit</button>
          <button class="btn btn-sm ${bmc.is_active !== false ? 'btn-danger' : 'btn-primary'}" onclick="toggleBmcStatus('${bmc.id || bmc.bmc_code}', ${bmc.is_active !== false})" style="flex:1;">
            ${bmc.is_active !== false ? '⏹ Deactivate' : '▶ Activate'}
          </button>
          <button class="btn btn-sm" onclick="deleteBmc('${bmc.id || bmc.bmc_code}')" style="background:#FEE2E2; border-color:#FCA5A5; color:#DC2626; font-weight:700; padding:0 12px;" title="Delete BMC">🗑️ Delete</button>
        </div>
      </div>
    `;
    }).join('');
  });

  grid.innerHTML = html;
}

// ── Silo Management Functions ─────────────────────────────────────────────────
function renderSilos() {
  const container = document.getElementById('silo-list-container');
  const countLabel = document.getElementById('total-silos-count-label');
  if (!container) return;

  if (countLabel) {
    countLabel.textContent = `Total Silos: ${currentSilos.length} (Max 10)`;
  }

  if (currentSilos.length === 0) {
    container.innerHTML = `
      <div class="text-xs text-muted text-center" style="padding: 12px; background: var(--gray-50); border: 1px dashed var(--gray-200); border-radius: 6px;">
        No silos added yet. Click "+ Add Silo" above to register silos.
      </div>
    `;
    return;
  }

  container.innerHTML = currentSilos.map((silo, idx) => {
    const siloNum = idx + 1;
    silo.silo_number = siloNum;
    silo.silo_name = `Silo ${siloNum}`;

    return `
      <div class="silo-card" data-index="${idx}">
        <span class="silo-badge">Silo ${siloNum}</span>
        <div class="silo-capacity-wrapper">
          <input 
            type="number" 
            class="form-input silo-capacity-input" 
            data-index="${idx}" 
            value="${silo.capacity_kg !== undefined && silo.capacity_kg !== null ? silo.capacity_kg : ''}" 
            placeholder="Capacity in KG (e.g. 1000)" 
            min="1" 
            step="any"
            oninput="updateSiloCapacity(${idx}, this.value)"
          >
          <span class="text-xs text-muted font-bold">KG</span>
        </div>
        <button type="button" class="silo-delete-btn" onclick="removeSilo(${idx})" title="Delete Silo ${siloNum}">
          🗑️ Remove
        </button>
      </div>
    `;
  }).join('');

  recalculateTotalCapacityFromSilos();
}

window.addSilo = function() {
  if (currentSilos.length >= 10) {
    if (typeof showToast === 'function') showToast('Maximum 10 silos allowed per BMC.', 'warning');
    return;
  }
  const nextNum = currentSilos.length + 1;
  currentSilos.push({
    silo_number: nextNum,
    silo_name: `Silo ${nextNum}`,
    capacity_kg: ''
  });
  renderSilos();
};

window.removeSilo = function(idx) {
  if (idx >= 0 && idx < currentSilos.length) {
    currentSilos.splice(idx, 1);
    // Automatic re-numbering
    currentSilos.forEach((s, i) => {
      s.silo_number = i + 1;
      s.silo_name = `Silo ${i + 1}`;
    });
    renderSilos();
  }
};

window.updateSiloCapacity = function(idx, value) {
  if (idx >= 0 && idx < currentSilos.length) {
    currentSilos[idx].capacity_kg = value;
    recalculateTotalCapacityFromSilos();
  }
};

function recalculateTotalCapacityFromSilos() {
  const capInput = document.getElementById('bmc-capacity');
  if (!capInput) return;

  let sum = 0;
  let hasValid = false;
  currentSilos.forEach(s => {
    const val = parseFloat(s.capacity_kg);
    if (!isNaN(val) && val > 0) {
      sum += val;
      hasValid = true;
    }
  });

  if (hasValid && (!capInput.value || capInput.getAttribute('data-auto') === 'true')) {
    capInput.value = sum;
    capInput.setAttribute('data-auto', 'true');
  }
}



// ── Delete BMC ────────────────────────────────────────────────────────────────
window.deleteBmc = async function(id) {
  if (!id) return;
  const bmcRecord = (typeof allBmcs !== 'undefined' ? allBmcs : []).find(b => String(b.id) === String(id) || String(b.bmc_code) === String(id));
  const bmcName = bmcRecord ? bmcRecord.name : id;

  if (!confirm(`Are you sure you want to delete BMC "${bmcName}"?`)) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    let deletedSuccess = false;
    let errorMsg = '';

    // Attempt backend API deletion
    try {
      if (typeof gmFetch === 'function') {
        await gmFetch(`/api/gm/bmcs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        deletedSuccess = true;
      } else {
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
        const token = window.localStorage.getItem('sb-access-token') || '';
        const res = await fetch(`${baseUrl}/api/gm/bmcs/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          deletedSuccess = true;
        } else {
          const json = await res.json().catch(() => ({}));
          errorMsg = json.error || `Server status ${res.status}`;
        }
      }
    } catch (apiErr) {
      console.warn('[deleteBmc] Backend API failed, trying direct Supabase fallback:', apiErr);
      errorMsg = apiErr.message;
    }

    // Direct Supabase fallback if backend deletion failed
    if (!deletedSuccess) {
      const client = await initSupabase();
      if (!client) throw new Error(errorMsg || 'Database offline.');

      const targetId = bmcRecord?.id || (id.includes('-') ? id : null);
      const targetCode = bmcRecord?.bmc_code || id;

      if (targetId) {
        await client.from('bmc_silos').delete().eq('bmc_id', targetId);
        await client.from('eo_bmc_assignments').delete().eq('bmc_id', targetId);
        await client.from('bmc_issues').delete().eq('bmc_id', targetId);
        await client.from('bmc_requirements').delete().eq('bmc_id', targetId);
        
        try {
          await client.from('driver_trips').delete().eq('bmc_id', targetId);
          await client.from('trips').delete().eq('bmc_id', targetId);
          await client.from('qc_excel_import_rows').delete().eq('bmc_id', targetId);
        } catch(e) {}
        
        try {
          const { data: visits } = await client.from('trip_bmc_visits').select('id').eq('bmc_id', targetId);
          if (visits && visits.length > 0) {
            const vIds = visits.map(v => v.id);
            await client.from('bmc_issues').delete().in('visit_id', vIds);
            await client.from('bmc_ratings').delete().in('visit_id', vIds);
            await client.from('requirement_checks').delete().in('visit_id', vIds);
            await client.from('ftir_tests').delete().in('visit_id', vIds);
            await client.from('gerber_tests').delete().in('visit_id', vIds);
            await client.from('trip_bmc_visits').delete().in('id', vIds);
          }
        } catch (vErr) {
          console.warn('Fallback visit cleanup error:', vErr);
        }
      }
      if (targetCode) {
        await client.from('bmc_issues').delete().eq('bmc_code', targetCode);
        await client.from('bmc_requirements').delete().eq('bmc_code', targetCode);
      }

      let deleteRes = null;
      if (targetId) {
        deleteRes = await client.from('bmcs').delete().eq('id', targetId);
      } else if (targetCode) {
        deleteRes = await client.from('bmcs').delete().eq('bmc_code', targetCode);
      } else {
        throw new Error('No valid BMC ID or Code found to delete.');
      }

      if (deleteRes && deleteRes.error) throw deleteRes.error;
      deletedSuccess = true;
    }

    if (typeof showToast === 'function') showToast(`BMC "${bmcName}" deleted successfully`, 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to delete BMC', 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
};

// ── Filter / Search ───────────────────────────────────────────────────────────
function applyFilters() {
  const searchEl = document.getElementById('bmc-search');
  const statusEl = document.getElementById('bmc-filter-status');

  const q = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const status = statusEl ? statusEl.value : 'all';
  const routeEl = document.getElementById('bmc-filter-route');
  const routeId = routeEl ? routeEl.value : 'all';

  let list = [...allBmcs];
  if (q) {
    list = list.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.district || '').toLowerCase().includes(q) ||
      (b.location || '').toLowerCase().includes(q)
    );
  }
  if (status === 'active') list = list.filter(b => b.is_active !== false);
  if (status === 'inactive') list = list.filter(b => b.is_active === false);
  
  if (routeId === 'none') {
    list = list.filter(b => !b.route_id);
  } else if (routeId !== 'all') {
    list = list.filter(b => b.route_id === routeId);
  }

  renderGrid(list);
}

// ── Bind Events ───────────────────────────────────────────────────────────────
function bindEvents() {
  const addBtn = document.getElementById('add-bmc-btn');
  if (addBtn) addBtn.addEventListener('click', openAddModal);

  const modalClose = document.getElementById('bmc-modal-close');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  const cancelBtn = document.getElementById('bmc-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  const saveBtn = document.getElementById('bmc-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveBmc);

  const detectBtn = document.getElementById('detect-location-btn');
  if (detectBtn) detectBtn.addEventListener('click', detectLocation);

  const addSiloBtn = document.getElementById('add-silo-btn');
  if (addSiloBtn) addSiloBtn.addEventListener('click', window.addSilo);

  const searchInput = document.getElementById('bmc-search');
  if (searchInput) searchInput.addEventListener('input', applyFilters);

  const filterStatus = document.getElementById('bmc-filter-status');
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  
  const filterRoute = document.getElementById('bmc-filter-route');
  if (filterRoute) filterRoute.addEventListener('change', applyFilters);
  
  const addRouteBtn = document.getElementById('add-route-btn');
  if (addRouteBtn) {
    addRouteBtn.addEventListener('click', async () => {
      const name = prompt('Enter new route name:');
      if (name && name.trim()) {
        const routeName = name.trim();
        try {
          let newRoute = null;
          try {
            const fetchFunc = typeof gmFetch === 'function' ? gmFetch : fetch;
            const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
            const token = window.localStorage.getItem('sb-access-token') || '';
            const res = await fetchFunc(`${baseUrl}/api/gm/routes`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ name: routeName })
            });
            const data = typeof res.json === 'function' ? await res.json() : res;
            if (data && data.route) newRoute = data.route;
          } catch (apiErr) {
            console.warn('API add route failed, trying direct Supabase fallback:', apiErr);
          }

          if (!newRoute) {
            const client = await initSupabase();
            if (client) {
              const { data, error } = await client.from('bmc_routes').insert({ name: routeName }).select().single();
              if (error) throw error;
              newRoute = data;
            }
          }

          if (newRoute) {
            await loadRoutes();
            const modalSelect = document.getElementById('bmc-route');
            if (modalSelect) modalSelect.value = newRoute.id;
            if (typeof showToast === 'function') showToast('Route added successfully', 'success');
          } else {
            throw new Error('Failed to create route');
          }
        } catch (err) {
          console.error('Add route error:', err);
          if (typeof showToast === 'function') showToast(err.message || 'Failed to add route', 'error');
        }
      }
    });
  }

  const capInput = document.getElementById('bmc-capacity');
  if (capInput) {
    capInput.addEventListener('input', () => {
      capInput.removeAttribute('data-auto');
    });
  }

  // Image upload zone
  const imageZone = document.getElementById('bmc-image-drop');
  const imageInput = document.getElementById('bmc-image-input');
  if (imageZone && imageInput) {
    imageZone.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', e => handleImageSelect(e.target.files[0]));
  }

  const modalOverlay = document.getElementById('bmc-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  window.addEventListener('resize', () => {
    if (mapInstance) mapInstance.invalidateSize();
  });
}

// ── Image Select ──────────────────────────────────────────────────────────────
function handleImageSelect(file) {
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('bmc-preview-img');
    if (img) {
      img.src = e.target.result;
      img.classList.remove('hidden');
    }
    const placeholder = document.getElementById('bmc-image-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ── Location Detection ────────────────────────────────────────────────────────
function detectLocation() {
  const btn = document.getElementById('detect-location-btn');
  const status = document.getElementById('location-status');

  if (!navigator.geolocation) {
    if (status) status.textContent = '❌ Geolocation not supported by your browser.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '📡 Detecting…';
  }
  if (status) status.textContent = 'Requesting device location permission…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      detectedLat = pos.coords.latitude;
      detectedLng = pos.coords.longitude;

      document.getElementById('bmc-latitude').value = detectedLat;
      document.getElementById('bmc-longitude').value = detectedLng;

      if (status) status.textContent = `✅ Location detected: ${detectedLat.toFixed(5)}, ${detectedLng.toFixed(5)}`;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📡 Re-detect Location';
      }
      if (typeof showToast === 'function') showToast('Device location detected successfully.', 'success');
    },
    err => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📡 Detect My Location';
      }
      const msgs = {
        1: 'Permission denied. Allow location access in browser.',
        2: 'Position unavailable.',
        3: 'Request timed out.'
      };
      if (status) status.textContent = '❌ ' + (msgs[err.code] || 'Unknown error.');
      if (typeof showToast === 'function') showToast('Location detection failed: ' + (msgs[err.code] || 'Error'), 'error');
    },
    { timeout: 12000, maximumAge: 0 }
  );
}

// ── Open Add Modal ────────────────────────────────────────────────────────────
function openAddModal() {
  editingBmcId = null;
  selectedFile = null;
  detectedLat = null;
  detectedLng = null;
  currentSilos = [
    { silo_number: 1, silo_name: 'Silo 1', capacity_kg: '' }
  ];

  document.getElementById('bmc-modal-title').textContent = 'Add New BMC';
  
  const routeEl = document.getElementById('bmc-route');
  if (routeEl) routeEl.value = '';
  
  document.getElementById('bmc-code').value = '';
  document.getElementById('bmc-name').value = '';
  document.getElementById('bmc-district').value = '';
  document.getElementById('bmc-contact').value = '';
  document.getElementById('bmc-capacity').value = '';
  document.getElementById('bmc-capacity').setAttribute('data-auto', 'true');
  document.getElementById('bmc-location-text').value = '';
  document.getElementById('bmc-latitude').value = '';
  document.getElementById('bmc-longitude').value = '';

  document.getElementById('location-status').textContent = '';

  const detectBtn = document.getElementById('detect-location-btn');
  if (detectBtn) {
    detectBtn.textContent = '📡 Detect My Location';
    detectBtn.disabled = false;
  }

  const img = document.getElementById('bmc-preview-img');
  if (img) {
    img.src = '';
    img.classList.add('hidden');
  }
  const placeholder = document.getElementById('bmc-image-placeholder');
  if (placeholder) placeholder.style.display = '';

  const imageInput = document.getElementById('bmc-image-input');
  if (imageInput) imageInput.value = '';

  renderSilos();
  document.getElementById('bmc-modal').classList.remove('hidden');
}

// ── Open Edit Modal ───────────────────────────────────────────────────────────
window.openEditModal = function(code) {
  const bmc = allBmcs.find(b => String(b.bmc_code) === String(code) || String(b.id) === String(code));
  if (!bmc) return;

  editingBmcId = bmc.id || bmc.bmc_code || code;
  selectedFile = null;
  detectedLat = bmc.latitude || null;
  detectedLng = bmc.longitude || null;

  // Load existing silos or initialize default if none exist
  if (Array.isArray(bmc.silos) && bmc.silos.length > 0) {
    currentSilos = bmc.silos.map(s => ({
      id: s.id,
      silo_number: s.silo_number,
      silo_name: s.silo_name || `Silo ${s.silo_number}`,
      capacity_kg: s.capacity_kg
    }));
  } else {
    currentSilos = [];
  }

  document.getElementById('bmc-modal-title').textContent = 'Edit BMC';
  
  const routeEl = document.getElementById('bmc-route');
  if (routeEl) routeEl.value = bmc.route_id || '';

  document.getElementById('bmc-code').value = bmc.bmc_code || '';
  document.getElementById('bmc-name').value = bmc.name || '';
  document.getElementById('bmc-district').value = bmc.district || '';
  document.getElementById('bmc-contact').value = bmc.contact_number || '';
  document.getElementById('bmc-capacity').value = bmc.total_capacity !== undefined && bmc.total_capacity !== null ? bmc.total_capacity : '';
  document.getElementById('bmc-capacity').removeAttribute('data-auto');
  document.getElementById('bmc-location-text').value = bmc.location || '';
  document.getElementById('bmc-latitude').value = bmc.latitude !== undefined && bmc.latitude !== null ? bmc.latitude : '';
  document.getElementById('bmc-longitude').value = bmc.longitude !== undefined && bmc.longitude !== null ? bmc.longitude : '';

  const statusText = document.getElementById('location-status');
  if (statusText) statusText.textContent = bmc.latitude ? `✅ Coordinates: ${bmc.latitude}, ${bmc.longitude}` : '';

  // Image preview
  const img = document.getElementById('bmc-preview-img');
  const placeholder = document.getElementById('bmc-image-placeholder');
  if (bmc.profile_image_url) {
    if (img) {
      img.src = bmc.profile_image_url;
      img.classList.remove('hidden');
    }
    if (placeholder) placeholder.style.display = 'none';
  } else {
    if (img) {
      img.src = '';
      img.classList.add('hidden');
    }
    if (placeholder) placeholder.style.display = '';
  }

  const imageInput = document.getElementById('bmc-image-input');
  if (imageInput) imageInput.value = '';

  renderSilos();
  document.getElementById('bmc-modal').classList.remove('hidden');
};

function closeModal() {
  document.getElementById('bmc-modal').classList.add('hidden');
}

// ── Save BMC ──────────────────────────────────────────────────────────────────
async function saveBmc() {
  const saveBtn = document.getElementById('bmc-save-btn');
  const bmc_code = document.getElementById('bmc-code').value.trim();
  const name = document.getElementById('bmc-name').value.trim();
  const district = document.getElementById('bmc-district').value.trim();
  const contact = document.getElementById('bmc-contact').value.trim();
  const capacityStr = document.getElementById('bmc-capacity').value.trim();
  const location = document.getElementById('bmc-location-text').value.trim();
  const latStr = document.getElementById('bmc-latitude').value.trim();
  const lngStr = document.getElementById('bmc-longitude').value.trim();
  
  const routeEl = document.getElementById('bmc-route');
  const route_id = routeEl ? routeEl.value : null;

  console.log('[saveBmc] Starting save. Values:', { name, district, contact, capacityStr, location, latStr, lngStr, route_id });
  console.log('[saveBmc] currentSilos:', JSON.stringify(currentSilos));

  // Validation
  if (!name) { if (typeof showToast === 'function') showToast('BMC Name is required.', 'error'); return; }
  if (!district) { if (typeof showToast === 'function') showToast('District is required.', 'error'); return; }
  if (!contact) { if (typeof showToast === 'function') showToast('Contact number is required.', 'error'); return; }
  const cleanContact = contact.replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d{7,15}$/.test(cleanContact)) { if (typeof showToast === 'function') showToast('Please enter a valid phone number (7-15 digits).', 'error'); return; }
  if (!capacityStr || isNaN(capacityStr) || parseFloat(capacityStr) <= 0) { if (typeof showToast === 'function') showToast('Total BMC capacity must be a positive number in KG.', 'error'); return; }
  if (!location) { if (typeof showToast === 'function') showToast('Address Reference is required.', 'error'); return; }
  if (!bmc_code || !name || !district || !contact || !latStr || !lngStr) {
    if (typeof showToast === 'function') showToast('Please fill all required fields, including BMC Code and location.', 'error');
    return;
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { if (typeof showToast === 'function') showToast('Latitude must be -90 to 90, Longitude -180 to 180.', 'error'); return; }

  // Validate silos
  for (let i = 0; i < currentSilos.length; i++) {
    const sCap = parseFloat(currentSilos[i].capacity_kg);
    if (currentSilos[i].capacity_kg === '' || currentSilos[i].capacity_kg === undefined || isNaN(sCap) || sCap <= 0) {
      if (typeof showToast === 'function') showToast(`Silo ${i + 1} capacity must be a valid positive number.`, 'error');
      return;
    }
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    let imageUrl = editingBmcId ? (allBmcs.find(b => b.id === editingBmcId)?.profile_image_url || null) : null;

    if (selectedFile) {
      imageUrl = await getOptimizedBase64(selectedFile);
    }

    const payload = {
      bmc_code,
      name,
      district,
      location,
      contact_number: contact,
      latitude: lat,
      longitude: lng,
      total_capacity: parseFloat(capacityStr),
      profile_image_url: imageUrl,
      route_id: route_id,
      silos: currentSilos.map((s, idx) => ({
        id: s.id || undefined,
        silo_number: idx + 1,
        silo_name: `Silo ${idx + 1}`,
        capacity_kg: parseFloat(s.capacity_kg)
      }))
    };

    console.log('[saveBmc] Payload being sent:', JSON.stringify(payload));

    if (editingBmcId) {
      try {
        await apiGmUpdateBmc(editingBmcId, payload);
        console.log('[saveBmc] Updated via GM API successfully.');
      } catch (apiErr) {
        console.warn('[saveBmc] Backend PUT failed, falling back to direct Supabase update:', apiErr.message);
        const client = await initSupabase();
        if (!client) throw apiErr;

        const bmcUpdatePayload = {
          bmc_code: payload.bmc_code,
          name: payload.name,
          district: payload.district,
          location: payload.location,
          contact_number: payload.contact_number,
          latitude: payload.latitude,
          longitude: payload.longitude,
          profile_image_url: payload.profile_image_url,
          total_capacity: payload.total_capacity,
          route_id: payload.route_id
        };

        // Note: Do NOT use .single() on .update() to avoid HTTP 406 error
        const { error: updateErr } = await client
          .from('bmcs')
          .update(bmcUpdatePayload)
          .eq('id', editingBmcId)
          .select();

        if (updateErr) {
          console.error('[saveBmc] Direct Supabase update error:', updateErr);
          throw updateErr;
        }

        // Sync Silos
        if (Array.isArray(payload.silos)) {
          try {
            await client.from('bmc_silos').delete().eq('bmc_id', editingBmcId);
            if (payload.silos.length > 0) {
              const silosToInsert = payload.silos.map((s, idx) => ({
                bmc_id: editingBmcId,
                silo_number: idx + 1,
                silo_name: `Silo ${idx + 1}`,
                capacity_kg: parseFloat(s.capacity_kg) || 0
              }));
              await client.from('bmc_silos').insert(silosToInsert);
            }
          } catch (sErr) {
            console.warn('[saveBmc] Silo sync fallback warning:', sErr.message);
          }
        }
      }
      if (typeof showToast === 'function') showToast('BMC record updated successfully!', 'success');
    } else {
      try {
        await apiGmCreateBmc(payload);
        console.log('[saveBmc] Created via GM API successfully.');
      } catch (apiErr) {
        console.warn('[saveBmc] Backend POST failed, falling back to direct Supabase insert:', apiErr.message);
        const client = await initSupabase();
        if (!client) throw apiErr;

        const bmcInsertPayload = {
          bmc_code: payload.bmc_code,
          name: payload.name,
          district: payload.district,
          location: payload.location,
          contact_number: payload.contact_number,
          latitude: payload.latitude,
          longitude: payload.longitude,
          profile_image_url: payload.profile_image_url,
          total_capacity: payload.total_capacity,
          route_id: payload.route_id,
          is_active: true
        };

        const { data: insertedBmc, error: insertErr } = await client
          .from('bmcs')
          .insert(bmcInsertPayload)
          .select();

        if (insertErr) throw insertErr;

        const newId = insertedBmc && insertedBmc[0] ? insertedBmc[0].id : null;
        if (newId && Array.isArray(payload.silos) && payload.silos.length > 0) {
          try {
            const silosToInsert = payload.silos.map((s, idx) => ({
              bmc_id: newId,
              silo_number: idx + 1,
              silo_name: `Silo ${idx + 1}`,
              capacity_kg: parseFloat(s.capacity_kg) || 0
            }));
            await client.from('bmc_silos').insert(silosToInsert);
          } catch (sErr) {
            console.warn('[saveBmc] Silo insert fallback warning:', sErr.message);
          }
        }
      }
      if (typeof showToast === 'function') showToast('BMC record created successfully!', 'success');
    }

    closeModal();
    await loadBmcs();

  } catch (err) {
    console.error('[saveBmc] ❌ Fatal error:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to save BMC.', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save BMC'; }
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}




// ── Toggle Active Status ──────────────────────────────────────────────────────
window.toggleBmcStatus = async function(id, currentlyActive) {
  if (!id) return;
  const bmcRecord = (typeof allBmcs !== 'undefined' ? allBmcs : []).find(b => String(b.id) === String(id) || String(b.bmc_code) === String(id));
  const isCurrentlyActive = bmcRecord ? (bmcRecord.is_active !== false) : Boolean(currentlyActive);
  const action = isCurrentlyActive ? 'deactivate' : 'activate';
  const newStatus = !isCurrentlyActive;

  if (!confirm(`Are you sure you want to ${action} this BMC?`)) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    let success = false;
    let errorMsg = '';

    try {
      if (typeof gmFetch === 'function') {
        await gmFetch(`/api/gm/bmcs/${encodeURIComponent(id)}/toggle`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: newStatus })
        });
        success = true;
      } else {
        const token = window.localStorage.getItem('sb-access-token') || '';
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
        const res = await fetch(`${baseUrl}/api/gm/bmcs/${encodeURIComponent(id)}/toggle`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ is_active: newStatus })
        });
        if (res.ok) success = true;
      }
    } catch (fetchErr) {
      console.warn('[toggleBmcStatus] API toggle failed, trying direct Supabase fallback:', fetchErr);
      errorMsg = fetchErr.message;
    }

    if (!success) {
      const client = await initSupabase();
      if (!client) throw new Error(errorMsg || 'Database offline.');

      const targetId = bmcRecord?.id || (id.includes('-') ? id : null);
      const targetCode = bmcRecord?.bmc_code || id;

      let updateRes = null;
      if (targetId) {
        updateRes = await client.from('bmcs').update({ is_active: newStatus, updated_at: new Date() }).eq('id', targetId);
      } else if (targetCode) {
        updateRes = await client.from('bmcs').update({ is_active: newStatus, updated_at: new Date() }).eq('bmc_code', targetCode);
      } else {
        throw new Error('No valid BMC ID or Code found to update.');
      }

      if (updateRes && updateRes.error) throw updateRes.error;
      success = true;
    }

    if (typeof showToast === 'function') showToast(`BMC ${action}d successfully.`, 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast('Failed: ' + (err.message || 'Failed to update status'), 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
};

// ── Utility ───────────────────────────────────────────────────────────────────
function getOptimizedBase64(file, maxWidth = 800, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
