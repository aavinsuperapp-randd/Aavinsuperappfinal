// driver-trip.js — Driver Trip Management (Accept, Pre-Trip, Start, Complete, Mileage)

let currentProfile = null;
let currentTrip = null;
let tripId = null;
let outPhotoUrl = null;
let inPhotoUrl = null;
let startLocation = null;
let returnLocation = null;
let elapsedTimer = null;
let locationWatchId = null;
let isLocationTrackingActive = false;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('driver');
  if (!profile) return;

  currentProfile = profile;
  initializeSidebar();
  updateHeaderUI(profile);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Get tripId from URL params (optional)
  const params = new URLSearchParams(window.location.search);
  tripId = params.get('id');

  await loadTripPage();
});

function initializeSidebar() {
  const sidebar = document.getElementById('driver-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !toggleBtn || !overlay) return;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

function updateHeaderUI(profile) {
  const name = profile.name || 'Driver';
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('header-driver-name').textContent = name;
  document.getElementById('header-avatar').textContent = initials;
}

// ─── LOAD TRIP PAGE ──────────────────────────────────────────
async function loadTripPage() {
  showEl('loading-state');
  hideEl('no-trips-state');
  hideEl('trip-select-state');
  hideEl('trip-main-content');

  try {
    const data = await apiGetDriverTrips();
    const trips = (data.trips || []).filter(t => !['completed', 'cancelled'].includes(t.status) ||
      t.status === (tripId ? null : 'completed'));

    const allActiveTrips = (data.trips || []).filter(t => !['completed', 'cancelled'].includes(t.status));

    if (tripId) {
      // Load specific trip
      const tripData = await apiGetDriverTrip(tripId);
      currentTrip = tripData.trip;
      if (!currentTrip) {
        showEl('no-trips-state');
        hideEl('loading-state');
        return;
      }
    } else if (allActiveTrips.length === 0) {
      // No active trips
      hideEl('loading-state');
      showEl('no-trips-state');
      return;
    } else if (allActiveTrips.length === 1) {
      currentTrip = allActiveTrips[0];
      tripId = currentTrip.id;
    } else {
      // Multiple trips - show selection
      hideEl('loading-state');
      showEl('trip-select-state');
      renderTripSelectList(allActiveTrips);
      return;
    }

    hideEl('loading-state');
    renderTripInterface(currentTrip);

  } catch (err) {
    console.error('Load trip error:', err);
    hideEl('loading-state');
    showToast(err.message || 'Failed to load trip data.', 'error');
    showEl('no-trips-state');
  }
}

function renderTripSelectList(trips) {
  const list = document.getElementById('trip-select-list');
  list.innerHTML = trips.map(trip => `
    <button class="trip-select-btn" onclick="selectTrip('${trip.id}')">
      <span class="trip-select-title">${trip.trip_number || 'Trip'}</span>
      <span class="trip-select-sub">${trip.bmc_name || '—'} → ${trip.destination || '—'} | 
        <span class="badge ${getStatusBadgeClass(trip.status)} badge-sm">${getStatusLabel(trip.status)}</span>
      </span>
    </button>
  `).join('');
}

async function selectTrip(id) {
  tripId = id;
  try {
    const data = await apiGetDriverTrip(id);
    currentTrip = data.trip;
    hideEl('trip-select-state');
    renderTripInterface(currentTrip);
  } catch (err) {
    showToast(err.message || 'Failed to load trip.', 'error');
  }
}

// ─── RENDER TRIP INTERFACE ───────────────────────────────────
function renderTripInterface(trip) {
  showEl('trip-main-content');
  updateTripHeader(trip);

  // Hide all steps
  ['step-pretrip', 'step-active', 'step-complete-form', 'step-completed'].forEach(id => hideEl(id));

  switch (trip.status) {
    case 'assigned':
    case 'accepted':
    case 'ready':
    case 'in_progress':
    case 'returning':
    case 'completed':
      showEl('step-active');
      renderActiveTripState(trip);
      if (trip.started_at) startElapsedTimer(trip.started_at);
      break;
    case 'cancelled':
      document.getElementById('page-title').textContent = 'Trip Cancelled';
      showToast('This trip has been cancelled.', 'info');
      break;
    default:
      showEl('step-active');
      renderActiveTripState(trip);
  }
}

function updateTripHeader(trip) {
  setTextContent('trip-number-tag', trip.trip_number || 'Trip');
  setTextContent('trip-main-title', trip.route || 'Milk Collection Trip');
  setTextContent('trip-route-display', trip.route || '—');
  setTextContent('trip-vehicle', trip.vehicle_number || '—');
  setTextContent('trip-sched-start', formatDateTime(trip.scheduled_start_time || trip.created_at));
  const cleanRemarks = (trip.remarks || 'None').split('__BMC_DATA__=')[0].trim();
  setTextContent('trip-remarks', cleanRemarks || 'None');

  const seqList = document.getElementById('trip-bmc-sequence-list');
  if (seqList) {
    if (trip.bmc_name) {
      const visits = trip.bmc_name.split(' | ');
      seqList.innerHTML = visits.map(v => `
        <div style="font-size:0.88rem; font-weight:600; color:#0F172A; display:flex; align-items:center; gap:6px;">
          <span>📍</span> ${v}
        </div>
      `).join('');
    } else {
      seqList.innerHTML = '<span style="font-size:0.85rem; color:#64748B;">No BMC sequence specified</span>';
    }
  }

  const statusBadge = document.getElementById('trip-status-badge');
  statusBadge.className = `trip-status-badge`;
  setTextContent('trip-status-text', getStatusLabel(trip.status));

  const dot = statusBadge.querySelector('.status-dot');
  if (dot) {
    const dotMap = { 'assigned': 'orange', 'accepted': 'orange', 'in_progress': 'red', 'returning': 'blue', 'completed': '' };
    dot.className = `status-dot ${dotMap[trip.status] || ''}`;
  }
}

// ─── STEP 2: PRE-TRIP FORM ───────────────────────────────────
function setupPreTripForm() {
  // Live validation on input
  document.getElementById('input-out-km').addEventListener('input', validatePreTripForm);
  document.getElementById('input-out-weight').addEventListener('input', validatePreTripForm);

  // Location
  const startLocBtn = document.getElementById('btn-get-start-location');
  if (startLocBtn) {
    startLocBtn.addEventListener('click', getStartLocation);
  }

  // Start Trip Button
  document.getElementById('btn-start-trip').addEventListener('click', handleStartTrip);

  validatePreTripForm();
}

function validatePreTripForm() {
  const outKm = document.getElementById('input-out-km').value;
  const outWeight = document.getElementById('input-out-weight').value;

  const checks = {
    'check-out-km': !!outKm && Number(outKm) >= 0,
    'check-out-weight': !!outWeight && Number(outWeight) > 0,
    'check-out-location': startLocation !== null
  };

  for (const [id, done] of Object.entries(checks)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (done) {
      el.classList.add('done');
      el.querySelector('.check-icon').textContent = '✅';
    } else {
      el.classList.remove('done');
      el.querySelector('.check-icon').textContent = '⭕';
    }
  }

  const allDone = Object.values(checks).every(Boolean);
  const startBtn = document.getElementById('btn-start-trip');
  const hint = document.getElementById('start-trip-hint');

  startBtn.disabled = !allDone;
  if (allDone) {
    hint.textContent = 'All checks complete. You can start the trip!';
    hint.className = 'start-trip-hint ready';
  } else {
    hint.textContent = 'Complete all required fields above to enable.';
    hint.className = 'start-trip-hint';
  }
}


async function getStartLocation() {
  const btn = document.getElementById('btn-get-start-location');
  const statusBox = document.getElementById('start-location-status-box');
  const statusText = document.getElementById('start-location-text');
  const coordsEl = document.getElementById('start-location-coords');
  const errorEl = document.getElementById('start-location-error-msg');

  btn.disabled = true;
  btn.textContent = '📡 Getting location...';
  statusText.textContent = 'Requesting location...';
  statusBox.className = 'location-status-box';
  errorEl.classList.add('hidden');

  try {
    const loc = await getCurrentLocation();
    startLocation = loc;

    statusBox.classList.add('granted');
    statusText.textContent = '✅ Location permission granted';
    document.getElementById('start-location-icon').textContent = '✅';
    document.getElementById('start-lat').textContent = loc.lat.toFixed(6);
    document.getElementById('start-lng').textContent = loc.lng.toFixed(6);
    coordsEl.classList.remove('hidden');
    btn.textContent = '📡 Update Location';
    btn.disabled = false;
    showToast('Location captured successfully.', 'success');
    validatePreTripForm();

  } catch (err) {
    statusBox.classList.add('denied');
    statusText.textContent = '❌ ' + err.message;
    document.getElementById('start-location-icon').textContent = '❌';
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.textContent = '📡 Capture Current Location';
    btn.disabled = false;
    showToast(err.message, 'error');
  }
}

async function handleStartTrip() {
  const btn = document.getElementById('btn-start-trip');
  if (btn.disabled) return;

  const outKm = parseFloat(document.getElementById('input-out-km').value);
  const outWeight = parseFloat(document.getElementById('input-out-weight').value);

  // Validate
  if (isNaN(outKm) || outKm < 0) { showToast('Please enter a valid Out KM reading.', 'error'); return; }
  if (isNaN(outWeight) || outWeight <= 0) { showToast('Please enter a valid Out Tanker Weight.', 'error'); return; }
  if (!startLocation) { showToast('Please capture your current GPS location.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Starting Trip...';

  try {
    const payload = {
      out_km: outKm,
      out_tanker_weight: outWeight,
      latitude: startLocation.lat,
      longitude: startLocation.lng
    };

    await apiStartTrip(tripId, payload);
    showToast('Trip started successfully! Drive safe! 🚛', 'success');

    // Reload
    const data = await apiGetDriverTrip(tripId);
    currentTrip = data.trip;
    renderTripInterface(currentTrip);

  } catch (err) {
    console.error('Start trip error:', err);
    showToast(err.message || 'Failed to start trip.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>🚀</span> CONFIRM START TRIP';
  }
}

// ─── STEP 3: ACTIVE TRIP ─────────────────────────────────────
function renderActiveTripState(trip) {
  document.getElementById('active-start-time').textContent = formatTime(trip.started_at);
  document.getElementById('active-out-km').textContent = trip.out_km ? `${trip.out_km} km` : '—';
  document.getElementById('active-out-weight').textContent = trip.out_weight ? `${trip.out_weight.toLocaleString('en-IN')} kg` : '—';

  startLocationTracking();
}

let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch(e) {}
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    try { wakeLock.release(); } catch(e) {}
    wakeLock = null;
  }
}

function getOfflineGpsQueueKey() {
  return `driver_offline_gps_queue_${tripId || 'general'}`;
}

function getOfflineGpsQueue() {
  try {
    const raw = localStorage.getItem(getOfflineGpsQueueKey());
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveOfflineGpsQueue(queue) {
  try {
    localStorage.setItem(getOfflineGpsQueueKey(), JSON.stringify(queue));
  } catch(e) {}
}

async function flushOfflineGpsQueue() {
  const queue = getOfflineGpsQueue();
  if (queue.length === 0 || !tripId) return;

  try {
    await apiUpdateTripLocation(tripId, { points: queue });
    localStorage.removeItem(getOfflineGpsQueueKey());
    console.log('✅ Auto-synced', queue.length, 'offline GPS points.');
  } catch(err) {
    console.warn('Sync failed, retaining queue:', err.message);
  }
}

// Auto-sync when device comes back online or tab becomes visible
window.addEventListener('online', flushOfflineGpsQueue);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) flushOfflineGpsQueue();
});

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let silentAudioInterval = null;
let audioCtx = null;

function startSilentAudioLoop() {
  if (silentAudioInterval) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioCtx = new AudioContext();
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    
    const playSilence = () => {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start();
    };

    silentAudioInterval = setInterval(playSilence, 1000);
    
    const resumeHandler = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      document.removeEventListener('click', resumeHandler);
      document.removeEventListener('touchstart', resumeHandler);
    };
    document.addEventListener('click', resumeHandler);
    document.addEventListener('touchstart', resumeHandler);
  } catch (e) {
    console.warn('Silent audio loop failed:', e);
  }
}

function stopSilentAudioLoop() {
  if (silentAudioInterval) {
    clearInterval(silentAudioInterval);
    silentAudioInterval = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}

let fallbackLocationInterval = null;

function startFallbackLocationTracking() {
  if (fallbackLocationInterval) return;
  fallbackLocationInterval = setInterval(() => {
    if (!navigator.geolocation || !isLocationTrackingActive) return;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const pt = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: new Date().toISOString()
        };
        const queue = getOfflineGpsQueue();
        if (queue.length > 0) {
          const lastPt = queue[queue.length - 1];
          const dist = calculateDistanceMeters(lastPt.lat, lastPt.lng, pt.lat, pt.lng);
          const timeDiffMs = new Date(pt.timestamp).getTime() - new Date(lastPt.timestamp || 0).getTime();
          if (dist >= 5 || timeDiffMs >= 30000) {
            queue.push(pt);
            saveOfflineGpsQueue(queue);
          }
        } else {
          queue.push(pt);
          saveOfflineGpsQueue(queue);
        }

        const locTextEl = document.getElementById('active-location-text');
        const locTimeEl = document.getElementById('active-location-time');
        if (locTextEl) locTextEl.textContent = `Location (F): ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;
        if (locTimeEl) locTimeEl.textContent = `Updated: ${formatTime(pt.timestamp)}`;

        await flushOfflineGpsQueue();
      },
      (error) => {
        console.warn('Fallback background geolocation capture failed:', error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, 10000);
}

function stopFallbackLocationTracking() {
  if (fallbackLocationInterval) {
    clearInterval(fallbackLocationInterval);
    fallbackLocationInterval = null;
  }
}

async function startLocationTracking() {
  if (locationWatchId) return;
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }
  isLocationTrackingActive = true;
  await requestWakeLock();
  startSilentAudioLoop();
  startFallbackLocationTracking();
  await flushOfflineGpsQueue();

  locationWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const pt = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        timestamp: new Date().toISOString()
      };

      // Queue point locally first for offline safety
      const queue = getOfflineGpsQueue();
      queue.push(pt);
      saveOfflineGpsQueue(queue);

      const locTextEl = document.getElementById('active-location-text');
      const locTimeEl = document.getElementById('active-location-time');
      if (locTextEl) locTextEl.textContent = `Location: ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;
      if (locTimeEl) locTimeEl.textContent = `Updated: ${formatTime(pt.timestamp)}`;

      // Attempt sync
      await flushOfflineGpsQueue();
    },
    async (error) => {
      console.error('Location tracking error:', error);
      if (isLocationTrackingActive) {
        isLocationTrackingActive = false;
        try { await apiUpdateTripLocation(tripId, { tracking_status: 'Location Lost' }); } catch(e) {}
        showToast('Location access lost. GPS points will be queued until restored.', 'error');
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

function stopLocationTracking() {
  isLocationTrackingActive = false;
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  stopSilentAudioLoop();
  stopFallbackLocationTracking();
  releaseWakeLock();
  flushOfflineGpsQueue();
}

function startElapsedTimer(startedAt) {
  if (elapsedTimer) clearInterval(elapsedTimer);
  if (!startedAt) {
    document.getElementById('active-elapsed').textContent = '—';
    return;
  }

  const startMs = new Date(startedAt).getTime();
  const updateElapsed = () => {
    const elapsed = Date.now() - startMs;
    document.getElementById('active-elapsed').textContent = elapsed > 0 ? formatDuration(elapsed) : '—';
  };

  updateElapsed();
  elapsedTimer = setInterval(updateElapsed, 60000);
}

function setupCompleteBtn() {
  document.getElementById('btn-show-complete').addEventListener('click', () => {
    hideEl('step-active');
    showEl('step-complete-form');
    setupCompleteTripForm();
    if (elapsedTimer) clearInterval(elapsedTimer);
  });
}

// ─── STEP 4: COMPLETE FORM ───────────────────────────────────
function setupCompleteTripForm() {
  // Back button
  document.getElementById('btn-cancel-complete').addEventListener('click', () => {
    hideEl('step-complete-form');
    showEl('step-active');
    startElapsedTimer(currentTrip?.started_at);
  });

  // In KM/Weight live mileage preview
  document.getElementById('input-in-km').addEventListener('input', updateMileagePreview);
  document.getElementById('input-in-weight').addEventListener('input', updateMileagePreview);



  // Return location
  document.getElementById('btn-get-return-location').addEventListener('click', getReturnLocation);

  // Complete trip
  document.getElementById('btn-complete-trip').addEventListener('click', handleCompleteTrip);

  // Pre-fill out_km for reference
  if (currentTrip?.out_km) {
    document.getElementById('input-in-km').placeholder = `Must be ≥ ${currentTrip.out_km} (Out: ${currentTrip.out_km})`;
  }
  if (currentTrip?.out_weight) {
    document.getElementById('input-in-weight').placeholder = `Must be ≤ ${currentTrip.out_weight} (Out: ${currentTrip.out_weight} kg)`;
  }
}

function updateMileagePreview() {
  const inKm = parseFloat(document.getElementById('input-in-km').value);
  const inWeight = parseFloat(document.getElementById('input-in-weight').value);
  const outKm = currentTrip?.out_km;
  const outWeight = currentTrip?.out_weight;

  const previewEl = document.getElementById('mileage-preview');
  const errorEl = document.getElementById('mileage-error');
  const kmValidation = document.getElementById('km-validation-msg');
  const weightValidation = document.getElementById('weight-validation-msg');

  // Reset validation messages
  kmValidation.textContent = '';
  kmValidation.className = 'form-hint-driver';
  weightValidation.textContent = '';
  weightValidation.className = 'form-hint-driver';

  if (!inKm || !inWeight || !outKm || !outWeight) {
    previewEl.classList.add('hidden');
    return;
  }

  // KM validation
  if (inKm < outKm) {
    kmValidation.textContent = `⚠️ In KM (${inKm}) cannot be less than Out KM (${outKm}).`;
    kmValidation.className = 'form-hint-driver error-msg';
    previewEl.classList.add('hidden');
    return;
  }

  // Weight validation
  if (inWeight > outWeight) {
    weightValidation.textContent = `⚠️ In Weight (${inWeight}) cannot exceed Out Weight (${outWeight} kg).`;
    weightValidation.className = 'form-hint-driver error-msg';
    previewEl.classList.add('hidden');
    return;
  }

  const calc = calculateMileage(outWeight, inWeight, outKm, inKm);

  previewEl.classList.remove('hidden');
  errorEl.classList.add('hidden');

  if (calc.error) {
    errorEl.textContent = calc.error;
    errorEl.classList.remove('hidden');
    document.getElementById('prev-weight-diff').textContent = calc.weightDiff ?? '—';
    document.getElementById('prev-diesel').textContent = '—';
    document.getElementById('prev-km').textContent = `${calc.kmTravelled ?? '—'} km`;
    document.getElementById('prev-mileage').textContent = '—';
    return;
  }

  document.getElementById('prev-weight-diff').textContent = `${formatNumber(calc.weightDiff, 2)} kg`;
  document.getElementById('prev-diesel').textContent = formatNumber(calc.dieselConsumption, 2);
  document.getElementById('prev-km').textContent = `${formatNumber(calc.kmTravelled, 2)} km`;
  document.getElementById('prev-mileage').textContent = calc.averageMileage !== null ? `${formatNumber(calc.averageMileage, 3)} km/unit` : '—';
}

async function getReturnLocation() {
  const btn = document.getElementById('btn-get-return-location');
  const statusBox = document.getElementById('return-location-status-box');
  const statusText = document.getElementById('return-location-text');
  const coordsEl = document.getElementById('return-location-coords');

  btn.disabled = true;
  btn.textContent = '📡 Getting location...';
  statusText.textContent = 'Requesting location...';

  try {
    const loc = await getCurrentLocation();
    returnLocation = loc;

    statusBox.classList.add('granted');
    statusText.textContent = '✅ Return location captured';
    document.getElementById('return-location-icon').textContent = '✅';
    document.getElementById('ret-lat').textContent = loc.lat.toFixed(6);
    document.getElementById('ret-lng').textContent = loc.lng.toFixed(6);
    coordsEl.classList.remove('hidden');
    btn.textContent = '📡 Update Location';
    btn.disabled = false;
    showToast('Return location captured.', 'success');

  } catch (err) {
    statusBox.classList.add('denied');
    statusText.textContent = '❌ ' + err.message;
    document.getElementById('return-location-icon').textContent = '❌';
    btn.textContent = '📡 Capture Return Location';
    btn.disabled = false;
    showToast(err.message, 'error');
  }
}

async function handleCompleteTrip() {
  const btn = document.getElementById('btn-complete-trip');
  if (btn.disabled) return;

  const inKm = parseFloat(document.getElementById('input-in-km').value);
  const inWeight = parseFloat(document.getElementById('input-in-weight').value);
  const remarks = document.getElementById('input-remarks').value.trim();

  const outKm = currentTrip?.out_km;
  const outWeight = currentTrip?.out_weight;

  // Validate
  if (!inKm || inKm < 0) { showToast('Please enter a valid In KM reading.', 'error'); return; }
  if (!inWeight || inWeight < 0) { showToast('Please enter a valid In Weight.', 'error'); return; }
  if (outKm !== null && outKm !== undefined && inKm < outKm) {
    showToast(`In KM (${inKm}) cannot be less than Out KM (${outKm}).`, 'error'); return;
  }
  if (outWeight !== null && outWeight !== undefined && inWeight > outWeight) {
    showToast(`In Weight (${inWeight}) cannot exceed Out Weight (${outWeight} kg).`, 'error'); return;
  }
  if (!returnLocation) { showToast('Please capture your return location.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Completing Trip...';

  try {
    const payload = {
      in_km: inKm,
      in_weight: inWeight,
      end_lat: returnLocation.lat,
      end_lng: returnLocation.lng,
      remarks
    };

    const result = await apiCompleteTrip(tripId, payload);
    showToast('Trip completed successfully! 🎉', 'success');

    stopLocationTracking();

    currentTrip = result.trip;
    hideEl('step-complete-form');
    showEl('step-completed');
    renderCompletionResult(currentTrip);

  } catch (err) {
    console.error('Complete trip error:', err);
    showToast(err.message || 'Failed to complete trip.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>✅</span> COMPLETE TRIP';
  }
}

// ─── STEP 5: COMPLETION RESULT ────────────────────────────────
function renderCompletionResult(trip) {
  setTextContent('res-out-weight', trip.out_weight ? `${formatNumber(trip.out_weight, 2)} kg` : '—');
  setTextContent('res-in-weight', trip.in_weight ? `${formatNumber(trip.in_weight, 2)} kg` : '—');
  setTextContent('res-weight-diff', trip.weight_difference ? `${formatNumber(trip.weight_difference, 2)} kg` : '—');
  setTextContent('res-diesel', trip.diesel_consumption ? formatNumber(trip.diesel_consumption, 2) : '—');
  setTextContent('res-out-km', trip.out_km ? formatNumber(trip.out_km, 1) : '—');
  setTextContent('res-in-km', trip.in_km ? formatNumber(trip.in_km, 1) : '—');
  setTextContent('res-km-travelled', trip.km_travelled ? `${formatNumber(trip.km_travelled, 1)} km` : '—');

  if (trip.average_mileage !== null && trip.average_mileage !== undefined) {
    setTextContent('res-mileage', `${formatNumber(trip.average_mileage, 3)} km/unit`);
  } else {
    setTextContent('res-mileage', 'N/A');
  }

  // Duration
  if (trip.started_at && trip.completed_at) {
    const durationMs = new Date(trip.completed_at) - new Date(trip.started_at);
    setTextContent('res-duration', formatDuration(durationMs));
  } else {
    setTextContent('res-duration', '—');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────
function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
