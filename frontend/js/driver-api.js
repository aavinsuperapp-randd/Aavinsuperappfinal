// driver-api.js — Driver Portal API Helper Functions
// Uses the same pattern as transport-api.js

async function getDriverAuthToken() {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase not initialized.');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Not authenticated. Please log in.');
  return session.access_token;
}

async function driverFetch(path, options = {}) {
  const token = await getDriverAuthToken();
  const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;

  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is active at ${baseUrl}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ─── Dashboard ────────────────────────────────────────────────
async function apiGetDriverDashboard() {
  return driverFetch('/api/driver/dashboard');
}

// ─── Trips ────────────────────────────────────────────────────
async function apiGetDriverTrips() {
  return driverFetch('/api/driver/trips');
}

async function apiGetDriverTrip(tripId) {
  return driverFetch(`/api/driver/trips/${tripId}`);
}

async function apiAcceptTrip(tripId) {
  return driverFetch(`/api/driver/trips/${tripId}/accept`, { method: 'POST' });
}

async function apiStartTrip(tripId, payload) {
  return driverFetch(`/api/driver/trips/${tripId}/start`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function apiCompleteTrip(tripId, payload) {
  return driverFetch(`/api/driver/trips/${tripId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function apiUpdateTripLocation(tripId, payload) {
  return driverFetch(`/api/driver/trips/${tripId}/location`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// ─── History ──────────────────────────────────────────────────
async function apiGetDriverHistory(filters = {}) {
  const params = new URLSearchParams();
  if (filters.range) params.append('range', filters.range);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  const qs = params.toString() ? '?' + params.toString() : '';
  return driverFetch(`/api/driver/history${qs}`);
}

// ─── Work Time ─────────────────────────────────────────────────
async function apiGetDriverWorkTime() {
  return driverFetch('/api/driver/worktime');
}

// ─── Vehicle ──────────────────────────────────────────────────
async function apiGetAssignedVehicle() {
  return driverFetch('/api/driver/vehicle');
}

// ─── Photo Upload ─────────────────────────────────────────────
async function apiUploadDriverPhoto(imageBase64, filename) {
  return driverFetch('/api/driver/upload', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, filename })
  });
}

// ─── Utility Functions ────────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return Number(val).toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

// ─── Mileage Calculation (client-side for preview) ─────────────
function calculateMileage(outWeight, inWeight, outKm, inKm) {
  const weightDiff = Number(outWeight) - Number(inWeight);
  const kmTravelled = Number(inKm) - Number(outKm);

  if (weightDiff < 0) {
    return { error: 'In Weight cannot be greater than Out Weight.' };
  }
  if (kmTravelled < 0) {
    return { error: 'In KM cannot be less than Out KM.' };
  }
  if (weightDiff === 0) {
    return {
      weightDiff: 0,
      kmTravelled,
      dieselConsumption: 0,
      averageMileage: null,
      error: 'Mileage cannot be calculated: Weight difference is zero.'
    };
  }

  const dieselConsumption = weightDiff / 0.832;
  const averageMileage = dieselConsumption > 0 ? kmTravelled / dieselConsumption : null;

  return {
    weightDiff: Number(weightDiff.toFixed(4)),
    kmTravelled: Number(kmTravelled.toFixed(4)),
    dieselConsumption: Number(dieselConsumption.toFixed(4)),
    averageMileage: averageMileage !== null ? Number(averageMileage.toFixed(4)) : null
  };
}

// ─── Status Styling ──────────────────────────────────────────
function getStatusBadgeClass(status) {
  const map = {
    'assigned':   'badge-warning',
    'accepted':   'badge-info',
    'ready':      'badge-primary',
    'in_progress':'badge-active',
    'returning':  'badge-purple',
    'completed':  'badge-success',
    'cancelled':  'badge-neutral'
  };
  return map[status] || 'badge-neutral';
}

function getStatusLabel(status) {
  const map = {
    'assigned':   'Assigned',
    'accepted':   'Accepted',
    'ready':      'Ready to Start',
    'in_progress':'In Progress',
    'returning':  'Returning',
    'completed':  'Completed',
    'cancelled':  'Cancelled'
  };
  return map[status] || status;
}

// ─── GPS Helpers ──────────────────────────────────────────────
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Location permission denied. Please enable location access in your browser settings.'));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('Location unavailable. Please check your GPS/network.'));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('Location request timed out. Please try again.'));
        } else {
          reject(new Error('Unable to obtain location: ' + err.message));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

// ─── Toast (driver pages use supabase.js showToast) ──────────
// showToast() is already provided by supabase.js
