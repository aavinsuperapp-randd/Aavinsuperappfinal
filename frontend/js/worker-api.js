// worker-api.js — All Worker Portal API calls
// Automatically attaches the Supabase JWT to every request.

async function getAuthToken() {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase not initialized.');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('No active session. Please log in.');
  return session.access_token;
}

async function workerFetch(path, options = {}) {
  const token = await getAuthToken();

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


// ─── Profile ──────────────────────────────────────────────────────────────────
async function apiGetProfile() {
  return workerFetch('/api/worker/profile');
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function apiGetStats() {
  return workerFetch('/api/worker/dashboard-stats');
}

// ─── Active Trip ──────────────────────────────────────────────────────────────
async function apiGetActiveTrip() {
  return workerFetch('/api/worker/active-trip');
}

// ─── Drivers & Tankers ───────────────────────────────────────────────────────
async function apiGetDrivers() {
  return workerFetch('/api/drivers');
}
async function apiGetTankers() {
  return workerFetch('/api/tankers');
}

// ─── BMC Search ──────────────────────────────────────────────────────────────
async function apiSearchBmcs(q = '') {
  return workerFetch(`/api/bmcs/search?q=${encodeURIComponent(q)}`);
}

// ─── Create BMC ─ DISABLED at backend (403 Forbidden) ─────────────────────
// Field Workers are no longer allowed to create BMC records.
// This function is kept for reference only — any call will receive a 403.
async function apiCreateBmc(body) {
  // This will receive: 403 Field Workers are no longer permitted to create BMC records.
  return workerFetch('/api/worker/create-bmc', { method: 'POST', body: JSON.stringify(body) });
}

// ─── Trips ─ DISABLED at backend (403 Forbidden) ───────────────────────────
// Workers cannot independently create trips. Trips are created by
// Transport Officers and assigned to workers by the P&I AGM.
async function apiCreateTrip(body) {
  // This will receive: 403 Workers cannot independently create trips.
  return workerFetch('/api/trips', { method: 'POST', body: JSON.stringify(body) });
}
async function apiGetTrips() {
  return workerFetch('/api/trips');
}
async function apiGetAssignedTrips() {
  return workerFetch('/api/worker/assigned-trips');
}
async function apiGetTrip(id) {
  return workerFetch(`/api/trips/${id}`);
}
async function apiCompleteTrip(id, body) {
  return workerFetch(`/api/trips/${id}/complete`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ─── BMC Visits ──────────────────────────────────────────────────────────────
async function apiAddBmcToTrip(tripId, bmcId) {
  return workerFetch(`/api/trips/${tripId}/visits`, { method: 'POST', body: JSON.stringify({ bmc_id: bmcId }) });
}
async function apiGetVisit(visitId) {
  return workerFetch(`/api/visits/${visitId}`);
}
async function apiUpdateVisit(visitId, body) {
  return workerFetch(`/api/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify(body) });
}
async function apiDeleteVisit(visitId) {
  return workerFetch(`/api/visits/${visitId}`, { method: 'DELETE' });
}



// ─── Tests ───────────────────────────────────────────────────────────────────
async function apiSaveFtir(visitId, body) {
  return workerFetch(`/api/visits/${visitId}/ftir`, { method: 'POST', body: JSON.stringify(body) });
}
async function apiSaveGerber(visitId, body) {
  return workerFetch(`/api/visits/${visitId}/gerber`, { method: 'POST', body: JSON.stringify(body) });
}

// ─── Requirements ────────────────────────────────────────────────────────────
async function apiSaveRequirements(visitId, body) {
  return workerFetch(`/api/visits/${visitId}/requirements`, { method: 'POST', body: JSON.stringify(body) });
}

// ─── Issues ──────────────────────────────────────────────────────────────────
async function apiAddIssue(visitId, body) {
  return workerFetch(`/api/visits/${visitId}/issues`, { method: 'POST', body: JSON.stringify(body) });
}
async function apiDeleteIssue(issueId) {
  return workerFetch(`/api/issues/${issueId}`, { method: 'DELETE' });
}

// ─── Rating ──────────────────────────────────────────────────────────────────
async function apiSaveRating(visitId, body) {
  return workerFetch(`/api/visits/${visitId}/rating`, { method: 'POST', body: JSON.stringify(body) });
}
