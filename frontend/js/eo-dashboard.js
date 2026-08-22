// eo-dashboard.js — Executive Officer Dashboard Overview Logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('executive_officer');
  if (!profile) return;

  const mainContent = document.getElementById('main-dashboard-content');
  if (mainContent) mainContent.classList.remove('hidden');

  const userDisplayName = document.getElementById('user-display-name');
  if (userDisplayName) userDisplayName.textContent = profile.name || 'Executive Officer';

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLogout();
    });
  }

  await loadEoDashboardData();
});

async function loadEoDashboardData() {
  try {
    const [dashRes, summaryRes] = await Promise.all([
      eoFetch('/api/eo/dashboard'),
      eoFetch('/api/eo/summary')
    ]);

    const summary = dashRes.summary || {};
    const bmcs = dashRes.bmcs || [];

    // Metric Cards
    if (document.getElementById('card-total-bmcs')) document.getElementById('card-total-bmcs').textContent = summary.total_assigned_bmcs || 0;
    if (document.getElementById('card-active-bmcs')) document.getElementById('card-active-bmcs').textContent = summary.active_bmcs || 0;
    if (document.getElementById('card-today-tests')) document.getElementById('card-today-tests').textContent = summary.todays_tests || 0;
    if (document.getElementById('card-quality-alerts')) document.getElementById('card-quality-alerts').textContent = summary.quality_alerts || 0;
    if (document.getElementById('card-total-reports')) document.getElementById('card-total-reports').textContent = summary.total_reports || 0;
    if (document.getElementById('card-pending-sub')) document.getElementById('card-pending-sub').textContent = `${summary.pending_reports || 0} pending review`;

    // Render Assigned BMC Cards
    renderAssignedBmcs(bmcs);

    // Render Charts
    renderQualityTrendChart(summaryRes.fatTrend || [], summaryRes.snfTrend || []);
    renderQualityDistChart(summaryRes.qualityDistribution || { pass: 0, warning: 0, fail: 0 });
  } catch (err) {
    console.error('Failed to load EO dashboard:', err);
    showToast(err.message || 'Failed to load dashboard data.', 'error');
  }
}

function renderAssignedBmcs(bmcs) {
  const container = document.getElementById('assigned-bmcs-container');
  if (!container) return;

  if (!bmcs || bmcs.length === 0) {
    container.innerHTML = `
      <div class="card p-4 text-center" style="grid-column: 1 / -1; background: #FFF; border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 8px;">🏭</div>
        <h4 style="margin: 0; font-weight: 800; color: #0F172A;">No BMCs Assigned</h4>
        <p style="color: #64748B; font-size: 0.88rem; margin-top: 4px; max-width: 450px; margin-left: auto; margin-right: auto;">
          You currently don't have any BMCs assigned. Please contact the system administrator to assign BMC centers to your account.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  bmcs.forEach(bmc => {
    const card = document.createElement('div');
    card.className = 'bmc-card';
    card.onclick = () => { window.location.href = `bmc.html?id=${bmc.id}`; };

    const lastTestText = bmc.latest_test_date ? new Date(bmc.latest_test_date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'No tests recorded';
    const lastReportText = bmc.latest_report_date ? new Date(bmc.latest_report_date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'No reports';

    card.innerHTML = `
      <div class="bmc-card-title">
        <span>🏭 ${bmc.name}</span>
        <span class="bmc-code-badge">${bmc.code}</span>
      </div>
      
      <div style="font-size: 0.82rem; color: #64748B; margin-top: 4px;">
        📍 ${bmc.location || 'Location'} • ${bmc.district || 'District'}
      </div>
      <div style="font-size: 0.78rem; color: #94A3B8; margin-top: 2px;">
        🏢 ${bmc.association_name || 'Milk Producers Association'}
      </div>

      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #F1F5F9;">
        <div class="bmc-info-row">
          <span>Status:</span>
          <span class="badge ${bmc.is_active ? 'badge-success' : 'badge-neutral'}" style="font-size: 0.72rem;">${bmc.status}</span>
        </div>
        <div class="bmc-info-row">
          <span>Workers:</span>
          <strong>${bmc.assigned_workers_count || 0} Field Workers</strong>
        </div>
        <div class="bmc-info-row">
          <span>Today's Tests:</span>
          <strong style="color: #2563EB;">${bmc.todays_test_count || 0} tests</strong>
        </div>
        <div class="bmc-info-row">
          <span>Latest Test:</span>
          <span style="font-size: 0.78rem; color: #334155;">${lastTestText}</span>
        </div>
        <div class="bmc-info-row">
          <span>Latest Report:</span>
          <span style="font-size: 0.78rem; color: #334155;">${lastReportText}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderQualityTrendChart(fatTrend, snfTrend) {
  const ctx = document.getElementById('chart-quality-trend');
  if (!ctx) return;

  const dates = fatTrend.map(f => f.date);
  const fatData = fatTrend.map(f => f.avgFat);
  const snfData = snfTrend.map(s => s.avgSnf);

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.length > 0 ? dates : ['Today'],
      datasets: [
        {
          label: 'Fat %',
          data: fatData.length > 0 ? fatData : [4.2],
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          tension: 0.3,
          fill: true
        },
        {
          label: 'SNF %',
          data: snfData.length > 0 ? snfData : [8.5],
          borderColor: '#16A34A',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: false, min: 2, max: 12 } }
    }
  });
}

function renderQualityDistChart(dist) {
  const ctx = document.getElementById('chart-quality-dist');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pass', 'Warning', 'Fail'],
      datasets: [{
        data: [dist.pass || 0, dist.warning || 0, dist.fail || 0],
        backgroundColor: ['#16A34A', '#D97706', '#DC2626']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}
