// qc-agm-bmc-detail.js — Detailed BMC Inspection & History Logic

let currentBmc = null;
let bmcRecords = [];
let currentBmcCode = '';
let currentFilteredRecords = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  const urlParams = new URLSearchParams(window.location.search);
  currentBmcCode = urlParams.get('code') || '';

  if (!currentBmcCode) {
    showToast('No BMC Code specified in URL.', 'error');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 2000);
    return;
  }

  setupDetailDateControls();
  await loadBmcDetails(currentBmcCode);
});

function setupDetailDateControls() {
  const dateSelect = document.getElementById('detail-date-select');
  const btnToday = document.getElementById('btn-detail-today');
  const btnYesterday = document.getElementById('btn-detail-yesterday');
  const btnAll = document.getElementById('btn-detail-all');

  if (dateSelect) {
    dateSelect.addEventListener('change', (e) => {
      filterAndRenderRecords(e.target.value);
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      setDetailDateValue(todayStr);
    });
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      setDetailDateValue(yesterdayStr);
    });
  }

  if (btnAll) {
    btnAll.addEventListener('click', () => {
      setDetailDateValue('all');
    });
  }
}

function setDetailDateValue(dateStr) {
  const dateSelect = document.getElementById('detail-date-select');
  if (!dateSelect) return;

  let exists = false;
  for (let i = 0; i < dateSelect.options.length; i++) {
    if (dateSelect.options[i].value === dateStr) {
      dateSelect.selectedIndex = i;
      exists = true;
      break;
    }
  }

  if (!exists && dateStr !== 'all') {
    const opt = document.createElement('option');
    opt.value = dateStr;
    opt.textContent = new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    dateSelect.appendChild(opt);
    dateSelect.value = dateStr;
  } else if (dateStr === 'all') {
    dateSelect.value = 'all';
  }

  filterAndRenderRecords(dateStr);
}

function updateDetailDateButtonsUI(dateStr) {
  const btnToday = document.getElementById('btn-detail-today');
  const btnYesterday = document.getElementById('btn-detail-yesterday');
  const btnAll = document.getElementById('btn-detail-all');

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const activeStyle = 'background: #2563EB; color: #FFFFFF; border: 1px solid #1D4ED8; font-weight: 700; box-shadow: 0 2px 6px rgba(37,99,235,0.3);';
  const inactiveStyle = 'background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; font-weight: 700; box-shadow: none;';

  if (btnToday) {
    const isActive = (dateStr === todayStr);
    btnToday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${isActive ? activeStyle : inactiveStyle}`);
  }

  if (btnYesterday) {
    const isActive = (dateStr === yesterdayStr);
    btnYesterday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${isActive ? activeStyle : inactiveStyle}`);
  }

  if (btnAll) {
    const isActive = (dateStr === 'all' || !dateStr);
    btnAll.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${isActive ? activeStyle : inactiveStyle}`);
  }
}

function populateDetailDateDropdown(records) {
  const dateSelect = document.getElementById('detail-date-select');
  if (!dateSelect) return;

  const datesSet = new Set();
  (records || []).forEach(r => {
    if (r.date) datesSet.add(r.date);
  });

  const sortedDates = Array.from(datesSet).sort((a, b) => b.localeCompare(a));

  let html = `<option value="all" selected>All Available Dates (${sortedDates.length})</option>`;
  html += sortedDates.map(d => {
    const formatted = new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<option value="${d}">${formatted} (${d})</option>`;
  }).join('');

  dateSelect.innerHTML = html;
}

function filterAndRenderRecords(selectedDateStr = 'all') {
  updateDetailDateButtonsUI(selectedDateStr);

  if (selectedDateStr === 'all' || !selectedDateStr) {
    currentFilteredRecords = bmcRecords;
  } else {
    currentFilteredRecords = bmcRecords.filter(r => r.date === selectedDateStr);
  }

  renderBmcRecordsTable(currentFilteredRecords);
}

async function loadBmcDetails(bmcCode) {
  try {
    const res = await apiQcAgmGetBmcDetails(bmcCode);
    currentBmc = res.bmc || {};
    bmcRecords = res.records || [];

    renderBmcInfoBox(currentBmc);
    populateDetailDateDropdown(bmcRecords);
    filterAndRenderRecords('all');
  } catch (err) {
    console.error('Error loading BMC details:', err);
    showToast('Failed to load BMC inspection history.', 'error');
  }
}

function renderBmcInfoBox(bmc) {
  document.getElementById('box-bmc-name').textContent = bmc.name || `BMC ${currentBmcCode}`;
  document.getElementById('box-bmc-code').textContent = `BMC Code: ${bmc.bmc_code || currentBmcCode}`;
  document.getElementById('box-bmc-district').textContent = `District: ${bmc.district || bmc.location || 'Coimbatore'}`;
  document.getElementById('box-bmc-rating').textContent = `⭐ ${bmc.rating || '4.5'}`;
}

function renderBmcRecordsTable(records) {
  const tbody = document.getElementById('bmc-details-tbody');
  const countEl = document.getElementById('bmc-record-count');

  if (countEl) countEl.textContent = `${records.length} Record(s) Found`;

  if (!tbody) return;

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  if (records.length === 0) {
    const selectedDateVal = document.getElementById('detail-date-select')?.value || 'Selected Date';
    tbody.innerHTML = `
      <tr>
        <td style="font-weight:700; color:#64748B;">1</td>
        <td><strong>${esc(selectedDateVal === 'all' ? 'All Dates' : selectedDateVal)}</strong></td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td><span style="background:#F1F5F9; color:#64748B; padding:4px 10px; border-radius:12px; font-weight:600; font-size:0.78rem;">No Data Available</span></td>
        <td>${dash}</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map((rec, index) => {
    const macs = rec.macs || {};
    const macsStr = (macs.liters !== null && macs.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#1E3A8A;">${macs.liters} L <span style="font-size:0.75rem; color:#475569; font-weight:600;">(${macs.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#2563EB; font-weight:700; margin-top:2px;">F: ${macs.fat ?? '-'}% | S: ${macs.snf ?? '-'}%</div>`
      : dash;

    const spot = rec.spot || {};
    const spotStr = (spot.liters !== null && spot.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#92400E;">${spot.liters} L <span style="font-size:0.75rem; color:#78350F; font-weight:600;">(${spot.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#D97706; font-weight:700; margin-top:2px;">F: ${spot.fat ?? '-'}% | S: ${spot.snf ?? '-'}%</div>`
      : dash;

    const diary = rec.diary || {};
    const diaryStr = (diary.liters !== null && diary.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#065F46;">${diary.liters} L <span style="font-size:0.75rem; color:#047857; font-weight:600;">(${diary.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#059669; font-weight:700; margin-top:2px;">F: ${diary.fat ?? '-'}% | S: ${diary.snf ?? '-'}%</div>`
      : dash;

    const diffDisplay = rec.difference !== '-' 
      ? `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600; color:#334155;">${rec.difference}</span>`
      : dash;

    let actionBtn = '';
    let remarksDisplay = rec.remarks ? `<span style="color:#DC2626; font-weight:600; font-size:0.83rem;">${esc(rec.remarks)}</span>` : dash;

    if (rec.is_denied) {
      actionBtn = `<span style="background:#FEE2E2; color:#991B1B; padding:4px 10px; border-radius:12px; font-weight:800; font-size:0.78rem; display:inline-flex; align-items:center; gap:4px;">🚫 Denied</span>`;
    } else {
      actionBtn = `
        <button class="btn-qc" style="background:#EF4444; color:white; border:none; padding:5px 12px; border-radius:6px; font-weight:700; font-size:0.8rem; cursor:pointer;" onclick="handleDenyReading(${index})">
          ❌ Deny
        </button>
      `;
    }

    return `
      <tr>
        <td style="font-weight:700; color:#64748B;">${rec.s_no}</td>
        <td><strong>${rec.date}</strong></td>
        <td>${macsStr}</td>
        <td>${spotStr}</td>
        <td>${diaryStr}</td>
        <td>${diffDisplay}</td>
        <td>${actionBtn}</td>
        <td>${remarksDisplay}</td>
      </tr>
    `;
  }).join('');
}

window.handleDenyReading = async function(index) {
  const rec = currentFilteredRecords[index] || bmcRecords[index];
  if (!rec) return;

  const remarks = prompt(`Enter QC Manager remarks for rejecting test record on ${rec.date}:`);
  if (remarks === null) return;

  if (!remarks.trim()) {
    showToast('Remarks are required to deny a test reading.', 'warning');
    return;
  }

  try {
    const payload = {
      bmc_code: currentBmc.bmc_code || currentBmcCode,
      bmc_name: currentBmc.name || `BMC ${currentBmcCode}`,
      district: currentBmc.district || currentBmc.location || 'Coimbatore',
      date: rec.date,
      remarks: remarks.trim(),
      rejected_item: {
        macs: rec.macs,
        spot: rec.spot,
        diary: rec.diary,
        difference: rec.difference
      }
    };

    const res = await apiQcAgmDenyReading(payload);
    showToast(res.message || 'Reading denied successfully.', 'success');

    await loadBmcDetails(currentBmcCode);
  } catch (err) {
    console.error('Error denying reading:', err);
    showToast('Failed to deny reading. Please try again.', 'error');
  }
};

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
