// qc-worker-dashboard.js — QC Worker Dashboard logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  // Show content
  document.getElementById('main-qc-content').classList.remove('hidden');

  // Set user header info
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('qc-welcome-name').textContent = profile.name;
  document.getElementById('qc-header-id').textContent = profile.id ? profile.id.slice(0, 8).toUpperCase() : 'QC-001';

  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadDashboardData();
});

async function loadDashboardData() {
  try {
    // Fetch Stats
    const statsRes = await apiQcGetDashboardStats();
    document.getElementById('stat-samples-pending').textContent = statsRes.samples_pending ?? 0;
    document.getElementById('stat-tested-today').textContent = statsRes.tested_today ?? 0;
    document.getElementById('stat-reports-submitted').textContent = statsRes.reports_submitted ?? 0;
    document.getElementById('stat-pending-submission').textContent = statsRes.pending_submission ?? 0;
    document.getElementById('stat-total-samples').textContent = statsRes.total_samples ?? 0;

    // Fetch Pending Samples Queue
    const samplesRes = await apiQcGetSamples();
    renderPendingQueue(samplesRes.samples || []);
  } catch (err) {
    console.error('Error loading dashboard data:', err);
    showToast(err.message || 'Failed to load dashboard data', 'error');
  }
}

function renderPendingQueue(samples) {
  const tbody = document.getElementById('pending-samples-tbody');
  if (!tbody) return;

  // Filter for samples needing testing or submission
  const pendingSamples = samples.filter(s => {
    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    return !qcTest || qcTest.status === 'in_progress' || qcTest.status === 'returned';
  });

  if (pendingSamples.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="qc-empty">
            <div class="qc-empty-icon">🧪</div>
            <div class="qc-empty-title">All Samples Tested!</div>
            <div class="qc-empty-desc">There are currently no pending BMC milk samples waiting for laboratory testing.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pendingSamples.slice(0, 10).map(s => {
    const bmcName = s.bmc ? s.bmc.name : 'Unknown BMC';
    const bmcLoc = s.bmc ? `${s.bmc.location}, ${s.bmc.district}` : 'N/A';
    const workerName = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    const collDate = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'Today';
    const collTime = s.visit_end_time ? new Date(s.visit_end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';

    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;

    let bmcSummary = 'N/A';
    if (ftir) {
      bmcSummary = `Fat: ${ftir.fat ?? '--'}%, SNF: ${ftir.snf ?? '--'}%`;
    } else if (gerber) {
      bmcSummary = `Fat: ${gerber.fat_percentage ?? '--'}%, CLR: ${gerber.clr ?? '--'}`;
    }

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    let statusPill = `<span class="qc-pill pill-pending">Pending Test</span>`;
    if (qcTest) {
      if (qcTest.status === 'in_progress') statusPill = `<span class="qc-pill pill-progress">Testing in Progress</span>`;
      else if (qcTest.status === 'returned') statusPill = `<span class="qc-pill pill-returned">Returned for Correction</span>`;
    }

    const sampleId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;

    return `
      <tr>
        <td><strong>${esc(sampleId)}</strong></td>
        <td>
          <div style="font-weight:700;">${esc(bmcName)}</div>
          <div style="font-size:0.75rem; color:#64748B;">📍 ${esc(bmcLoc)}</div>
        </td>
        <td>${esc(collDate)}</td>
        <td>${esc(collTime)}</td>
        <td>${esc(workerName)}</td>
        <td><span style="font-size:0.8rem; background:#F1F5F9; padding:2px 8px; border-radius:6px; font-weight:600;">${esc(bmcSummary)}</span></td>
        <td>${statusPill}</td>
        <td>
          <a href="test.html?visit_id=${s.id}" class="btn-qc btn-qc-primary btn-qc-sm">
            🧪 Test Sample
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
