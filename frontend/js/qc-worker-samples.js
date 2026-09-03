// qc-worker-samples.js — QC Worker Samples Queue Page

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  const btnToday = document.getElementById('btn-quick-today');
  const btnYesterday = document.getElementById('btn-quick-yesterday');
  const dateFrom = document.getElementById('filter-from-date');
  const dateTo = document.getElementById('filter-to-date');
  const btnDownload = document.getElementById('btn-download-pdf');

  function updateQuickBtns(range) {
    if(btnToday) {
      btnToday.style.background = range === 'today' ? '#2563EB' : '#F1F5F9';
      btnToday.style.color = range === 'today' ? '#FFF' : '#334155';
    }
    if(btnYesterday) {
      btnYesterday.style.background = range === 'yesterday' ? '#2563EB' : '#F1F5F9';
      btnYesterday.style.color = range === 'yesterday' ? '#FFF' : '#334155';
    }
  }

  function setTodayDefault() {
    const today = new Date();
    const dStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    if (dateFrom) dateFrom.value = dStr;
    if (dateTo) dateTo.value = dStr;
    updateQuickBtns('today');
  }

  // Set default to today
  setTodayDefault();

  await loadSamplesQueue();

  if(btnToday) {
    btnToday.addEventListener('click', () => {
      setTodayDefault();
      filterSamples();
    });
  }

  if(btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      const dStr = yest.getFullYear() + '-' + String(yest.getMonth()+1).padStart(2,'0') + '-' + String(yest.getDate()).padStart(2,'0');
      if (dateFrom) dateFrom.value = dStr;
      if (dateTo) dateTo.value = dStr;
      updateQuickBtns('yesterday');
      filterSamples();
    });
  }

  if(dateFrom) dateFrom.addEventListener('change', () => { updateQuickBtns('custom'); filterSamples(); });
  if(dateTo) dateTo.addEventListener('change', () => { updateQuickBtns('custom'); filterSamples(); });

  if(btnDownload) btnDownload.addEventListener('click', generatePDF);
});

let allSamples = [];

async function loadSamplesQueue() {
  try {
    const res = await apiQcGetSamples();
    allSamples = res.samples || [];
    filterSamples();
  } catch (err) {
    console.error('Error loading samples queue:', err);
    showToast(err.message || 'Failed to load samples queue.', 'error');
  }
}

function filterSamples() {
  const fDateStr = document.getElementById('filter-from-date') ? document.getElementById('filter-from-date').value : '';
  const tDateStr = document.getElementById('filter-to-date') ? document.getElementById('filter-to-date').value : '';

  let fDate = fDateStr ? new Date(fDateStr) : null;
  if(fDate) fDate.setHours(0,0,0,0);
  let tDate = tDateStr ? new Date(tDateStr) : null;
  if(tDate) tDate.setHours(23,59,59,999);

  const filtered = allSamples.filter(s => {
    let matchesDate = true;
    if (fDate || tDate) {
      const sTime = s.visit_end_time || s.created_at;
      if (sTime) {
        const itemD = new Date(sTime);
        if (fDate && itemD < fDate) matchesDate = false;
        if (tDate && itemD > tDate) matchesDate = false;
      } else {
        matchesDate = false;
      }
    }

    return matchesDate;
  });

  window._currentFilteredSamples = filtered;
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
      const isCompleted = qcTest.status === 'submitted' || qcTest.status === 'approved' || (qcTest.fat != null && qcTest.snf != null && String(qcTest.fat).trim() !== '' && String(qcTest.snf).trim() !== '');

      if (isCompleted) {
        statusPill = `<span class="qc-pill pill-submitted">Completed</span>`;
        btnText = '👁️ View Report';
      } else if (qcTest.status === 'returned') {
        statusPill = `<span class="qc-pill pill-returned">Returned for Correction</span>`;
        btnText = '✏️ Edit & Resubmit';
      } else if (qcTest.status === 'in_progress') {
        statusPill = `<span class="qc-pill pill-progress">Testing in Progress</span>`;
        btnText = '📝 Continue Test';
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

function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  const now = new Date();
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('AAVIN QC Worker — Sample Testing Queue Report', 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${now.toLocaleString('en-IN')}`, 14, 28);
  
  const fDateStr = document.getElementById('filter-from-date') ? document.getElementById('filter-from-date').value : '';
  const tDateStr = document.getElementById('filter-to-date') ? document.getElementById('filter-to-date').value : '';
  const statSelect = document.getElementById('sample-status-filter');
  const statF = statSelect ? statSelect.options[statSelect.selectedIndex].text : 'All Statuses';
  
  let dateRangeText = 'All Time';
  if(fDateStr && tDateStr) dateRangeText = `${fDateStr} to ${tDateStr}`;
  else if (fDateStr) dateRangeText = `From ${fDateStr}`;
  else if (tDateStr) dateRangeText = `Until ${tDateStr}`;
  
  doc.text(`Date Range: ${dateRangeText}   |   Status: ${statF}`, 14, 34);

  const samples = window._currentFilteredSamples || allSamples;

  const tableData = samples.map((s, idx) => {
    const sId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;
    const bmcName = s.bmc ? s.bmc.name : 'Unknown';
    const cDate = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'N/A';
    const cTime = s.visit_end_time ? new Date(s.visit_end_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : 'N/A';
    const fw = s.trip && s.trip.worker ? s.trip.worker.name : 'Unknown';
    
    let bmcSummary = [];
    const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
    const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
    if(ftir) bmcSummary.push(`FTIR (F:${ftir.fat ?? '-'} S:${ftir.snf ?? '-'})`);
    if(gerber) bmcSummary.push(`Gerber (F:${gerber.fat_percentage ?? '-'} C:${gerber.clr ?? '-'})`);
    const bmcTestStr = bmcSummary.length > 0 ? bmcSummary.join('\n') : 'No Data';

    const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
    let stat = 'Pending';
    if(qcTest) {
      if(qcTest.status === 'submitted' || qcTest.status === 'approved' || (qcTest.fat != null && qcTest.fat !== '')) stat = 'Completed';
      else if(qcTest.status === 'returned') stat = 'Returned';
      else if(qcTest.status === 'in_progress') stat = 'In Progress';
    }

    return [
      idx + 1,
      sId,
      bmcName,
      cDate + '\n' + cTime,
      fw,
      bmcTestStr,
      stat
    ];
  });

  doc.autoTable({
    startY: 42,
    head: [['#', 'Sample ID', 'BMC Center', 'Collection Date/Time', 'Field Worker', 'Spot Analyzer / Diary', 'QC Status']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] }
  });

  doc.save(`QC_Queue_Report_${now.getTime()}.pdf`);
}
