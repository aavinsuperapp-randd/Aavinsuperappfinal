// qc-agm-all-tests.js — QC AGM All Test Results & Comparison logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadAllTests();

  document.getElementById('all-search').addEventListener('input', filterAllTests);
  document.getElementById('all-source-filter').addEventListener('change', filterAllTests);
  document.getElementById('all-status-filter').addEventListener('change', filterAllTests);
  document.getElementById('all-variance-filter').addEventListener('change', filterAllTests);

  // Review modal button actions
  document.getElementById('btn-approve-report').addEventListener('click', () => handleReviewAction('approved'));
  document.getElementById('btn-return-report').addEventListener('click', () => handleReviewAction('returned'));
});

let allTestRecords = [];
let activeSelectedVisitId = null;
let activeSelectedQcTestId = null;

async function loadAllTests() {
  try {
    const res = await apiQcAgmGetAllTests();
    allTestRecords = res.tests || [];
    renderAllTestsTable(allTestRecords);
  } catch (err) {
    console.error('Error loading all tests:', err);
    showToast(err.message || 'Failed to load test results.', 'error');
  }
}

function filterAllTests() {
  const q = document.getElementById('all-search').value.toLowerCase().trim();
  const sourceFilter = document.getElementById('all-source-filter').value;
  const statusFilter = document.getElementById('all-status-filter').value;
  const varianceFilter = document.getElementById('all-variance-filter').value;

  const filtered = allTestRecords.filter(s => {
    const bmcName = (s.bmc ? s.bmc.name : '').toLowerCase();
    const workerName = (s.trip && s.trip.worker ? s.trip.worker.name : '').toLowerCase();
    const sampleId = `smp-${s.id.slice(0, 6)}`.toLowerCase();

    const matchesSearch = !q || bmcName.includes(q) || workerName.includes(q) || sampleId.includes(q);

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;

    let currentStatus = 'pending';
    if (qcTest) currentStatus = qcTest.status;

    const matchesStatus = statusFilter === 'all' || currentStatus === statusFilter;

    // Variance check
    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? null;
    let hasVariance = false;
    if (qcTest && qcTest.fat !== null && bmcFat !== null) {
      if (Math.abs(parseFloat(qcTest.fat) - parseFloat(bmcFat)) >= 0.3) hasVariance = true;
    }

    const matchesVariance = varianceFilter === 'all' ||
      (varianceFilter === 'yes' && hasVariance) ||
      (varianceFilter === 'no' && !hasVariance);

    return matchesSearch && matchesStatus && matchesVariance;
  });

  renderAllTestsTable(filtered);
}

function renderAllTestsTable(tests) {
  const tbody = document.getElementById('all-tests-tbody');
  if (!tbody) return;

  if (tests.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">
          <div class="qc-empty">
            <div class="qc-empty-icon">🧪</div>
            <div class="qc-empty-title">No Test Records Found</div>
            <div class="qc-empty-desc">No tests match your selected filter criteria.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tests.map(s => {
    const bmcName = s.bmc ? s.bmc.name : 'Unknown BMC';
    const workerName = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    const collDate = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'N/A';

    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
    const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    const qcFat = qcTest && qcTest.fat !== null ? `${qcTest.fat}%` : 'Pending';
    const qcSnf = qcTest && qcTest.snf !== null ? `${qcTest.snf}%` : 'Pending';
    const qcWorkerName = qcTest && qcTest.qc_worker ? qcTest.qc_worker.name : '--';

    const macs = s.macs_qc || s.macs_worker || null;
    const macsFatStr = macs && macs.fat !== null && macs.fat !== undefined ? `${macs.fat}%` : 'N/A';
    const macsSnfStr = macs && macs.snf !== null && macs.snf !== undefined ? `${macs.snf}%` : 'N/A';

    let hasVariance = false;
    let fatDiff = '';
    if (qcTest && qcTest.fat !== null && bmcFat !== 'N/A') {
      const diff = (parseFloat(qcTest.fat) - parseFloat(bmcFat)).toFixed(2);
      fatDiff = `(${diff > 0 ? '+' : ''}${diff}%)`;
      if (Math.abs(parseFloat(diff)) >= 0.3) hasVariance = true;
    }

    let statusPill = `<span class="qc-pill pill-pending">Pending QC</span>`;
    if (qcTest) {
      if (qcTest.status === 'submitted') statusPill = `<span class="qc-pill pill-submitted">Submitted</span>`;
      else if (qcTest.status === 'approved') statusPill = `<span class="qc-pill pill-approved">✓ Approved</span>`;
      else if (qcTest.status === 'returned') statusPill = `<span class="qc-pill pill-returned">Returned</span>`;
    }

    const sampleId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;

    return `
      <tr style="${hasVariance ? 'background:#FEF2F2;' : ''}">
        <td>
          <strong>${esc(sampleId)}</strong>
          ${hasVariance ? `<div class="qc-variance-alert" style="margin-top:2px;">⚠️ Variance ${fatDiff}</div>` : ''}
        </td>
        <td><strong>${esc(bmcName)}</strong></td>
        <td>${esc(collDate)}</td>
        <td>${esc(workerName)}</td>
        <td><span style="color:#1D4ED8; font-weight:700;">${esc(bmcFat)}${bmcFat !== 'N/A' ? '%' : ''} / ${esc(bmcSnf)}${bmcSnf !== 'N/A' ? '%' : ''}</span></td>
        <td><span style="color:#0F766E; font-weight:700;">${esc(qcFat)} / ${esc(qcSnf)}</span></td>
        <td><span style="color:#D97706; font-weight:700;">${esc(macsFatStr)} / ${esc(macsSnfStr)}</span></td>
        <td>${esc(qcWorkerName)}</td>
        <td>${statusPill}</td>
        <td>
          <button class="btn-qc btn-qc-outline btn-qc-sm" onclick="openTestCompareModal('${s.id}')">
            🔍 Compare &amp; Review
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.openTestCompareModal = async function(visitId) {
  activeSelectedVisitId = visitId;
  activeSelectedQcTestId = null;

  try {
    const res = await apiQcAgmGetTestDetail(visitId);
    const s = res.test;
    const xRows = res.excel_rows || [];

    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;

    if (qcTest) activeSelectedQcTestId = qcTest.id;

    // Header info
    document.getElementById('modal-sample-id').textContent = `SMP-${s.id.slice(0, 6).toUpperCase()}`;
    document.getElementById('modal-bmc-name').textContent = s.bmc ? `${s.bmc.name} (${s.bmc.location})` : 'N/A';
    document.getElementById('modal-worker-name').textContent = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    document.getElementById('modal-coll-date').textContent = s.visit_end_time ? new Date(s.visit_end_time).toLocaleString() : 'N/A';

    // Comparison Table values
    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
    const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';
    const bmcClr = (gerber && gerber.clr) ?? 'N/A';
    const bmcTemp = (ftir && ftir.temperature) ?? (gerber && gerber.sample_temp) ?? 'N/A';

    const qcFat = qcTest && qcTest.fat !== null ? qcTest.fat : 'N/A';
    const qcSnf = qcTest && qcTest.snf !== null ? qcTest.snf : 'N/A';
    const qcClr = qcTest && qcTest.clr !== null ? qcTest.clr : 'N/A';
    const qcTemp = qcTest && qcTest.temperature !== null ? qcTest.temperature : 'N/A';

    // Excel values (latest row for this BMC if available)
    const latestX = xRows[0] || {};
    const xlFat = latestX.fat !== null && latestX.fat !== undefined ? latestX.fat : 'N/A';
    const xlSnf = latestX.snf !== null && latestX.snf !== undefined ? latestX.snf : 'N/A';
    const xlClr = latestX.clr !== null && latestX.clr !== undefined ? latestX.clr : 'N/A';

    document.getElementById('m-bmc-fat').textContent = bmcFat !== 'N/A' ? `${bmcFat}%` : 'N/A';
    document.getElementById('m-qc-fat').textContent = qcFat !== 'N/A' ? `${qcFat}%` : 'N/A';
    document.getElementById('m-xl-fat').textContent = xlFat !== 'N/A' ? `${xlFat}%` : 'N/A';

    document.getElementById('m-bmc-snf').textContent = bmcSnf !== 'N/A' ? `${bmcSnf}%` : 'N/A';
    document.getElementById('m-qc-snf').textContent = qcSnf !== 'N/A' ? `${qcSnf}%` : 'N/A';
    document.getElementById('m-xl-snf').textContent = xlSnf !== 'N/A' ? `${xlSnf}%` : 'N/A';

    document.getElementById('m-bmc-clr').textContent = bmcClr;
    document.getElementById('m-qc-clr').textContent = qcClr;
    document.getElementById('m-xl-clr').textContent = xlClr;

    document.getElementById('m-bmc-temp').textContent = bmcTemp !== 'N/A' ? `${bmcTemp}°C` : 'N/A';
    document.getElementById('m-qc-temp').textContent = qcTemp !== 'N/A' ? `${qcTemp}°C` : 'N/A';

    // Differences
    let diffFat = 'N/A';
    let diffSnf = 'N/A';
    if (bmcFat !== 'N/A' && qcFat !== 'N/A') {
      const d = (parseFloat(qcFat) - parseFloat(bmcFat)).toFixed(2);
      diffFat = `${d > 0 ? '+' : ''}${d}%`;
    }
    if (bmcSnf !== 'N/A' && qcSnf !== 'N/A') {
      const d = (parseFloat(qcSnf) - parseFloat(bmcSnf)).toFixed(2);
      diffSnf = `${d > 0 ? '+' : ''}${d}%`;
    }

    document.getElementById('m-diff-fat').textContent = diffFat;
    document.getElementById('m-diff-snf').textContent = diffSnf;

    // Review Actions visibility
    const reviewBox = document.getElementById('review-action-section');
    if (qcTest && qcTest.status === 'submitted') {
      reviewBox.style.display = 'block';
    } else {
      reviewBox.style.display = 'block'; // allow review on any status
    }

    // Open Modal
    document.getElementById('detail-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Error opening compare modal:', err);
    showToast(err.message || 'Failed to load test details.', 'error');
  }
};

async function handleReviewAction(action) {
  if (!activeSelectedQcTestId) {
    showToast('No QC Worker report submitted for this sample yet.', 'error');
    return;
  }

  const remarks = document.getElementById('review-remarks-input').value.trim();
  if (action === 'returned' && !remarks) {
    showToast('Please enter remarks explaining why the report is returned.', 'error');
    return;
  }

  try {
    showToast(`Processing review (${action})...`, 'info');
    await apiQcAgmReviewTest(activeSelectedQcTestId, action, remarks);
    showToast(`QC Test report successfully ${action}!`, 'success');
    document.getElementById('detail-modal').classList.add('hidden');
    await loadAllTests();
  } catch (err) {
    console.error('Error reviewing report:', err);
    showToast(err.message || 'Failed to complete review.', 'error');
  }
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
