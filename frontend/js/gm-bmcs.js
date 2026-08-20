// gm-bmcs.js — GM BMC Management (Exact Admin BMC UI + Leaflet Map)

let allBmcs = [];
let editingBmcId = null;
let selectedFile = null;
let detectedLat = null;
let detectedLng = null;
let mapInstance = null;
let markersGroup = null;

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Only run on GM BMC page
  if (!document.getElementById('bmc-grid')) return;

  // Auth guard — must be GM (or admin)
  const profile = await checkAuth('gm');
  if (!profile) return;

  if (document.getElementById('header-gm-name')) {
    document.getElementById('header-gm-name').textContent = profile.name || 'General Manager';
  }

  await loadBmcs();
  bindEvents();
});

// ── Load All BMCs ─────────────────────────────────────────────────────────────
async function loadBmcs() {
  const grid = document.getElementById('bmc-grid');
  if (grid) {
    grid.innerHTML = `<div class="bmc-empty-state"><div class="bmc-empty-icon">⏳</div><div class="bmc-empty-title">Loading…</div></div>`;
  }

  try {
    // Primary: fetch via backend GM API
    const res = await apiGetGmBmcs();
    allBmcs = res.bmcs || [];
  } catch (err) {
    console.warn('Backend API load failed, trying direct database fetch:', err);
    // Fallback: direct Supabase query
    const client = await initSupabase();
    if (client) {
      const { data, error } = await client
        .from('bmcs')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        allBmcs = data;
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

  // Initialize Leaflet map if not already done
  if (!mapInstance) {
    mapInstance = L.map('bmc-leaflet-map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([11.1271, 78.6569], 7); // Default center (Tamil Nadu)

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

      const popupContent = `
        <div style="font-family: inherit; min-width: 170px; padding: 2px;">
          <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; font-weight: 700; color: #0f172a;">${escHtml(bmc.name)}</h4>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">🗺️ <b>District:</b> ${escHtml(bmc.district)}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 3px;">📍 <b>Location:</b> ${escHtml(bmc.location)}</div>
          <div style="font-size: 0.8rem; color: #475569; margin-bottom: 6px;">📞 <b>Contact:</b> ${escHtml(bmc.contact_number || '—')}</div>
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

  // Ensure Leaflet map resizes properly without rendering gray tiles
  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 300);
}

// ── Render Grid ───────────────────────────────────────────────────────────────
function renderGrid(list) {
  const grid = document.getElementById('bmc-grid');
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = `
      <div class="bmc-empty-state">
        <div class="bmc-empty-icon">🏭</div>
        <div class="bmc-empty-title">No BMCs found</div>
        <div class="bmc-empty-desc">Click "Add New BMC" to register the first Bulk Milk Cooler.</div>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(bmc => `
    <div class="bmc-card ${bmc.is_active === false ? 'inactive-card' : ''}">
      ${bmc.profile_image_url
        ? `<img src="${escHtml(bmc.profile_image_url)}" class="bmc-card-image" alt="${escHtml(bmc.name)}">`
        : `<div class="bmc-card-image-placeholder">🏭</div>`}
      <div class="bmc-card-body">
        <div class="bmc-card-title">${escHtml(bmc.name)}</div>
        <div class="bmc-card-meta">
          <div class="bmc-card-meta-item"><span>🗺️</span>${escHtml(bmc.district)}</div>
          <div class="bmc-card-meta-item"><span>📍</span>${escHtml(bmc.location)}</div>
          <div class="bmc-card-meta-item"><span>📞</span>${escHtml(bmc.contact_number)}</div>
          ${bmc.latitude ? `<div class="bmc-card-meta-item"><span>🛰️</span>${Number(bmc.latitude).toFixed(5)}, ${Number(bmc.longitude).toFixed(5)}</div>` : ''}
        </div>
        <div class="bmc-card-status">
          <span class="bmc-status-badge ${bmc.is_active !== false ? 'bmc-status-active' : 'bmc-status-inactive'}">
            ${bmc.is_active !== false ? '● Active' : '● Inactive'}
          </span>
        </div>
      </div>
      <div class="bmc-card-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditModal('${bmc.id}')" style="flex:1;">✏️ Edit</button>
        <button class="btn btn-sm ${bmc.is_active !== false ? 'btn-danger' : 'btn-primary'}" onclick="toggleBmcStatus('${bmc.id}', ${bmc.is_active !== false})" style="flex:1;">
          ${bmc.is_active !== false ? '⏹ Deactivate' : '▶ Activate'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteBmc('${bmc.id}')" title="Delete BMC" style="padding: 0 10px;">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ── Delete BMC ────────────────────────────────────────────────────────────────
window.deleteBmc = async function(id) {
  if (!confirm('Are you sure you want to delete this BMC record?')) return;
  toggleLoading(true);
  try {
    const client = await initSupabase();
    if (!client) { throw new Error('Database offline.'); }
    
    const { error } = await client.from('bmcs').delete().eq('id', id);
    if (error) throw error;
    
    if (typeof showToast === 'function') showToast('BMC deleted successfully', 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to delete BMC', 'error');
  } finally {
    toggleLoading(false);
  }
};

// ── Filter / Search ───────────────────────────────────────────────────────────
function applyFilters() {
  const searchEl = document.getElementById('bmc-search');
  const statusEl = document.getElementById('bmc-filter-status');

  const q = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const status = statusEl ? statusEl.value : 'all';

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

  const searchInput = document.getElementById('bmc-search');
  if (searchInput) searchInput.addEventListener('input', applyFilters);

  const filterSelect = document.getElementById('bmc-filter-status');
  if (filterSelect) filterSelect.addEventListener('change', applyFilters);

  // Image upload zone
  const imageZone = document.getElementById('bmc-image-drop');
  const imageInput = document.getElementById('bmc-image-input');
  if (imageZone && imageInput) {
    imageZone.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', e => handleImageSelect(e.target.files[0]));
  }

  // Close modal on overlay click
  const modalOverlay = document.getElementById('bmc-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Window resize handler to invalidate map size
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
  if (status) status.textContent = 'Requesting location permission…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      detectedLat = pos.coords.latitude;
      detectedLng = pos.coords.longitude;

      document.getElementById('bmc-latitude').value = detectedLat;
      document.getElementById('bmc-longitude').value = detectedLng;



      if (status) status.textContent = '✅ Location detected! Confirm and save.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📡 Re-detect Location';
      }
      if (typeof showToast === 'function') showToast('Location detected successfully.', 'success');
    },
    err => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📡 Detect My Location';
      }
      const msgs = {
        1: 'Permission denied. Please allow location access in your browser.',
        2: 'Position unavailable. Try again.',
        3: 'Request timed out. Try again.'
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

  document.getElementById('bmc-modal-title').textContent = 'Add New BMC';
  document.getElementById('bmc-name').value = '';
  document.getElementById('bmc-district').value = '';
  document.getElementById('bmc-contact').value = '';
  document.getElementById('bmc-location-text').value = '';
  document.getElementById('bmc-latitude').value = '';
  document.getElementById('bmc-longitude').value = '';

  document.getElementById('location-status').textContent = '';

  const detectBtn = document.getElementById('detect-location-btn');
  if (detectBtn) {
    detectBtn.textContent = '📡 Detect My Location';
    detectBtn.disabled = false;
  }

  // Reset image preview
  const img = document.getElementById('bmc-preview-img');
  if (img) {
    img.src = '';
    img.classList.add('hidden');
  }
  const placeholder = document.getElementById('bmc-image-placeholder');
  if (placeholder) placeholder.style.display = '';

  const imageInput = document.getElementById('bmc-image-input');
  if (imageInput) imageInput.value = '';

  document.getElementById('bmc-modal').classList.remove('hidden');
}

// ── Open Edit Modal ───────────────────────────────────────────────────────────
window.openEditModal = function(id) {
  const bmc = allBmcs.find(b => b.id === id);
  if (!bmc) return;

  editingBmcId = id;
  selectedFile = null;
  detectedLat = bmc.latitude || null;
  detectedLng = bmc.longitude || null;

  document.getElementById('bmc-modal-title').textContent = 'Edit BMC';
  document.getElementById('bmc-name').value = bmc.name || '';
  document.getElementById('bmc-district').value = bmc.district || '';
  document.getElementById('bmc-contact').value = bmc.contact_number || '';
  document.getElementById('bmc-location-text').value = bmc.location || '';
  document.getElementById('bmc-latitude').value = bmc.latitude || '';
  document.getElementById('bmc-longitude').value = bmc.longitude || '';

  const statusText = document.getElementById('location-status');
  if (statusText) statusText.textContent = bmc.latitude ? '✅ Coordinates saved.' : '';



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

  document.getElementById('bmc-modal').classList.remove('hidden');
};

function closeModal() {
  document.getElementById('bmc-modal').classList.add('hidden');
}

// ── Save BMC ──────────────────────────────────────────────────────────────────
async function saveBmc() {
  const name = document.getElementById('bmc-name').value.trim();
  const district = document.getElementById('bmc-district').value.trim();
  const contact = document.getElementById('bmc-contact').value.trim();
  const location = document.getElementById('bmc-location-text').value.trim();
  const lat = document.getElementById('bmc-latitude').value;
  const lng = document.getElementById('bmc-longitude').value;

  // Validation
  if (!name) { if (typeof showToast === 'function') showToast('BMC Name is required.', 'error'); return; }
  if (!district) { if (typeof showToast === 'function') showToast('District is required.', 'error'); return; }
  if (!contact) { if (typeof showToast === 'function') showToast('Contact number is required.', 'error'); return; }
  if (!location) { if (typeof showToast === 'function') showToast('Location name is required.', 'error'); return; }
  if (!lat || !lng) {
    if (typeof showToast === 'function') showToast('GPS coordinates are required. Please click "Detect My Location".', 'error');
    return;
  }

  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    // Process image if selected
    let imageUrl = editingBmcId ? (allBmcs.find(b => b.id === editingBmcId)?.profile_image_url || null) : null;

    if (selectedFile) {
      const client = await initSupabase();
      if (client) {
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
            imageUrl = await getOptimizedBase64(selectedFile);
          }
        } catch (err) {
          imageUrl = await getOptimizedBase64(selectedFile);
        }
      } else {
        imageUrl = await getOptimizedBase64(selectedFile);
      }
    }

    const payload = {
      name,
      district,
      contact_number: contact,
      location,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      profile_image_url: imageUrl
    };

    if (editingBmcId) {
      // Try backend PUT first
      try {
        const token = window.localStorage.getItem('sb-access-token') || '';
        const res = await fetch(`/api/gm/bmcs/${editingBmcId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Backend update failed');
        }
      } catch (apiErr) {
        // Fallback to Supabase client
        const client = await initSupabase();
        if (!client) throw apiErr;
        const { error } = await client.from('bmcs').update({ ...payload, updated_at: new Date() }).eq('id', editingBmcId);
        if (error) throw error;
      }
      if (typeof showToast === 'function') showToast('BMC updated successfully!', 'success');
    } else {
      // Create new BMC
      try {
        await apiGmCreateBmc(payload);
      } catch (apiErr) {
        // Fallback to Supabase client
        const client = await initSupabase();
        if (!client) throw apiErr;
        const { error } = await client.from('bmcs').insert({ ...payload, is_active: true });
        if (error) throw error;
      }
      if (typeof showToast === 'function') showToast('BMC added successfully!', 'success');
    }

    closeModal();
    await loadBmcs();
  } catch (err) {
    console.error('❌ Save BMC error:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to save BMC.', 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

// ── Toggle Active Status ──────────────────────────────────────────────────────
window.toggleBmcStatus = async function(id, currentlyActive) {
  const action = currentlyActive ? 'deactivate' : 'activate';
  if (!confirm(`Are you sure you want to ${action} this BMC?`)) return;

  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const token = window.localStorage.getItem('sb-access-token') || '';
    const res = await fetch(`/api/gm/bmcs/${id}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ is_active: !currentlyActive })
    });

    if (!res.ok) {
      // Fallback to direct Supabase update
      const client = await initSupabase();
      if (client) {
        const { error } = await client
          .from('bmcs')
          .update({ is_active: !currentlyActive, updated_at: new Date() })
          .eq('id', id);
        if (error) throw error;
      } else {
        throw new Error('Failed to toggle status');
      }
    }

    if (typeof showToast === 'function') showToast(`BMC ${action}d successfully.`, 'success');
    await loadBmcs();
  } catch (err) {
    if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'error');
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
