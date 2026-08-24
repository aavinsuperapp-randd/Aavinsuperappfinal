// qc-worker-samples.js — QC Worker Samples Queue Page

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadSamplesQueue();

  // Search & Filter
  document.getElementById('sample-search-input').addEventListener('input', filterSamples);
  document.getElementById('sample-status-filter').addEventListener('change', filterSamples);
});

let allSamples = [];

async function loadSamplesQueue() {
  try {
    const res = await apiQcGetSamples();
    allSamples = res.samples || [];
    renderSamplesTable(allSamples);
  } catch (err) {
    console.error('Error loading samples queue:', err);
    showToast(err.message || 'Failed to load samples queue.', 'error');
  }
}

function filterSamples() {
  const q = document.getElementById('sample-search-input').value.toLowerCase().trim();
  const statusFilter = document.getElementById('sample-status-filter').value;

  const filtered = allSamples.filter(s => {
    const bmcName = (s.bmc ? s.bmc.name : '').toLowerCase();
    const bmcLoc = (s.bmc ? s.bmc.location : '').toLowerCase();
    const workerName = (s.trip && s.trip.worker ? s.trip.worker.name : '').toLowerCase();
    const sampleId = `smp-${s.id.slice(0, 6)}`.toLowerCase();

    const matchesSearch = !q || bmcName.includes(q) || bmcLoc.includes(q) || workerName.includes(q) || sampleId.includes(q);

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    let currentStatus = 'pending';
    if (qcTest) currentStatus = qcTest.status;

    const matchesStatus = statusFilter === 'all' || currentStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  renderSamplesTable(filtered);
}

function renderSamplesTable(samples) {
  const tbody = document.getElementById('samples-tbody');
  if (!tbody) return;

  if (samples.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="qc-empty">
            <div class="qc-empty-icon">🔍</div>
            <div class="qc-empty-title">No Samples Match Criteria</div>
            <div class="qc-empty-desc">Try clearing your search query or status filters.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = samples.map(s => {
    const bmcName = s.bmc ? s.bmc.name : 'Unknown BMC';
    const bmcLoc = s.bmc ? `${s.bmc.location}, ${s.bmc.district}` : 'N/A';
    const workerName = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
    const collDate = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'N/A';
    const collTime = s.visit_end_time ? new Date(s.visit_end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';

    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;

    let bmcSummary = [];
    if (ftir) {
      bmcSummary.push(`FTIR: Fat ${ftir.fat ?? '--'}%, SNF ${ftir.snf ?? '--'}%`);
    }
    if (gerber) {
      bmcSummary.push(`Gerber: Fat ${gerber.fat_percentage ?? '--'}%, CLR ${gerber.clr ?? '--'}`);
    }
    bmcSummary = bmcSummary.length > 0 ? bmcSummary.join('<br>') : 'N/A';

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    let statusPill = `<span class="qc-pill pill-pending">Pending Test</span>`;
    let btnText = '🧪 Test Sample';

    if (qcTest) {
      if (qcTest.status === 'in_progress') {
        statusPill = `<span class="qc-pill pill-progress">Testing in Progress</span>`;
        btnText = '📝 Continue Test';
      } else if (qcTest.status === 'submitted') {
        statusPill = `<span class="qc-pill pill-submitted">Submitted</span>`;
        btnText = '👁️ View Report';
      } else if (qcTest.status === 'approved') {
        statusPill = `<span class="qc-pill pill-approved">Approved</span>`;
        btnText = '👁️ View Report';
      } else if (qcTest.status === 'returned') {
        statusPill = `<span class="qc-pill pill-returned">Returned for Correction</span>`;
        btnText = '✏️ Edit & Resubmit';
      }
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
        <td><span style="font-size:0.8rem; background:#F1F5F9; padding:4px 8px; border-radius:6px; font-weight:600; display:inline-block; line-height:1.4;">${bmcSummary}</span></td>
        <td>${statusPill}</td>
        <td>
          <a href="test.html?visit_id=${s.id}" class="btn-qc btn-qc-primary btn-qc-sm">
            ${btnText}
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
