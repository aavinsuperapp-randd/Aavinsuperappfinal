// gm-bmcs.js — BMC Management Page Logic

let currentBmcs = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('gm');
  if (!profile) return;

  if (document.getElementById('header-gm-name')) {
    document.getElementById('header-gm-name').textContent = profile.name || 'General Manager';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const searchInput = document.getElementById('bmc-search-input');
  if (searchInput) searchInput.addEventListener('input', renderBmcsTable);

  setupCreateBmcModal();
  await loadBmcsData();
});

async function loadBmcsData() {
  try {
    const res = await apiGetGmBmcs();
    currentBmcs = res.bmcs || [];
    renderBmcsTable();
  } catch (err) {
    console.error('Failed to load BMCs:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load BMCs.', 'error');
  }
}

function renderBmcsTable() {
  const tbody = document.getElementById('bmcs-table-body');
  if (!tbody) return;

  const searchVal = (document.getElementById('bmc-search-input')?.value || '').toLowerCase().trim();
  let filtered = currentBmcs.filter(b => {
    return !searchVal ||
      (b.name || '').toLowerCase().includes(searchVal) ||
      (b.district || '').toLowerCase().includes(searchVal) ||
      (b.location || '').toLowerCase().includes(searchVal);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">No BMC units found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(b => `
    <tr>
      <td><strong>${esc(b.name)}</strong></td>
      <td>${esc(b.district)}</td>
      <td>${esc(b.location)}</td>
      <td>${esc(b.contact_number || '—')}</td>
      <td><span class="text-xs text-muted">${b.latitude ? `${b.latitude}, ${b.longitude}` : '—'}</span></td>
      <td><span class="status-badge ${b.is_active !== false ? 'completed' : 'cancelled'}">${b.is_active !== false ? 'Active' : 'Inactive'}</span></td>
      <td>
        <a href="bmc-profile.html?id=${b.id}" class="btn btn-sm btn-outline">
          🏬 View Profile
        </a>
      </td>
    </tr>
  `).join('');
}

let liveCameraStream = null;
let capturedLivePhotoBase64 = null;

function setupCreateBmcModal() {
  const modal = document.getElementById('create-bmc-modal');
  const openBtn = document.getElementById('gm-open-create-bmc-btn');
  const closeBtn = document.getElementById('create-bmc-modal-close');
  const cancelBtn = document.getElementById('create-bmc-cancel-btn');
  const detectBtn = document.getElementById('gm-detect-location-btn');
  const form = document.getElementById('gm-create-bmc-form');

  // Camera elements
  const startCameraBtn = document.getElementById('start-camera-btn');
  const stopCameraBtn = document.getElementById('stop-camera-btn');
  const capturePhotoBtn = document.getElementById('capture-photo-btn');
  const clearPhotoBtn = document.getElementById('clear-photo-btn');
  const cameraContainer = document.getElementById('camera-stream-container');
  const video = document.getElementById('bmc-camera-video');
  const canvas = document.getElementById('bmc-camera-canvas');
  const photoContainer = document.getElementById('captured-photo-container');
  const photoPreview = document.getElementById('captured-photo-preview');

  function openModal() {
    if (modal) modal.classList.remove('hidden');
  }

  function stopCameraStream() {
    if (liveCameraStream) {
      liveCameraStream.getTracks().forEach(track => track.stop());
      liveCameraStream = null;
    }
    if (video) video.srcObject = null;
    if (cameraContainer) cameraContainer.classList.add('hidden');
  }

  function resetFormAndCamera() {
    stopCameraStream();
    capturedLivePhotoBase64 = null;
    if (photoContainer) photoContainer.classList.add('hidden');
    if (photoPreview) photoPreview.src = '';
    if (form) form.reset();
  }

  function closeModal() {
    resetFormAndCamera();
    if (modal) modal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Live Camera Controls
  if (startCameraBtn) {
    startCameraBtn.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (typeof showToast === 'function') showToast('Live camera is not supported on this browser/device.', 'error');
        return;
      }
      try {
        liveCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        if (video) {
          video.srcObject = liveCameraStream;
          if (cameraContainer) cameraContainer.classList.remove('hidden');
        }
      } catch (err) {
        console.error('Camera permission or stream error:', err);
        if (typeof showToast === 'function') showToast('Camera access denied or camera not available.', 'error');
      }
    });
  }

  if (stopCameraBtn) {
    stopCameraBtn.addEventListener('click', stopCameraStream);
  }

  if (capturePhotoBtn) {
    capturePhotoBtn.addEventListener('click', () => {
      if (!video || !canvas) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      capturedLivePhotoBase64 = canvas.toDataURL('image/jpeg', 0.9);
      if (photoPreview) photoPreview.src = capturedLivePhotoBase64;
      if (photoContainer) photoContainer.classList.remove('hidden');

      stopCameraStream();
      if (typeof showToast === 'function') showToast('Live photo captured successfully!', 'info');
    });
  }

  if (clearPhotoBtn) {
    clearPhotoBtn.addEventListener('click', () => {
      capturedLivePhotoBase64 = null;
      if (photoPreview) photoPreview.src = '';
      if (photoContainer) photoContainer.classList.add('hidden');
    });
  }

  if (detectBtn) {
    detectBtn.addEventListener('click', () => {
      const statusText = document.getElementById('gps-status-text');
      if (!navigator.geolocation) {
        if (statusText) statusText.textContent = 'Geolocation not supported.';
        return;
      }
      if (statusText) statusText.textContent = 'Detecting GPS coordinates...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          document.getElementById('bmc-lat').value = pos.coords.latitude.toFixed(6);
          document.getElementById('bmc-lng').value = pos.coords.longitude.toFixed(6);
          if (statusText) statusText.textContent = '✓ Location updated!';
        },
        (err) => {
          if (statusText) statusText.textContent = `GPS error: ${err.message}`;
        }
      );
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('create-bmc-submit-btn');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const name = document.getElementById('bmc-name').value.trim();
        const district = document.getElementById('bmc-district').value.trim();
        const location = document.getElementById('bmc-location').value.trim();
        const contact_number = document.getElementById('bmc-contact').value.trim();
        const latitude = document.getElementById('bmc-lat').value;
        const longitude = document.getElementById('bmc-lng').value;
        const imageFile = document.getElementById('bmc-image-input')?.files[0];

        let profile_image_url = null;
        if (capturedLivePhotoBase64) {
          profile_image_url = capturedLivePhotoBase64;
        } else if (imageFile) {
          profile_image_url = await readFileAsBase64(imageFile);
        }

        await apiGmCreateBmc({
          name, district, location, contact_number,
          latitude, longitude, profile_image_url
        });

        if (typeof showToast === 'function') showToast('BMC Center created successfully!', 'success');
        resetFormAndCamera();
        closeModal();
        await loadBmcsData();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message || 'Failed to create BMC', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
