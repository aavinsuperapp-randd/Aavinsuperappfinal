// eo-reports.js — Executive Officer Worker Reports Logic

let reportsCache = [];
let targetBmcId = '';

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

  const params = new URLSearchParams(window.location.search);
  if (params.get('bmcId')) targetBmcId = params.get('bmcId');

  const modal = document.getElementById('report-detail-modal');
  const btnClose = document.getElementById('close-report-modal');
  const btnClose2 = document.getElementById('btn-close-report-modal');
  const closeModal = () => { if (modal) modal.classList.add('hidden'); };
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnClose2) btnClose2.addEventListener('click', closeModal);

  await loadWorkerReports();
});

async function loadWorkerReports() {
  const container = document.getElementById('reports-container');
  if (!container) return;

  try {
    const data = await eoFetch('/api/eo/reports');
    reportsCache = data.reports || [];

    let filtered = reportsCache;
    if (targetBmcId) {
      filtered = reportsCache.filter(r => r.bmc_id === targetBmcId);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1; background: #FFF;">
          <h4>No Worker Reports Found</h4>
          <p class="text-sm mt-1">No worker inspection logs or field reports recorded for your assigned BMCs.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(report => {
      const card = document.createElement('div');
      card.className = 'report-card';

      const timeStr = report.visited_at ? new Date(report.visited_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      const statusBadge = report.status === 'open' || report.status === 'pending'
        ? '<span class="badge badge-warning">Pending Review</span>'
        : '<span class="badge badge-success">Completed</span>';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div class="report-title">🏭 ${report.bmc_name || 'BMC'}</div>
            <div style="font-size: 0.8rem; color: #64748B; margin-top: 2px;">👷 ${report.worker_name} • 🕒 ${timeStr}</div>
          </div>
          ${statusBadge}
        </div>

        <div style="font-size: 0.78rem; font-weight: 700; color: #2563EB; margin-top: 8px;">
          📌 ${report.report_type}
        </div>

        <div class="report-desc">
          ${report.description}
        </div>

        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #F1F5F9; display: flex; justify-content: flex-end;">
          <button class="btn btn-outline btn-sm" onclick="openReportDetail('${report.id}')">
            📋 View Full Detail
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load reports:', err);
    container.innerHTML = `<div class="text-danger p-4" style="grid-column: 1 / -1;">Failed to load reports (${err.message}).</div>`;
  }
}

window.openReportDetail = function(reportId) {
  const report = reportsCache.find(r => r.id === reportId);
  if (!report) return;

  const modal = document.getElementById('report-detail-modal');
  if (!modal) return;

  document.getElementById('rd-bmc').textContent = report.bmc_name || 'BMC';
  document.getElementById('rd-worker').textContent = report.worker_name || 'Worker';
  document.getElementById('rd-time').textContent = report.visited_at ? new Date(report.visited_at).toLocaleString('en-IN') : '—';
  document.getElementById('rd-type').textContent = report.report_type || 'Inspection Log';
  document.getElementById('rd-desc').textContent = report.description || 'Standard BMC inspection completed.';

  const photosGrid = document.getElementById('rd-photos-grid');
  if (photosGrid) {
    const photos = report.photos || [];
    if (photos.length > 0) {
      photosGrid.innerHTML = photos.map(url => `
        <a href="${url}" target="_blank">
          <img src="${url}" alt="Report Photo" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #CBD5E1;">
        </a>
      `).join('');
    } else {
      photosGrid.innerHTML = '<span class="text-muted text-sm">No photos attached to this report.</span>';
    }
  }

  modal.classList.remove('hidden');
};
