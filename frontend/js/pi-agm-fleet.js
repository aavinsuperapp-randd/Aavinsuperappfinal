document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  if (document.getElementById('header-pi-agm-name')) {
    document.getElementById('header-pi-agm-name').textContent = profile.name || 'P&I AGM';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  setupFleetTabs();
  await loadFleetData();
  setupMileageTab();
});

function setupFleetTabs() {
  document.querySelectorAll('.fleet-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.fleet-tab-btn');
      if (!tabBtn) return;

      document.querySelectorAll('.fleet-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.fleet-tab-content').forEach(c => c.classList.add('hidden'));

      tabBtn.classList.add('active');
      const targetId = tabBtn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.remove('hidden');

      if (targetId === 'tab-mileage') {
        loadMileageData();
      }
    });
  });
}

async function loadFleetData() {
  try {
    const data = await apiGetGmDashboardV2();
    renderFleetPersonnel(data.workers || [], data.drivers || [], data.tankers || []);
    populateMileageFilterDropdowns(data.drivers || [], data.tankers || []);
  } catch (err) {
    console.error('Failed to load fleet data:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load fleet.', 'error');
  }
}

function populateMileageFilterDropdowns(drivers = [], tankers = []) {
  const dSelect = document.getElementById('mileage-filter-driver');
  const vSelect = document.getElementById('mileage-filter-vehicle');

  if (dSelect) {
    dSelect.innerHTML = '<option value="all">All Drivers</option>' +
      drivers.map(d => `<option value="${d.id || d.name}">${esc(d.name)}</option>`).join('');
  }

  if (vSelect) {
    vSelect.innerHTML = '<option value="all">All Vehicles</option>' +
      tankers.map(t => `<option value="${t.id || t.board_number}">${esc(t.board_number)}</option>`).join('');
  }
}

function setupMileageTab() {
  const filterBtn = document.getElementById('btn-filter-mileage');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => loadMileageData());
  }
}

async function loadMileageData() {
  const mBody = document.getElementById('mileage-table-body');
  if (mBody) mBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">⏳ Loading mileage data...</td></tr>`;

  const fromDate = document.getElementById('mileage-from-date')?.value || '';
  const toDate = document.getElementById('mileage-to-date')?.value || '';
  const statusFilter = document.getElementById('mileage-filter-status')?.value || 'all';
  const driverId = document.getElementById('mileage-filter-driver')?.value || 'all';
  const vehicleId = document.getElementById('mileage-filter-vehicle')?.value || 'all';

  try {
    const token = await getPiAgmAuthToken();
    const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';

    const url = `${baseUrl}/api/pi-agm/mileage?status_filter=${statusFilter}&from_date=${fromDate}&to_date=${toDate}&driver_id=${driverId}&vehicle_id=${vehicleId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load mileage metrics');

    renderMileageMetrics(data.summary || {}, data.records || []);
  } catch (err) {
    console.error('Error loading mileage:', err);
    if (mBody) mBody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding:20px; color:#DC2626;">Error: ${esc(err.message)}</td></tr>`;
  }
}

function renderMileageMetrics(summary = {}, records = []) {
  if (document.getElementById('mileage-stat-distance')) {
    document.getElementById('mileage-stat-distance').textContent = `${(summary.total_distance_km || 0).toLocaleString()} KM`;
  }
  if (document.getElementById('mileage-stat-diesel')) {
    document.getElementById('mileage-stat-diesel').textContent = `${(summary.total_diesel_litres || 0).toLocaleString()} Litres`;
  }
  if (document.getElementById('mileage-stat-avg')) {
    document.getElementById('mileage-stat-avg').textContent = `${summary.average_mileage_kml || 0} KM/L`;
  }

  const mBody = document.getElementById('mileage-table-body');
  if (!mBody) return;

  if (records.length === 0) {
    mBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No trip mileage records found for the selected filters.</td></tr>`;
    return;
  }

  mBody.innerHTML = records.map(r => {
    const isDone = r.status === 'Done';
    const distText = r.distance_km === 'Pending' || r.distance_km === null ? '<span style="color:#94A3B8; font-style:italic;">Pending</span>' : `<strong style="color:#2563EB;">${r.distance_km} KM</strong>`;
    const dieselText = r.diesel_litres === 'Pending' || r.diesel_litres === null ? '<span style="color:#94A3B8; font-style:italic;">Pending</span>' : `<strong style="color:#D97706;">${r.diesel_litres} L</strong>`;
    const mileageBadge = r.mileage_kml === 'Pending' || r.mileage_kml === null 
      ? '<span style="background:#F1F5F9; color:#64748B; padding:4px 8px; border-radius:6px; font-weight:600; font-size:0.8rem;">Pending</span>'
      : `<span class="status-badge active" style="font-weight:800; background:#ECFDF5; color:#059669; padding:4px 8px; border-radius:6px;">${r.mileage_kml} KM/L</span>`;

    const statusBadge = isDone
      ? '<span style="background:#DCFCE7; color:#15803D; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:12px;">✅ Done</span>'
      : '<span style="background:#FEF3C7; color:#B45309; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:12px;">🚚 In Transit</span>';

    return `
      <tr>
        <td>${esc(r.date)} ${statusBadge}</td>
        <td><strong>${esc(r.trip_number)}</strong></td>
        <td><span class="badge badge-neutral">${esc(r.vehicle_number)}</span></td>
        <td><strong>${esc(r.driver_name)}</strong></td>
        <td>${r.out_km !== null && r.out_km !== undefined ? r.out_km : 'Pending'}</td>
        <td>${r.in_km !== null && r.in_km !== undefined ? r.in_km : 'Pending'}</td>
        <td>${distText}</td>
        <td>${dieselText}</td>
        <td>${mileageBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderFleetPersonnel(workers = [], drivers = [], tankers = []) {
  if (document.getElementById('count-workers')) document.getElementById('count-workers').textContent = workers.length;
  if (document.getElementById('count-drivers')) document.getElementById('count-drivers').textContent = drivers.length;
  if (document.getElementById('count-vehicles')) document.getElementById('count-vehicles').textContent = tankers.length;

  // Workers
  const wBody = document.getElementById('workers-table-body');
  if (wBody) {
    if (workers.length === 0) {
      wBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No workers found.</td></tr>`;
    } else {
      wBody.innerHTML = workers.map(w => `
        <tr>
          <td><strong>${esc(w.name)}</strong></td>
          <td>${esc(w.email)}</td>
          <td><span class="badge badge-neutral">${esc(w.role || 'Worker')}</span></td>
          <td><span class="status-badge completed">${esc(w.status)}</span></td>
          <td>${w.trips_today || 0}</td>
          <td><span class="status-badge ${w.current_trip ? 'active' : 'pending'}">${w.current_trip ? 'In-Transit' : 'Idle'}</span></td>
        </tr>
      `).join('');
    }
  }

  // Drivers
  const dBody = document.getElementById('drivers-table-body');
  if (dBody) {
    if (drivers.length === 0) {
      dBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No registered drivers.</td></tr>`;
    } else {
      dBody.innerHTML = drivers.map(d => `
        <tr>
          <td><strong>${esc(d.name)}</strong></td>
          <td>${esc(d.phone || '—')}</td>
          <td>${esc(d.license_number || '—')}</td>
          <td><span class="status-badge ${d.is_active ? 'completed' : 'cancelled'}">${d.is_active ? 'Active' : 'Inactive'}</span></td>
        </tr>
      `).join('');
    }
  }

  // Vehicles
  const vBody = document.getElementById('vehicles-table-body');
  if (vBody) {
    if (tankers.length === 0) {
      vBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No vehicles registered.</td></tr>`;
    } else {
      vBody.innerHTML = tankers.map(t => `
        <tr>
          <td><strong>${esc(t.board_number)}</strong></td>
          <td>${(t.capacity_liters || 5000).toLocaleString()} L</td>
          <td><span class="status-badge ${t.is_active ? 'completed' : 'cancelled'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
        </tr>
      `).join('');
    }
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
