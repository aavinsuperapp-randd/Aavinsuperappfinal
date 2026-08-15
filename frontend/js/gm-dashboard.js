// gm-dashboard.js — GM 7-Day Dashboard Logic

let tripsChartInstance = null;
let visitsChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('gm');
  if (!profile) return;

  document.getElementById('main-gm-content').classList.remove('hidden');
  document.getElementById('header-gm-name').textContent = profile.name;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-dashboard-btn').addEventListener('click', loadDashboardData);

  await loadDashboardData();
});

async function loadDashboardData() {
  try {
    const data = await apiGetGmDashboard();
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to load GM Dashboard:', err);
    showToast(err.message || 'Failed to load GM Dashboard metrics.', 'error');
  }
}

function renderDashboard(data) {
  const { period, kpis, quality_summary, issue_summary, daily_trends, bmc_rankings } = data;

  // Period display
  document.getElementById('period-display-range').textContent = period.label || 'LAST 7 DAYS';

  // KPIs
  document.getElementById('kpi-total-trips').textContent = kpis.total_trips;
  document.getElementById('kpi-completed-trips').textContent = kpis.completed_trips;
  document.getElementById('kpi-active-trips').textContent = kpis.active_trips;
  document.getElementById('kpi-total-visits').textContent = kpis.total_bmc_visits;
  document.getElementById('kpi-total-ftir').textContent = kpis.total_ftir;
  document.getElementById('kpi-total-gerber').textContent = kpis.total_gerber;
  document.getElementById('kpi-total-issues').textContent = kpis.total_issues;
  document.getElementById('kpi-pending-corrections').textContent = kpis.pending_corrections;

  // Render Charts
  renderTripsChart(daily_trends);
  renderVisitsChart(daily_trends);

  // Quality Testing Bars
  renderQualitySummary(quality_summary);

  // Issue Summary
  renderIssueSummary(issue_summary);

  // BMC Rankings
  renderBmcRankings(bmc_rankings);
}

function renderTripsChart(daily_trends) {
  const ctx = document.getElementById('tripsChart').getContext('2d');
  const labels = daily_trends.map(d => d.label);
  const dataValues = daily_trends.map(d => d.trips);

  if (tripsChartInstance) tripsChartInstance.destroy();

  tripsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Trips',
        data: dataValues,
        backgroundColor: '#2563EB',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Trips: ${ctx.parsed.y}`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderVisitsChart(daily_trends) {
  const ctx = document.getElementById('visitsChart').getContext('2d');
  const labels = daily_trends.map(d => d.label);
  const dataValues = daily_trends.map(d => d.visits);

  if (visitsChartInstance) visitsChartInstance.destroy();

  visitsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'BMC Visits',
        data: dataValues,
        backgroundColor: '#10B981',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Visits: ${ctx.parsed.y}`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderQualitySummary(qs) {
  const ftirTotalEl = document.getElementById('ftir-total-count');
  if (!ftirTotalEl) return; // section removed

  const ftirTotal = qs.ftir.pass + qs.ftir.warning + qs.ftir.fail;
  ftirTotalEl.textContent = ftirTotal;
  const ftirProgress = document.getElementById('ftir-progress-bar');
  const ftirLegend = document.getElementById('ftir-legend');

  if (ftirTotal === 0) {
    if (ftirProgress) ftirProgress.innerHTML = `<div style="width:100%; background:var(--gray-200);"></div>`;
    if (ftirLegend) ftirLegend.innerHTML = `<span class="text-muted">No FTIR tests recorded in last 7 days</span>`;
  } else {
    const pPct = (qs.ftir.pass / ftirTotal) * 100;
    const wPct = (qs.ftir.warning / ftirTotal) * 100;
    const fPct = (qs.ftir.fail / ftirTotal) * 100;
    if (ftirProgress) {
      ftirProgress.innerHTML = `
        <div class="qp-pass" style="width:${pPct}%;"></div>
        <div class="qp-warn" style="width:${wPct}%;"></div>
        <div class="qp-fail" style="width:${fPct}%;"></div>
      `;
    }
    if (ftirLegend) {
      ftirLegend.innerHTML = `
        <span style="color:#10B981; font-weight:600;">Pass: ${qs.ftir.pass}</span>
        <span style="color:#F59E0B; font-weight:600;">Warn: ${qs.ftir.warning}</span>
        <span style="color:#EF4444; font-weight:600;">Fail: ${qs.ftir.fail}</span>
      `;
    }
  }

  // Gerber
  const gerberTotalEl = document.getElementById('gerber-total-count');
  if (gerberTotalEl) {
    const gerberTotal = qs.gerber.pass + qs.gerber.warning + qs.gerber.fail;
    gerberTotalEl.textContent = gerberTotal;
    const gerberProgress = document.getElementById('gerber-progress-bar');
    const gerberLegend = document.getElementById('gerber-legend');

    if (gerberTotal === 0) {
      if (gerberProgress) gerberProgress.innerHTML = `<div style="width:100%; background:var(--gray-200);"></div>`;
      if (gerberLegend) gerberLegend.innerHTML = `<span class="text-muted">No Gerber tests recorded in last 7 days</span>`;
    } else {
      const pPct = (qs.gerber.pass / gerberTotal) * 100;
      const wPct = (qs.gerber.warning / gerberTotal) * 100;
      const fPct = (qs.gerber.fail / gerberTotal) * 100;
      if (gerberProgress) {
        gerberProgress.innerHTML = `
          <div class="qp-pass" style="width:${pPct}%;"></div>
          <div class="qp-warn" style="width:${wPct}%;"></div>
          <div class="qp-fail" style="width:${fPct}%;"></div>
        `;
      }
      if (gerberLegend) {
        gerberLegend.innerHTML = `
          <span style="color:#10B981; font-weight:600;">Pass: ${qs.gerber.pass}</span>
          <span style="color:#F59E0B; font-weight:600;">Warn: ${qs.gerber.warning}</span>
          <span style="color:#EF4444; font-weight:600;">Fail: ${qs.gerber.fail}</span>
        `;
      }
    }
  }
}

function renderIssueSummary(iss) {
  const issueTotalEl = document.getElementById('issue-total-num');
  if (!issueTotalEl) return; // section removed

  issueTotalEl.textContent = iss.total;
  const highEl = document.getElementById('issue-high-num');
  if (highEl) highEl.textContent = `${iss.high_critical} High / Critical`;

  const container = document.getElementById('issue-categories-container');
  if (!container) return;

  const cats = iss.categories || {};
  const keys = Object.keys(cats);

  if (keys.length === 0) {
    container.innerHTML = `<div class="text-muted text-sm">No issues reported in the last 7 days.</div>`;
    return;
  }

  container.innerHTML = keys.map(k => `
    <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
      <span style="text-transform:capitalize; font-size:0.85rem;">${esc(k)}</span>
      <span class="badge badge-neutral">${cats[k]}</span>
    </div>
  `).join('');
}

function renderBmcRankings(rankings) {
  // Top Rated
  const topEl = document.getElementById('top-rated-bmcs');
  if (topEl) {
    if (rankings.top_rated.length === 0) {
      topEl.innerHTML = `<tr><td colspan="2" class="text-muted text-sm">No rating data</td></tr>`;
    } else {
      topEl.innerHTML = rankings.top_rated.map(b => `
        <tr>
          <td><strong>${esc(b.name)}</strong></td>
          <td style="color:#10B981; font-weight:700;">${b.avgRating} ★</td>
        </tr>
      `).join('');
    }
  }

  // Lowest Rated
  const lowEl = document.getElementById('lowest-rated-bmcs');
  if (lowEl) {
    if (rankings.lowest_rated.length === 0) {
      lowEl.innerHTML = `<tr><td colspan="2" class="text-muted text-sm">No rating data</td></tr>`;
    } else {
      lowEl.innerHTML = rankings.lowest_rated.map(b => `
        <tr>
          <td><strong>${esc(b.name)}</strong></td>
          <td style="color:#EF4444; font-weight:700;">${b.avgRating} ★</td>
        </tr>
      `).join('');
    }
  }

  // Most Visited (if element present)
  const visEl = document.getElementById('most-visited-bmcs');
  if (visEl) {
    if (rankings.most_visited.length === 0) {
      visEl.innerHTML = `<tr><td colspan="2" class="text-muted text-sm">No visits data</td></tr>`;
    } else {
      visEl.innerHTML = rankings.most_visited.map(b => `
        <tr>
          <td><strong>${esc(b.name)}</strong></td>
          <td style="font-weight:700;">${b.visitsCount} visits</td>
        </tr>
      `).join('');
    }
  }

  // Most Issues
  const issEl = document.getElementById('most-issues-bmcs');
  if (issEl) {
    if (rankings.most_issues.length === 0) {
      issEl.innerHTML = `<tr><td colspan="2" class="text-muted text-sm">No issues reported</td></tr>`;
    } else {
      issEl.innerHTML = rankings.most_issues.map(b => `
        <tr>
          <td><strong>${esc(b.name)}</strong></td>
          <td style="color:#F59E0B; font-weight:700;">${b.issuesCount} issues</td>
        </tr>
      `).join('');
    }
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
