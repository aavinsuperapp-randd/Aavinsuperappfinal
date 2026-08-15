// bmc-admin.js — Admin BMC Management (Add / Edit / Toggle / View)

let allBmcs = [];
let editingBmcId = null;
let selectedFile = null;
let detectedLat = null;
let detectedLng = null;

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Only run on bmc.html
  if (!document.getElementById('bmc-grid')) return;

  // Auth guard — must be admin
  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  await loadBmcs();
  bindEvents();
});

// ── Load All BMCs ─────────────────────────────────────────────────────────────
async function loadBmcs() {
  const grid = document.getElementById('bmc-grid');
  grid.innerHTML = `<div class="bmc-empty-state"><div class="bmc-empty-icon">⏳</div><div class="bmc-empty-title">Loading…</div></div>`;

  const client = await initSupabase();
  if (!client) { showToast('Database offline.', 'error'); return; }

  const { data, error } = await client
    .from('bmcs')
    .select('*')
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
function renderGrid(list) {
  const grid = document.getElementById('bmc-grid');
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
    <div class="bmc-card ${!bmc.is_active ? 'inactive-card' : ''}">
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
          <span class="bmc-status-badge ${bmc.is_active ? 'bmc-status-active' : 'bmc-status-inactive'}">
            ${bmc.is_active ? '● Active' : '● Inactive'}
          </span>
        </div>
      </div>
      <div class="bmc-card-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditModal('${bmc.id}')">✏️ Edit</button>
        <button class="btn btn-sm ${bmc.is_active ? 'btn-danger' : 'btn-primary'}" onclick="toggleBmcStatus('${bmc.id}', ${bmc.is_active})">
          ${bmc.is_active ? '⏹ Deactivate' : '▶ Activate'}
        </button>
      </div>
    </div>
  `).join('');
}

// ── Filter / Search ───────────────────────────────────────────────────────────
function applyFilters() {
  const q = document.getElementById('bmc-search').value.toLowerCase().trim();
  const status = document.getElementById('bmc-filter-status').value;

  let list = [...allBmcs];
  if (q) list = list.filter(b => b.name.toLowerCase().includes(q) || b.district.toLowerCase().includes(q));
  if (status === 'active') list = list.filter(b => b.is_active);
  if (status === 'inactive') list = list.filter(b => !b.is_active);
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

      document.getElementById('lat-display').textContent = detectedLat.toFixed(6);
      document.getElementById('lng-display').textContent = detectedLng.toFixed(6);
      document.getElementById('bmc-coords-display').style.display = 'flex';

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
  document.getElementById('bmc-name').value = '';
  document.getElementById('bmc-district').value = '';
  document.getElementById('bmc-contact').value = '';
  document.getElementById('bmc-location-text').value = '';
  document.getElementById('bmc-latitude').value = '';
  document.getElementById('bmc-longitude').value = '';
  document.getElementById('bmc-coords-display').style.display = 'none';
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
  document.getElementById('bmc-name').value = bmc.name;
  document.getElementById('bmc-district').value = bmc.district;
  document.getElementById('bmc-contact').value = bmc.contact_number;
  document.getElementById('bmc-location-text').value = bmc.location;
  document.getElementById('bmc-latitude').value = bmc.latitude || '';
  document.getElementById('bmc-longitude').value = bmc.longitude || '';
  document.getElementById('location-status').textContent = bmc.latitude ? '✅ Coordinates saved.' : '';

  if (bmc.latitude) {
    document.getElementById('lat-display').textContent = Number(bmc.latitude).toFixed(6);
    document.getElementById('lng-display').textContent = Number(bmc.longitude).toFixed(6);
    document.getElementById('bmc-coords-display').style.display = 'flex';
  } else {
    document.getElementById('bmc-coords-display').style.display = 'none';
  }

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
  const location = document.getElementById('bmc-location-text').value.trim();
  const lat = document.getElementById('bmc-latitude').value;
  const lng = document.getElementById('bmc-longitude').value;

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
      location,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      profile_image_url: imageUrl,
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

  toggleLoading(true);
  const client = await initSupabase();
  if (!client) { toggleLoading(false); showToast('Database offline.', 'error'); return; }

  const { error } = await client
    .from('bmcs')
    .update({ is_active: !currentlyActive, updated_at: new Date() })
    .eq('id', id);

  toggleLoading(false);
  if (error) {
    showToast('Failed: ' + error.message, 'error');
  } else {
    showToast(`BMC ${action}d successfully.`, 'success');
    await loadBmcs();
  }
}

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

