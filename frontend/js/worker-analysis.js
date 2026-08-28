// worker-analysis.js — Field Worker Portal Analysis Tab

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  const nameEl = document.getElementById('header-worker-name');
  if (nameEl) nameEl.textContent = profile.name || 'Field Worker';

  const avatarEl = document.getElementById('header-worker-avatar');
  if (avatarEl && profile.name) {
    const initials = profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials || 'FW';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  setupSidebarToggle();
  await loadAnalysisData();
});

async function loadAnalysisData() {
  const kpiVisitedEl = document.getElementById('kpi-visited-bmcs');
  const kpiDutiesEl = document.getElementById('kpi-completed-duties');
  const kpiTimeEl = document.getElementById('kpi-work-time');
  const tableBody = document.getElementById('analysis-table-body');

  try {
    const res = await apiGetWorkerAnalysis();
    const kpis = res.kpis || {};
    const trips = res.trips || [];

    if (kpiVisitedEl) kpiVisitedEl.textContent = kpis.total_bmcs_visited !== undefined ? kpis.total_bmcs_visited : '—';
    if (kpiDutiesEl) kpiDutiesEl.textContent = kpis.completed_trips !== undefined ? kpis.completed_trips : '—';
    if (kpiTimeEl) kpiTimeEl.textContent = kpis.work_time_formatted || '—';

    if (!tableBody) return;

    if (trips.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-5">
            <div style="font-size: 2rem; margin-bottom: 8px;">📊</div>
            <div style="font-weight: 700; color: #334155;">No Completed Duty Records</div>
            <div style="font-size: 0.85rem;">Completed trip analytics will automatically populate once duties are closed.</div>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = trips.map(t => `
      <tr>
        <td style="font-weight: 700; color: #0F172A;">${esc(t.route_description || t.trip_name || 'Duty')}</td>
        <td>${esc(t.driver_name || '—')}</td>
        <td><span class="badge badge-outline">${esc(t.tanker_number || '—')}</span></td>
        <td><strong style="color: #4F46E5;">${esc(t.work_time_formatted || '—')}</strong></td>
        <td><span class="badge badge-success">✓ ${t.visits_count || 0} BMCs</span></td>
        <td style="text-align: right; font-weight: 700; color: #0F172A;">${t.distance_km && t.distance_km !== '—' ? parseFloat(t.distance_km).toFixed(1) + ' KM' : '—'}</td>
      </tr>
    `).join('');

  } catch (err) {
    console.error('Failed to load worker analysis:', err);
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-4" style="color: #DC2626;">
            ⚠️ Failed to load analysis: ${esc(err.message || 'Server error')}
          </td>
        </tr>
      `;
    }
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setupSidebarToggle() {
  const sidebar = document.getElementById('worker-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      if (window.innerWidth > 900) {
        sidebar.classList.toggle('collapsed');
        const main = document.querySelector('.admin-main');
        if (main) main.classList.toggle('expanded');
      } else {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('show');
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
}
