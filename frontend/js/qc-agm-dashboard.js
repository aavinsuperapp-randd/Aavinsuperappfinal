// qc-agm-dashboard.js — QC AGM Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadDashboardStats();
  await loadRecentTests();
});

async function loadDashboardStats() {
  try {
    const res = await apiQcAgmGetDashboard();
    document.getElementById('stat-total-samples').textContent = res.total_samples ?? 0;
    document.getElementById('stat-bmc-tests').textContent = res.bmc_tests ?? 0;
    document.getElementById('stat-qc-tests').textContent = res.qc_lab_tests ?? 0;
    document.getElementById('stat-imported-records').textContent = res.imported_records ?? 0;
    document.getElementById('stat-pending-qc').textContent = res.pending_qc_tests ?? 0;
    document.getElementById('stat-submitted-reports').textContent = res.reports_submitted ?? 0;
    document.getElementById('stat-reviewed-reports').textContent = res.reviewed ?? 0;
    document.getElementById('stat-variance-detected').textContent = res.variance_detected ?? 0;
  } catch (err) {
    console.error('Error loading AGM stats:', err);
    showToast(err.message || 'Failed to load QC AGM dashboard stats.', 'error');
  }
}

async function loadRecentTests() {
  try {
    const res = await apiQcAgmGetAllTests();
    const tests = res.tests || [];
    renderRecentTestsTable(tests.slice(0, 10));
  } catch (err) {
    console.error('Error loading recent tests:', err);
  }
}

function renderRecentTestsTable(tests) {
  const tbody = document.getElementById('recent-tests-tbody');
  if (!tbody) return;

  if (tests.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="qc-empty">
            <div class="qc-empty-icon">📊</div>
            <div class="qc-empty-title">No Recent Test Records</div>
            <div class="qc-empty-desc">No test results are currently available in the system.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tests.map(s => {
    const bmcName = s.bmc ? s.bmc.name : 'Unknown BMC';
    const workerName = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    const collDate = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'Today';

    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
    const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    const qcFat = qcTest && qcTest.fat !== null ? `${qcTest.fat}%` : 'Pending';
    const qcSnf = qcTest && qcTest.snf !== null ? `${qcTest.snf}%` : 'Pending';
    const qcWorkerName = qcTest && qcTest.qc_worker ? qcTest.qc_worker.name : '--';

    let hasVariance = false;
    if (qcTest && qcTest.fat !== null && bmcFat !== 'N/A') {
      if (Math.abs(parseFloat(qcTest.fat) - parseFloat(bmcFat)) >= 0.3) hasVariance = true;
    }

    let statusPill = `<span class="qc-pill pill-pending">Pending QC</span>`;
    if (qcTest) {
      if (qcTest.status === 'submitted') statusPill = `<span class="qc-pill pill-submitted">Submitted</span>`;
      else if (qcTest.status === 'approved') statusPill = `<span class="qc-pill pill-approved">Approved</span>`;
      else if (qcTest.status === 'returned') statusPill = `<span class="qc-pill pill-returned">Returned</span>`;
    }

    const sampleId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;

    return `
      <tr style="${hasVariance ? 'background:#FEF2F2;' : ''}">
        <td>
          <strong>${esc(sampleId)}</strong>
          ${hasVariance ? '<div class="qc-variance-alert" style="margin-top:2px;">⚠️ Variance</div>' : ''}
        </td>
        <td><strong>${esc(bmcName)}</strong></td>
        <td>${esc(collDate)}</td>
        <td>${esc(workerName)}</td>
        <td><span style="color:#1D4ED8; font-weight:700;">${esc(bmcFat)}${bmcFat !== 'N/A' ? '%' : ''}</span></td>
        <td><span style="color:#0F766E; font-weight:700;">${esc(qcFat)}</span></td>
        <td>${esc(qcWorkerName)}</td>
        <td>${statusPill}</td>
        <td>
          <button class="btn-qc btn-qc-outline btn-qc-sm" onclick="openTestModal('${s.id}')">
            🔍 Compare &amp; Review
          </button>
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
