// worker-dashboard.js — Main Worker Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {
  // Enforce worker role auth
  const profile = await checkAuth('user');
  if (!profile) return;

  const mainArea = document.getElementById('main-content-area');
  if (mainArea) mainArea.classList.remove('hidden');

  document.getElementById('header-worker-name').textContent = profile.name;
  document.getElementById('welcome-name').textContent = profile.name;

  setupMobileMenu();
  setupSearchModal();
  setupCreateBmcModal();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadDashboardData();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('worker-sidebar') || document.querySelector('.worker-sidebar');
  const main = document.querySelector('.worker-main');
  const overlay = document.getElementById('sidebar-overlay');

  function toggleSidebar() {
    if (window.innerWidth > 900) {
      if (sidebar) sidebar.classList.toggle('collapsed');
      if (main) main.classList.toggle('expanded');
    } else {
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      } else {
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
      }
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 900) {
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
    }
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  if (sidebar) {
    sidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
  }
}

async function loadDashboardData() {
  try {
    // 1. Fetch Stats
    const stats = await apiGetStats();
    document.getElementById('stat-total-trips').textContent = stats.total_trips || 0;
    document.getElementById('stat-completed-trips').textContent = stats.completed_trips || 0;
    document.getElementById('stat-active-trips').textContent = (stats.active_trips > 0) ? 'Yes' : 'No';

    // 2. Fetch Active Trip
    const activeTripData = await apiGetActiveTrip();
    renderActiveTrip(activeTripData.trip, activeTripData.visits);

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    showToast(err.message || 'Error loading dashboard data', 'error');
  }
}

function renderActiveTrip(trip, visits = []) {
  const container = document.getElementById('active-trip-container');
  const startTripBtn = document.getElementById('qa-start-trip');

  if (!trip) {
    if (startTripBtn) startTripBtn.style.opacity = '1';
    container.innerHTML = `
      <div class="form-section text-center" style="padding: 28px;">
        <div style="font-size: 2rem; margin-bottom: 8px;">🚚</div>
        <h3 style="font-size: 1rem; font-weight: 700; color: var(--gray-800); margin-bottom: 4px;">No Active Trip</h3>
        <p style="font-size: .84rem; color: var(--gray-500); margin-bottom: 16px;">You are currently not on a trip. Create a new trip to start visiting Bulk Milk Coolers.</p>
        <a href="trip-create.html" class="btn btn-primary">
          <span>+</span> Start New Trip
        </a>
      </div>
    `;
    return;
  }

  // Active Trip exists
  if (startTripBtn) {
    startTripBtn.href = '#';
    startTripBtn.onclick = (e) => {
      e.preventDefault();
      showToast('You already have an active trip. Complete it first.', 'warning');
    };
  }

  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const totalVisits = visits.length;
  const progressPct = totalVisits > 0 ? Math.round((completedVisits / totalVisits) * 100) : 0;

  const driverName = trip.driver_name || (trip.driver ? trip.driver.name : 'Unassigned');
  const tankerBoard = trip.tanker_number || (trip.tanker ? trip.tanker.board_number : 'N/A');
  const startTimeStr = new Date(trip.out_time).toLocaleString();


  container.innerHTML = `
    <div class="active-trip-banner">
      <div class="atb-header">
        <div class="atb-title">
          <span>🟢 ACTIVE TRIP:</span> ${esc(trip.trip_name)} (${esc(trip.trip_number || '')})
        </div>
        <a href="trip.html?id=${trip.id}" class="btn btn-primary btn-sm">
          Continue Trip →
        </a>
      </div>

      <div class="atb-meta">
        <div class="atb-meta-item">Driver: <strong>${esc(driverName)}</strong></div>
        <div class="atb-meta-item">Tanker: <strong>${esc(tankerBoard)}</strong></div>
        <div class="atb-meta-item">Out Time: <strong>${esc(startTimeStr)}</strong></div>
      </div>

      <div class="trip-progress">
        <div class="trip-progress-bar">
          <div class="trip-progress-fill" style="width: ${progressPct}%;"></div>
        </div>
        <div class="trip-progress-text">
          ${completedVisits} / ${totalVisits} BMCs Completed (${progressPct}%)
        </div>
      </div>
    </div>
  `;
}

function setupSearchModal() {
  const searchBtn = document.getElementById('qa-search-bmc');
  const modal = document.getElementById('bmc-search-modal');
  const closeBtn = document.getElementById('modal-bmc-close');
  const input = document.getElementById('modal-bmc-input');
  const resultsDiv = document.getElementById('modal-bmc-results');

  if (!searchBtn || !modal) return;

  searchBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    input.focus();
    performSearch('');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(e.target.value);
    }, 300);
  });

  async function performSearch(q) {
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Searching...</div></div>';
    try {
      const res = await apiSearchBmcs(q);
      const list = res.bmcs || [];
      if (list.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No BMCs found matching your query.</div></div>';
        return;
      }
      resultsDiv.innerHTML = list.map(b => `
        <div class="search-result-item" onclick="viewBmcDetail('${b.name}', '${b.district}', '${b.location}', '${b.contact_number}')">
          <div class="search-result-img">
            ${b.profile_image_url ? `<img src="${esc(b.profile_image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" alt="${esc(b.name)}">` : '🏭'}
          </div>
          <div style="flex:1;">
            <div class="search-result-name">${esc(b.name)}</div>
            <div class="search-result-meta">📍 ${esc(b.location)}, ${esc(b.district)} | 📞 ${esc(b.contact_number)}</div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      resultsDiv.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Error: ${esc(err.message)}</div></div>`;
    }
  }
}

window.viewBmcDetail = function(name, district, location, contact) {
  alert(`BMC Details:\n\nName: ${name}\nDistrict: ${district}\nLocation: ${location}\nContact: ${contact}`);
};

function setupCreateBmcModal() {
  const openBtn = document.getElementById('qa-create-bmc');
  const modal = document.getElementById('create-bmc-modal');
  const closeBtn = document.getElementById('create-bmc-close');
  const cancelBtn = document.getElementById('create-bmc-cancel');
  const submitBtn = document.getElementById('create-bmc-submit');

  const nameInput = document.getElementById('create-bmc-name');
  const districtInput = document.getElementById('create-bmc-district');
  const locationInput = document.getElementById('create-bmc-location');
  const contactInput = document.getElementById('create-bmc-contact');
  
  const detectLocBtn = document.getElementById('create-detect-location-btn');
  const locStatus = document.getElementById('create-location-status');
  const coordsDisplay = document.getElementById('create-coords-display');
  const latInput = document.getElementById('create-bmc-latitude');
  const lngInput = document.getElementById('create-bmc-longitude');

  const imageZone = document.getElementById('create-bmc-image-drop');
  const imageInput = document.getElementById('create-bmc-image-input');
  const previewImg = document.getElementById('create-bmc-preview-img');
  const imagePlaceholder = document.getElementById('create-bmc-image-placeholder');

  let selectedFile = null;
  let detectedLat = null;
  let detectedLng = null;

  if (!openBtn || !modal) return;

  function openModal() {
    modal.classList.remove('hidden');
    nameInput.value = '';
    districtInput.value = '';
    locationInput.value = '';
    contactInput.value = '';
    latInput.value = '';
    lngInput.value = '';
    locStatus.textContent = '';
    detectLocBtn.textContent = '📡 Detect My Location';
    detectLocBtn.disabled = false;
    selectedFile = null;
    detectedLat = null;
    detectedLng = null;

    // Reset image
    previewImg.src = '';
    previewImg.classList.add('hidden');
    imagePlaceholder.style.display = '';
    imageInput.value = '';

    nameInput.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Geolocation detection
  detectLocBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      locStatus.textContent = '❌ Geolocation not supported by your browser.';
      return;
    }

    detectLocBtn.disabled = true;
    detectLocBtn.textContent = '📡 Detecting…';
    locStatus.textContent = 'Requesting location permission…';

    navigator.geolocation.getCurrentPosition(
      pos => {
        detectedLat = pos.coords.latitude;
        detectedLng = pos.coords.longitude;

        latInput.value = detectedLat;
        lngInput.value = detectedLng;


        locStatus.textContent = '✅ Location detected!';
        detectLocBtn.disabled = false;
        detectLocBtn.textContent = '📡 Re-detect Location';
        showToast('Location detected successfully.', 'success');
      },
      err => {
        detectLocBtn.disabled = false;
        detectLocBtn.textContent = '📡 Detect My Location';
        const msgs = {
          1: 'Permission denied. Please allow location access in your browser.',
          2: 'Position unavailable. Try again.',
          3: 'Request timed out. Try again.'
        };
        locStatus.textContent = '❌ ' + (msgs[err.code] || 'Unknown error.');
        showToast('Location detection failed: ' + (msgs[err.code] || 'Error'), 'error');
      },
      { timeout: 12000, maximumAge: 0 }
    );
  });

  // Image Upload Logic
  imageZone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      previewImg.src = ev.target.result;
      previewImg.classList.remove('hidden');
      imagePlaceholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  // Save/Submit BMC
  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const district = districtInput.value.trim();
    const location = locationInput.value.trim();
    const contact_number = contactInput.value.trim();
    const lat = latInput.value;
    const lng = lngInput.value;

    if (!name || !district || !location || !contact_number) {
      showToast('All fields are required.', 'error');
      return;
    }
    if (!lat || !lng) {
      showToast('GPS coordinates are required. Please click "Detect My Location".', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering...';

    try {
      let imageUrl = null;

      // Upload image if selected (or convert to Base64)
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
              console.warn('Storage bucket upload failed, using Data URL fallback:', uploadErr.message);
              imageUrl = await getOptimizedBase64(selectedFile);
            }
          } catch (err) {
            console.warn('Storage upload error, using Data URL fallback:', err);
            imageUrl = await getOptimizedBase64(selectedFile);
          }
        } else {
          imageUrl = await getOptimizedBase64(selectedFile);
        }
      }

      await apiCreateBmc({
        name,
        district,
        location,
        contact_number,
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        profile_image_url: imageUrl
      });

      showToast(`BMC "${name}" registered successfully!`, 'success');
      closeModal();
    } catch (err) {
      console.error('Create BMC error:', err);
      showToast(err.message || 'Failed to create BMC.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save BMC';
    }
  });
}

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

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
