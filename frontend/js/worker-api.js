// worker-api.js — Field Worker Portal API Client

async function workerFetch(endpoint, options = {}) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase client not initialized.');

  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('No active session. Please log in.');

  const token = session.access_token;
  const baseUrl = endpoint.startsWith('http') ? '' : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com');
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

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
    throw new Error(`Server error (${res.status}). Ensure backend is active.`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// Fetch all Transport Manager created duties (supports single date or date range)
async function apiGetAssignedTrips(queryParam = '') {
  let queryStr = '';
  if (typeof queryParam === 'string' && queryParam) {
    queryStr = `?date=${encodeURIComponent(queryParam)}`;
  } else if (typeof queryParam === 'object' && queryParam) {
    const params = new URLSearchParams();
    if (queryParam.date) params.set('date', queryParam.date);
    if (queryParam.startDate) params.set('startDate', queryParam.startDate);
    if (queryParam.endDate) params.set('endDate', queryParam.endDate);
    queryStr = `?${params.toString()}`;
  }
  return workerFetch(`/api/worker/assigned-trips${queryStr}`);
}

// Fetch details for a specific Transport Manager duty/trip
async function apiGetTripDetails(tripId) {
  return workerFetch(`/api/trips/${tripId}`);
}

// Confirm and start trip
async function apiStartWorkerTrip(tripId, payload) {
  return workerFetch(`/api/trips/${tripId}/start-worker`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// Complete and close active trip
async function apiCompleteWorkerTrip(tripId, payload) {
  return workerFetch(`/api/trips/${tripId}/complete-worker`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// Edit existing completed trip metrics
async function apiEditWorkerTrip(tripId, payload) {
  return workerFetch(`/api/worker/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// Update worker active trip location points
async function apiUpdateWorkerTripLocation(tripId, payload) {
  return workerFetch(`/api/trips/${tripId}/location`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }).catch(() => {});
}

// Fetch single BMC Visit details
async function apiGetVisitDetails(visitId) {
  return workerFetch(`/api/visits/${visitId}`);
}

// Update BMC Visit Weight & Compartment
async function apiUpdateVisitWeight(visitId, payload) {
  return workerFetch(`/api/visits/${visitId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// Save FTIR Test Result
async function apiSaveFtirTest(visitId, payload) {
  return workerFetch(`/api/visits/${visitId}/ftir`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Save Gerber Test Result
async function apiSaveGerberTest(visitId, payload) {
  return workerFetch(`/api/visits/${visitId}/gerber`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Save Report / Issue
async function apiSaveReportIssue(visitId, payload) {
  return workerFetch(`/api/visits/${visitId}/issues`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Save Review / Rating
async function apiSaveReviewRating(visitId, payload) {
  return workerFetch(`/api/visits/${visitId}/rating`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Fetch Field Worker Analysis Analytics
async function apiGetWorkerAnalysis(startDate = '', endDate = '') {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  return workerFetch(`/api/worker/analysis?${params.toString()}`);
}


