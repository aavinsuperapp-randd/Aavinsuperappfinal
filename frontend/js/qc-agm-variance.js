// qc-agm-variance.js — QC AGM Variance Analysis Logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadVarianceData();

  document.getElementById('thresh-fat').addEventListener('change', filterVarianceRecords);
  document.getElementById('thresh-snf').addEventListener('change', filterVarianceRecords);
});

let rawVarianceRecords = [];

async function loadVarianceData() {
  try {
    const res = await apiQcAgmGetAllTests();
    rawVarianceRecords = res.tests || [];
    filterVarianceRecords();
  } catch (err) {
    console.error('Error loading variance data:', err);
    showToast(err.message || 'Failed to load variance analysis.', 'error');
  }
}

function filterVarianceRecords() {
  const fatThresh = parseFloat(document.getElementById('thresh-fat').value) || 0.3;
  const snfThresh = parseFloat(document.getElementById('thresh-snf').value) || 0.3;

  const varianceList = [];

  rawVarianceRecords.forEach(s => {
    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;

    if (!qcTest) return;

    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? null;
    const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? null;

    const qcFat = qcTest.fat;
    const qcSnf = qcTest.snf;

    let fatDiff = null;
    let snfDiff = null;

    if (qcFat !== null && bmcFat !== null) {
      fatDiff = parseFloat((qcFat - bmcFat).toFixed(2));
    }
    if (qcSnf !== null && bmcSnf !== null) {
      snfDiff = parseFloat((qcSnf - bmcSnf).toFixed(2));
    }

    const isFatVariance = fatDiff !== null && Math.abs(fatDiff) >= fatThresh;
    const isSnfVariance = snfDiff !== null && Math.abs(snfDiff) >= snfThresh;

    if (isFatVariance || isSnfVariance) {
      varianceList.push({
        sample: s,
        bmcFat,
        qcFat,
        fatDiff,
        bmcSnf,
        qcSnf,
        snfDiff,
        isFatVariance,
        isSnfVariance
      });
    }
  });

  document.getElementById('stat-total-variance').textContent = varianceList.length;
  renderVarianceTable(varianceList);
}

function renderVarianceTable(list) {
  const tbody = document.getElementById('variance-tbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="qc-empty">
            <div class="qc-empty-icon">✅</div>
            <div class="qc-empty-title">No Quality Variance Detected</div>
            <div class="qc-empty-desc">All Field BMC tests match QC Laboratory results within the configured tolerance thresholds.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(item => {
    const s = item.sample;
    const bmcName = s.bmc ? s.bmc.name : 'Unknown BMC';
    const workerName = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    const qcWorkerName = s.qc_test && s.qc_test.qc_worker ? s.qc_test.qc_worker.name : 'QC Analyst';
    const dateStr = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'N/A';

    const fatDiffText = item.fatDiff !== null ? `${item.fatDiff > 0 ? '+' : ''}${item.fatDiff}%` : 'N/A';
    const snfDiffText = item.snfDiff !== null ? `${item.snfDiff > 0 ? '+' : ''}${item.snfDiff}%` : 'N/A';

    const sampleId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;

    return `
      <tr>
        <td><strong>${esc(sampleId)}</strong></td>
        <td><strong>${esc(bmcName)}</strong></td>
        <td>${esc(dateStr)}</td>
        <td>${esc(workerName)}</td>
        <td>${esc(qcWorkerName)}</td>
        <td>${esc(item.bmcFat ?? 'N/A')}% / ${esc(item.qcFat ?? 'N/A')}%</td>
        <td><strong class="${item.isFatVariance ? 'diff-bad' : 'diff-ok'}">${esc(fatDiffText)}</strong></td>
        <td>${esc(item.bmcSnf ?? 'N/A')}% / ${esc(item.qcSnf ?? 'N/A')}%</td>
        <td><strong class="${item.isSnfVariance ? 'diff-bad' : 'diff-ok'}">${esc(snfDiffText)}</strong></td>
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
