// qc-worker-history.js — QC Worker Test History Page

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadHistory();

  document.getElementById('history-search').addEventListener('input', filterHistory);
  document.getElementById('history-status-filter').addEventListener('change', filterHistory);
});

let allHistory = [];

async function loadHistory() {
  try {
    const res = await apiQcGetHistory();
    allHistory = res.tests || [];
    renderHistoryTable(allHistory);
  } catch (err) {
    console.error('Error loading history:', err);
    showToast(err.message || 'Failed to load test history.', 'error');
  }
}

function filterHistory() {
  const q = document.getElementById('history-search').value.toLowerCase().trim();
  const statusFilter = document.getElementById('history-status-filter').value;

  const filtered = allHistory.filter(t => {
    const v = t.visit;
    const bmcName = (v && v.bmc ? v.bmc.name : '').toLowerCase();
    const bmcLoc = (v && v.bmc ? v.bmc.location : '').toLowerCase();
    const workerName = (v && v.trip && v.trip.worker ? v.trip.worker.name : '').toLowerCase();
    const sampleId = `smp-${t.visit_id.slice(0, 6)}`.toLowerCase();

    const matchesSearch = !q || bmcName.includes(q) || bmcLoc.includes(q) || workerName.includes(q) || sampleId.includes(q);
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  renderHistoryTable(filtered);
}

function renderHistoryTable(tests) {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  if (tests.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">
          <div class="qc-empty">
            <div class="qc-empty-icon">📜</div>
            <div class="qc-empty-title">No Test History Found</div>
            <div class="qc-empty-desc">You have not submitted any test reports matching the current filters.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tests.map(t => {
    const v = t.visit || {};
    const bmcName = v.bmc ? v.bmc.name : 'Unknown BMC';
    const workerName = v.trip && v.trip.worker ? v.trip.worker.name : 'Field Worker';
    const testDate = t.submitted_at ? new Date(t.submitted_at).toLocaleString() : new Date(t.created_at).toLocaleDateString();

    const ftir = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : v.ftir_tests;
    const gerber = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : v.gerber_tests;

    const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
    const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';

    const qcFat = t.fat !== null ? `${t.fat}%` : 'N/A';
    const qcSnf = t.snf !== null ? `${t.snf}%` : 'N/A';

    let statusPill = `<span class="qc-pill pill-submitted">${esc(t.status)}</span>`;
    if (t.status === 'approved') statusPill = `<span class="qc-pill pill-approved">✓ Approved</span>`;
    else if (t.status === 'returned') statusPill = `<span class="qc-pill pill-returned"> Returned</span>`;
    else if (t.status === 'in_progress') statusPill = `<span class="qc-pill pill-progress">Draft</span>`;

    const sampleId = `SMP-${t.visit_id.slice(0, 6).toUpperCase()}`;

    return `
      <tr>
        <td><strong>${esc(sampleId)}</strong></td>
        <td>${esc(bmcName)}</td>
        <td>${esc(testDate)}</td>
        <td>${esc(workerName)}</td>
        <td><span style="color:#1D4ED8; font-weight:700;">${esc(bmcFat)}${bmcFat !== 'N/A' ? '%' : ''}</span></td>
        <td><span style="color:#0F766E; font-weight:700;">${esc(qcFat)}</span></td>
        <td><span style="color:#1D4ED8; font-weight:700;">${esc(bmcSnf)}${bmcSnf !== 'N/A' ? '%' : ''}</span></td>
        <td><span style="color:#0F766E; font-weight:700;">${esc(qcSnf)}</span></td>
        <td>${statusPill}</td>
        <td>
          <a href="test.html?visit_id=${t.visit_id}" class="btn-qc btn-qc-outline btn-qc-sm">
            👁️ View Details
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
