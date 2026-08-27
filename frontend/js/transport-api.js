// transport-api.js — Transport Officer & Driver API Helper Functions

async function getTransportAuthToken() {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase not initialized.');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Not authenticated. Please log in.');
  return session.access_token;
}

async function transportFetch(path, options = {}) {
  const token = await getTransportAuthToken();

  const baseUrl = path.startsWith('http') ? '' : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com');
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
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is active at ${baseUrl || 'https://aavin-backend.onrender.com'}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/**
 * Get Transport Officer Dashboard Metrics
 */
async function apiGetTransportDashboard() {
  return transportFetch('/api/transport/dashboard');
}

/**
 * Get All Drivers (uses unified drivers list from profiles)
 */
async function apiGetDrivers() {
  return transportFetch('/api/transport/drivers-list');
}

/**
 * Create New Driver
 */
async function apiCreateDriver(driverData) {
  return transportFetch('/api/transport/drivers', {
    method: 'POST',
    body: JSON.stringify(driverData)
  });
}

/**
 * Update Driver
 */
async function apiUpdateDriver(driverId, driverData) {
  return transportFetch(`/api/transport/drivers/${driverId}`, {
    method: 'PUT',
    body: JSON.stringify(driverData)
  });
}

/**
 * Delete Driver
 */
async function apiDeleteDriver(driverId) {
  return transportFetch(`/api/transport/drivers/${driverId}`, {
    method: 'DELETE'
  });
}

/**
 * Get Driver Performance
 */
async function apiGetDriverPerformance(driverId) {
  return transportFetch(`/api/transport/drivers/${driverId}/performance`);
}

/**
 * Get All Vehicles
 */
async function apiGetVehicles() {
  return transportFetch('/api/transport/vehicles');
}

/**
 * Create New Vehicle
 */
async function apiCreateVehicle(vehicleData) {
  return transportFetch('/api/transport/vehicles', {
    method: 'POST',
    body: JSON.stringify(vehicleData)
  });
}

/**
 * Update Vehicle
 */
async function apiUpdateVehicle(vehicleId, vehicleData) {
  return transportFetch(`/api/transport/vehicles/${vehicleId}`, {
    method: 'PUT',
    body: JSON.stringify(vehicleData)
  });
}

/**
 * Delete Vehicle
 */
async function apiDeleteVehicle(vehicleId) {
  return transportFetch(`/api/transport/vehicles/${vehicleId}`, {
    method: 'DELETE'
  });
}

/**
 * Get Vehicle Performance
 */
async function apiGetVehiclePerformance(vehicleId) {
  return transportFetch(`/api/transport/vehicles/${vehicleId}/performance`);
}

/**
 * Get Duties (Worker Trips)
 */
async function apiGetDuties(filters = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.append('date', filters.date);
  if (filters.status) params.append('status', filters.status);
  if (filters.dateRange) params.append('dateRange', filters.dateRange);

  const url = `/api/transport/duties${params.toString() ? '?' + params.toString() : ''}`;
  return transportFetch(url);
}

/**
 * Get Driver Trips
 */
async function apiGetDriverTrips(filters = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.append('date', filters.date);
  if (filters.status) params.append('status', filters.status);
  
  const url = `/api/transport/driver-trips${params.toString() ? '?' + params.toString() : ''}`;
  return transportFetch(url);
}

/**
 * Get Single Driver Trip / Driver's Trips by ID
 */
async function apiGetDriverTrip(id) {
  return transportFetch(`/api/transport/driver-trips/${id}`);
}

/**
 * Create Driver Trip
 */
async function apiCreateDriverTrip(payload) {
  return transportFetch('/api/transport/driver-trips', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

/**
 * Delete Driver Trip (Duty)
 */
async function apiDeleteDriverTrip(tripId) {
  return transportFetch(`/api/transport/driver-trips/${tripId}`, {
    method: 'DELETE'
  });
}

/**
 * Get Drivers List for Assignment
 */
async function apiGetDriversList() {
  return transportFetch('/api/transport/drivers-list');
}

/**
 * Get BMCs List for Assignment
 * @param {string} [date] - Date in YYYY-MM-DD format
 * @param {string} [period] - 'morning', 'evening', or 'both'
 */
async function apiGetBmcsList(date, period) {
  const params = new URLSearchParams();
  if (date) params.append('date', date);
  if (period) params.append('period', period);
  const qs = params.toString();
  return transportFetch(`/api/transport/bmcs-list${qs ? '?' + qs : ''}`);
}


/**
 * Get Driver Analysis
 */
async function apiGetDriverAnalysis(driverId, startDate, endDate) {
  const params = new URLSearchParams({
    driverId,
    startDate,
    endDate
  });

  return transportFetch(`/api/transport/driver-analysis?${params.toString()}`);
}

/**
 * Format duration in milliseconds to readable string
 */
function formatDurationMs(ms) {
  if (!ms || ms < 0) return '—';
  
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Format date/time strings
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Create a trip to be assigned to a Field Worker by P&I AGM
 */
async function apiCreateTransportTrip(data) {
  return transportFetch('/api/transport/create-trip', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (container && typeof window.showToast === 'function' && window.showToast !== showToast) {
    window.showToast(message, type);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#2563EB'};
    color: white;
    border-radius: 12px;
    font-weight: 600;
    font-size: 0.9rem;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add animation styles
if (!document.getElementById('toast-styles')) {
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Fetch MACS Data Summary for Transport Officer
 */
async function apiFetchMacsSummary(params = {}) {
  const query = new URLSearchParams(params).toString();
  return transportFetch(`/api/transport/macs-summary${query ? '?' + query : ''}`);
}
