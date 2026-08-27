// bmc-admin.js — Admin BMC Management (Add / Edit / Toggle / View)

let allBmcs = [];
let editingBmcId = null;
let selectedFile = null;
let detectedLat = null;
let detectedLng = null;
let allRoutes = [];

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Only run on bmc.html
  if (!document.getElementById('bmc-grid')) return;

  // Auth guard — must be admin
  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  await loadRoutes();
  await loadBmcs();
  bindEvents();
});

// ── Load Routes ───────────────────────────────────────────────────────────────
async function loadRoutes() {
  try {
    let routes = [];
    try {
      const fetchFunc = typeof adminFetch === 'function' ? adminFetch : fetch;
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
    
    const filterSelect = document.getElementById('bmc-filter-route');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="all">All Routes</option><option value="none">No Route</option>' + 
        allRoutes.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
    }
    
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
  grid.innerHTML = `<div class="bmc-empty-state"><div class="bmc-empty-icon">⏳</div><div class="bmc-empty-title">Loading…</div></div>`;

  const client = await initSupabase();
  if (!client) { showToast('Database offline.', 'error'); return; }

  const { data, error } = await client
    .from('bmcs')
    .select('*, bmc_routes(id, name)')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load BMCs: ' + error.message, 'error');
    return;
  }

  allBmcs = data || [];
  renderStats();
  renderGrid(allBmcs);
}

// ── Render Stats ──────────────────────────────────────────────────────────────
function renderStats() {
  const total = allBmcs.length;
  const active = allBmcs.filter(b => b.is_active).length;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-inactive').textContent = total - active;
}

// ── Render Grid ───────────────────────────────────────────────────────────────
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
        <div class="bmc-empty-desc">Click "Add New BMC" to register the first Bulk Milk Cooler.</div>
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

    html += groupBmcs.map(bmc => `
      <div class="bmc-card ${!bmc.is_active ? 'inactive-card' : ''}">
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
            ${bmc.latitude ? `<div class="bmc-card-meta-item"><span>🛰️</span>${Number(bmc.latitude).toFixed(5)}, ${Number(bmc.longitude).toFixed(5)}</div>` : ''}
          </div>
          <div class="bmc-card-status">
            <span class="bmc-status-badge ${bmc.is_active ? 'bmc-status-active' : 'bmc-status-inactive'}">
              ${bmc.is_active ? '● Active' : '● Inactive'}
            </span>
          </div>
        </div>
        <div class="bmc-card-actions">
          <button class="btn btn-outline btn-sm" onclick="openEditModal('${bmc.id || bmc.bmc_code}')" style="flex:1;">✏️ Edit</button>
          <button class="btn btn-sm ${bmc.is_active ? 'btn-danger' : 'btn-primary'}" onclick="toggleBmcStatus('${bmc.id || bmc.bmc_code}', ${bmc.is_active})" style="flex:1;">
            ${bmc.is_active ? '⏹ Deactivate' : '▶ Activate'}
          </button>
          <button class="btn btn-sm" onclick="deleteBmc('${bmc.id || bmc.bmc_code}')" style="background:#FEE2E2; border-color:#FCA5A5; color:#DC2626; font-weight:700; flex:0.4; display:flex; justify-content:center; align-items:center;" title="Delete BMC">🗑️</button>
        </div>
      </div>
    `).join('');
  });

  grid.innerHTML = html;
}

window.deleteBmc = async function(id) {
  if (!confirm('Are you sure you want to delete this BMC record?')) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    let deletedSuccess = false;
    let errorMsg = '';

    try {
      if (typeof adminFetch === 'function') {
        await adminFetch(`/api/admin/bmcs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        deletedSuccess = true;
      } else {
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';
        const token = window.localStorage.getItem('sb-access-token') || '';
        const res = await fetch(`${baseUrl}/api/admin/bmcs/${encodeURIComponent(id)}`, {
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
      console.warn('[deleteBmc] Backend API delete failed, using direct Supabase fallback:', apiErr);
      errorMsg = apiErr.message;
    }

    if (!deletedSuccess) {
      const client = await initSupabase();
      if (!client) throw new Error(errorMsg || 'Database offline.');

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      if (isUuid) {
        await client.from('bmc_silos').delete().eq('bmc_id', id);
        await client.from('eo_bmc_assignments').delete().eq('bmc_id', id);
      }

      const { error } = isUuid
        ? await client.from('bmcs').delete().eq('id', id)
        : await client.from('bmcs').delete().eq('bmc_code', id);

      if (error) throw error;
      deletedSuccess = true;
    }

    if (typeof showToast === 'function') showToast('BMC deleted successfully', 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to delete BMC', 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
};

// ── Filter / Search ───────────────────────────────────────────────────────────
function applyFilters() {
  const q = document.getElementById('bmc-search').value.toLowerCase().trim();
  const statusEl = document.getElementById('bmc-filter-status');
  const status = statusEl ? statusEl.value : 'all';
  const routeEl = document.getElementById('bmc-filter-route');
  const routeId = routeEl ? routeEl.value : 'all';

  let list = [...allBmcs];
  if (q) list = list.filter(b => b.name.toLowerCase().includes(q) || b.district.toLowerCase().includes(q));
  if (status === 'active') list = list.filter(b => b.is_active);
  if (status === 'inactive') list = list.filter(b => !b.is_active);
  
  if (routeId === 'none') {
    list = list.filter(b => !b.route_id);
  } else if (routeId !== 'all') {
    list = list.filter(b => b.route_id === routeId);
  }
  renderGrid(list);
}

// ── Bind Events ───────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('add-bmc-btn').addEventListener('click', openAddModal);
  


  document.getElementById('bmc-modal-close').addEventListener('click', closeModal);
  document.getElementById('bmc-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('bmc-save-btn').addEventListener('click', saveBmc);
  document.getElementById('detect-location-btn').addEventListener('click', detectLocation);
  document.getElementById('bmc-search').addEventListener('input', applyFilters);
  document.getElementById('bmc-filter-status').addEventListener('change', applyFilters);
  
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
            const fetchFunc = typeof adminFetch === 'function' ? adminFetch : fetch;
            const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
            const headers = {'Content-Type': 'application/json'};
            if (typeof adminFetch !== 'function') {
              headers['Authorization'] = `Bearer ${window.localStorage.getItem('sb-access-token')}`;
            }
            const res = await fetchFunc(`${baseUrl}/api/gm/routes`, {
              method: 'POST',
              headers,
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

  // Image upload
  const imageZone = document.getElementById('bmc-image-drop');
  const imageInput = document.getElementById('bmc-image-input');
  imageZone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', e => handleImageSelect(e.target.files[0]));

  // Close modal on overlay click
  document.getElementById('bmc-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('bmc-modal')) closeModal();
  });

  // Sidebar toggle
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const navEl = document.querySelector('.admin-nav');
  if (toggleBtn && navEl) {
    toggleBtn.addEventListener('click', () => navEl.classList.toggle('show'));
  }

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
}

// ── Image Select ──────────────────────────────────────────────────────────────
function handleImageSelect(file) {
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('bmc-preview-img');
    img.src = e.target.result;
    img.classList.remove('hidden');
    document.getElementById('bmc-image-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ── Location Detection ────────────────────────────────────────────────────────
function detectLocation() {
  const btn = document.getElementById('detect-location-btn');
  const status = document.getElementById('location-status');
  
  if (!navigator.geolocation) {
    status.textContent = '❌ Geolocation not supported by your browser.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '📡 Detecting…';
  status.textContent = 'Requesting location permission…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      detectedLat = pos.coords.latitude;
      detectedLng = pos.coords.longitude;

      document.getElementById('bmc-latitude').value = detectedLat;
      document.getElementById('bmc-longitude').value = detectedLng;

      status.textContent = '✅ Location detected! Confirm and save.';
      btn.disabled = false;
      btn.textContent = '📡 Re-detect Location';
      showToast('Location detected successfully.', 'success');
    },
    err => {
      btn.disabled = false;
      btn.textContent = '📡 Detect My Location';
      const msgs = {
        1: 'Permission denied. Please allow location access in your browser.',
        2: 'Position unavailable. Try again.',
        3: 'Request timed out. Try again.'
      };
      status.textContent = '❌ ' + (msgs[err.code] || 'Unknown error.');
      showToast('Location detection failed: ' + (msgs[err.code] || 'Error'), 'error');
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

  document.getElementById('bmc-modal-title').textContent = 'Add New BMC';
  const routeEl = document.getElementById('bmc-route');
  if (routeEl) routeEl.value = '';
  document.getElementById('bmc-name').value = '';
  document.getElementById('bmc-district').value = '';
  document.getElementById('bmc-contact').value = '';
  document.getElementById('bmc-code').value = '';
  document.getElementById('bmc-location-text').value = '';
  document.getElementById('bmc-latitude').value = '';
  document.getElementById('bmc-longitude').value = '';
  document.getElementById('location-status').textContent = '';
  document.getElementById('detect-location-btn').textContent = '📡 Detect My Location';
  document.getElementById('detect-location-btn').disabled = false;

  // Reset image
  const img = document.getElementById('bmc-preview-img');
  img.src = '';
  img.classList.add('hidden');
  document.getElementById('bmc-image-placeholder').style.display = '';
  document.getElementById('bmc-image-input').value = '';

  document.getElementById('bmc-modal').classList.remove('hidden');
}

// ── Open Edit Modal ───────────────────────────────────────────────────────────
function openEditModal(id) {
  const bmc = allBmcs.find(b => b.id === id);
  if (!bmc) return;

  editingBmcId = id;
  selectedFile = null;
  detectedLat = bmc.latitude || null;
  detectedLng = bmc.longitude || null;

  document.getElementById('bmc-modal-title').textContent = 'Edit BMC';
  const routeEl = document.getElementById('bmc-route');
  if (routeEl) routeEl.value = bmc.route_id || '';
  document.getElementById('bmc-name').value = bmc.name;
  document.getElementById('bmc-district').value = bmc.district;
  document.getElementById('bmc-contact').value = bmc.contact_number;
  document.getElementById('bmc-code').value = bmc.bmc_code || '';
  document.getElementById('bmc-location-text').value = bmc.location;
  document.getElementById('bmc-latitude').value = bmc.latitude || '';
  document.getElementById('bmc-longitude').value = bmc.longitude || '';
  document.getElementById('location-status').textContent = bmc.latitude ? '✅ Coordinates saved.' : '';



  // Image
  const img = document.getElementById('bmc-preview-img');
  if (bmc.profile_image_url) {
    img.src = bmc.profile_image_url;
    img.classList.remove('hidden');
    document.getElementById('bmc-image-placeholder').style.display = 'none';
  } else {
    img.src = '';
    img.classList.add('hidden');
    document.getElementById('bmc-image-placeholder').style.display = '';
  }
  document.getElementById('bmc-image-input').value = '';

  document.getElementById('bmc-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('bmc-modal').classList.add('hidden');
}

// ── Save BMC ──────────────────────────────────────────────────────────────────
async function saveBmc() {
  const name = document.getElementById('bmc-name').value.trim();
  const district = document.getElementById('bmc-district').value.trim();
  const contact = document.getElementById('bmc-contact').value.trim();
  const bmcCode = document.getElementById('bmc-code').value.trim();
  const location = document.getElementById('bmc-location-text').value.trim();
  const lat = document.getElementById('bmc-latitude').value;
  const lng = document.getElementById('bmc-longitude').value;
  const routeEl = document.getElementById('bmc-route');
  const route_id = routeEl ? routeEl.value : null;

  // Validation
  if (!name) { showToast('BMC Name is required.', 'error'); return; }
  if (!district) { showToast('District is required.', 'error'); return; }
  if (!contact) { showToast('Contact number is required.', 'error'); return; }
  if (!location) { showToast('Location name is required.', 'error'); return; }
  if (!lat || !lng) {
    showToast('GPS coordinates are required. Please click "Detect My Location".', 'error');
    return;
  }

  toggleLoading(true);
  const client = await initSupabase();
  if (!client) { toggleLoading(false); showToast('Database offline.', 'error'); return; }

  try {
    // Upload image if selected
    let imageUrl = editingBmcId ? (allBmcs.find(b => b.id === editingBmcId)?.profile_image_url || null) : null;

    if (selectedFile) {
      try {
        const ext = selectedFile.name.split('.').pop();
        const path = `bmcs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await client.storage
          .from('profile_images')
          .upload(path, selectedFile, { cacheControl: '3600', upsert: true });

        if (!uploadErr) {
          const { data: { publicUrl } } = client.storage.from('profile_images').getPublicUrl(path);
          imageUrl = publicUrl;
        } else {
          console.warn('Storage bucket upload failed, using Data URL fallback:', uploadErr.message);
          imageUrl = await getOptimizedBase64(selectedFile);
        }
      } catch (err) {
        console.warn('Storage upload error, using Data URL fallback:', err);
        imageUrl = await getOptimizedBase64(selectedFile);
      }
    }

    const payload = {
      name,
      district,
      contact_number: contact,
      bmc_code: bmcCode,
      location,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      profile_image_url: imageUrl,
      route_id: route_id,
      updated_at: new Date()
    };

    if (editingBmcId) {
      const { error } = await client.from('bmcs').update(payload).eq('id', editingBmcId);
      if (error) throw error;
      showToast('BMC updated successfully!', 'success');
    } else {
      const { error } = await client.from('bmcs').insert({ ...payload, is_active: true });
      if (error) throw error;
      showToast('BMC added successfully!', 'success');
    }

    closeModal();
    await loadBmcs();
  } catch (err) {
    console.error('❌ Save BMC error:', err);
    showToast(err.message || 'Failed to save BMC.', 'error');
  } finally {
    toggleLoading(false);
  }
}

// ── Toggle Active Status ──────────────────────────────────────────────────────
async function toggleBmcStatus(id, currentlyActive) {
  const action = currentlyActive ? 'deactivate' : 'activate';
  if (!confirm(`Are you sure you want to ${action} this BMC?`)) return;

  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    let success = false;
    try {
      if (typeof adminFetch === 'function') {
        await adminFetch(`/api/gm/bmcs/${encodeURIComponent(id)}/toggle`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: !currentlyActive })
        });
        success = true;
      } else {
        const token = window.localStorage.getItem('sb-access-token') || '';
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';
        const res = await fetch(`${baseUrl}/api/gm/bmcs/${encodeURIComponent(id)}/toggle`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ is_active: !currentlyActive })
        });
        if (res.ok) success = true;
      }
    } catch (fetchErr) {
      console.warn('[toggleBmcStatus] API toggle failed, trying direct Supabase fallback:', fetchErr);
    }

    if (!success) {
      const client = await initSupabase();
      if (!client) throw new Error('Database offline.');

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const { error } = isUuid
        ? await client.from('bmcs').update({ is_active: !currentlyActive }).eq('id', id)
        : await client.from('bmcs').update({ is_active: !currentlyActive }).eq('bmc_code', id);

      if (error) throw error;
    }

    if (typeof showToast === 'function') showToast(`BMC ${action}d successfully.`, 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}
window.toggleBmcStatus = toggleBmcStatus;

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

