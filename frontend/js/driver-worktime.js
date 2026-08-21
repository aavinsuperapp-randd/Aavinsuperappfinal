// driver-worktime.js — Driver Work Time Page

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('driver');
  if (!profile) return;

  initializeSidebar();
  updateHeaderUI(profile);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  await loadWorkTime();
});

function initializeSidebar() {
  const sidebar = document.getElementById('driver-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !toggleBtn || !overlay) return;
  toggleBtn.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); });
  overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });
}

function updateHeaderUI(profile) {
  const name = profile.name || 'Driver';
  document.getElementById('header-driver-name').textContent = name;
  document.getElementById('header-avatar').textContent = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

async function loadWorkTime() {
  document.getElementById('wt-loading').classList.remove('hidden');
  document.getElementById('wt-content').classList.add('hidden');

  try {
    const data = await apiGetDriverWorkTime();
    document.getElementById('wt-loading').classList.add('hidden');
    document.getElementById('wt-content').classList.remove('hidden');

    // KPI Cards
    document.getElementById('wt-today-val').textContent = formatDuration(data.today_ms);
    document.getElementById('wt-today-trips').textContent = `${data.today_trips || 0} trip${data.today_trips !== 1 ? 's' : ''}`;
    document.getElementById('wt-week-val').textContent = formatDuration(data.week_ms);
    document.getElementById('wt-week-trips').textContent = `${data.week_trips || 0} trip${data.week_trips !== 1 ? 's' : ''}`;
    document.getElementById('wt-month-val').textContent = formatDuration(data.month_ms);
    document.getElementById('wt-month-trips').textContent = `${data.month_trips || 0} trip${data.month_trips !== 1 ? 's' : ''}`;

    // Daily breakdown
    renderDailyTable(data.daily_breakdown || []);
  } catch (err) {
    document.getElementById('wt-loading').classList.add('hidden');
    document.getElementById('wt-content').classList.remove('hidden');
    showToast(err.message || 'Failed to load work time.', 'error');
    // Show empty state
    renderDailyTable([]);
  }
}

function renderDailyTable(rows) {
  const tbody = document.getElementById('wt-table-body');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding:24px;">No completed trips this week.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${row.date_label || formatDate(row.date)}</td>
      <td>${row.trips_completed || 0}</td>
      <td><strong>${formatDuration(row.work_ms)}</strong></td>
      <td>${row.km_travelled ? Math.round(row.km_travelled) + ' km' : '—'}</td>
    </tr>
  `).join('');
}
