// gm-fleet.js — Fleet & Personnel Management Page Logic

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
    });
  });
}

async function loadFleetData() {
  try {
    const data = await apiGetGmDashboardV2();
    renderFleetPersonnel(data.workers || [], data.drivers || [], data.tankers || []);
  } catch (err) {
    console.error('Failed to load fleet data:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load fleet.', 'error');
  }
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
