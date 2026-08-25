// qc-agm-dashboard.js — MACS Readings Dashboard Logic

let currentMacsReadings = [];
let availableDates = [];
let selectedDate = '';

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupControls();
  await loadAvailableDates();
});

function setupControls() {
  const dateSelect = document.getElementById('macs-date-select');
  const searchInput = document.getElementById('macs-search-input');
  const closeModalBtn = document.getElementById('close-detail-modal');

  if (dateSelect) {
    dateSelect.addEventListener('change', (e) => {
      selectedDate = e.target.value;
      loadReadingsForDate(selectedDate);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => renderFilteredReadings());
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeDetailModal);
  }

  const modal = document.getElementById('macs-detail-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDetailModal();
    });
  }
}

async function loadAvailableDates() {
  const dateSelect = document.getElementById('macs-date-select');
  if (!dateSelect) return;

  try {
    const res = await apiQcAgmGetMacsDates();
    availableDates = res.dates || [];

    if (availableDates.length === 0) {
      dateSelect.innerHTML = `<option value="">No MACS Data Found</option>`;
      document.getElementById('macs-readings-tbody').innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:30px; color:#64748B;">
            <div style="font-size:2rem; margin-bottom:8px;">📥</div>
            <div>No MACS Readings imported yet.</div>
            <div style="font-size:0.83rem; margin-top:4px;">Upload an Excel report using the <strong>Import MACS Excel</strong> button.</div>
          </td>
        </tr>
      `;
      return;
    }

    dateSelect.innerHTML = availableDates.map(d => {
      const formatted = new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `<option value="${d}">${formatted}</option>`;
    }).join('');

    // Default to latest date
    selectedDate = availableDates[0];
    dateSelect.value = selectedDate;

    await loadReadingsForDate(selectedDate);
  } catch (err) {
    console.error('Error loading MACS dates:', err);
    showToast('Failed to load available MACS reading dates.', 'error');
  }
}

async function loadReadingsForDate(dateStr) {
  if (!dateStr) return;

  try {
    const res = await apiQcAgmGetMacsReadings(dateStr);
    currentMacsReadings = res.readings || [];

    updateSummaryCards(currentMacsReadings);
    renderFilteredReadings();
  } catch (err) {
    console.error('Error loading MACS readings:', err);
    showToast('Failed to load MACS readings for selected date.', 'error');
  }
}

function updateSummaryCards(readings) {
  let totalBmcs = readings.length;
  let workerReadings = 0;
  let qcReadings = 0;

  readings.forEach(r => {
    if (r.worker && (r.worker.fat !== null || r.worker.snf !== null)) workerReadings++;
    if (r.qc && (r.qc.fat !== null || r.qc.snf !== null)) qcReadings++;
  });

  if (document.getElementById('stat-total-bmcs')) document.getElementById('stat-total-bmcs').textContent = totalBmcs;
  if (document.getElementById('stat-worker-readings')) document.getElementById('stat-worker-readings').textContent = workerReadings;
  if (document.getElementById('stat-qc-readings')) document.getElementById('stat-qc-readings').textContent = qcReadings;
}

function renderFilteredReadings() {
  const tbody = document.getElementById('macs-readings-tbody');
  if (!tbody) return;

  const query = (document.getElementById('macs-search-input').value || '').trim().toLowerCase();

  const filtered = currentMacsReadings.filter(item => {
    const codeMatch = String(item.bmc_code || '').toLowerCase().includes(query);
    const nameMatch = String(item.bmc_name || '').toLowerCase().includes(query);
    return !query || codeMatch || nameMatch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:24px; color:#64748B;">
          No MACS readings match your current search and filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((item, idx) => {
    const w = item.worker || {};
    const q = item.qc || {};

    const wFatStr = w.fat !== null && w.fat !== undefined ? `${w.fat}%` : '--';
    const wSnfStr = w.snf !== null && w.snf !== undefined ? `${w.snf}%` : '--';
    const qFatStr = q.fat !== null && q.fat !== undefined ? `${q.fat}%` : '--';
    const qSnfStr = q.snf !== null && q.snf !== undefined ? `${q.snf}%` : '--';

    let diffDisplay = '--';
    if (item.fat_diff !== null && item.snf_diff !== null) {
      const fDiffSign = item.fat_diff > 0 ? `+${item.fat_diff}` : item.fat_diff;
      const sDiffSign = item.snf_diff > 0 ? `+${item.snf_diff}` : item.snf_diff;
      diffDisplay = `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600;">FAT: ${fDiffSign} | SNF: ${sDiffSign}</span>`;
    }

    return `
      <tr style="cursor:pointer;" onclick="openDetailModal(${idx})">
        <td><strong>${esc(item.bmc_code)}</strong></td>
        <td><strong style="color:#0F172A;">${esc(item.bmc_name || 'N/A')}</strong></td>
        <td><strong style="color:#2563EB;">${esc(wFatStr)}</strong></td>
        <td><strong style="color:#2563EB;">${esc(wSnfStr)}</strong></td>
        <td><strong style="color:#059669;">${esc(qFatStr)}</strong></td>
        <td><strong style="color:#059669;">${esc(qSnfStr)}</strong></td>
        <td>${diffDisplay}</td>
        <td>
          <button class="btn-qc btn-qc-outline btn-qc-sm" onclick="event.stopPropagation(); openDetailModal(${idx});">
            👁️ View Details
          </button>
        </td>
      </tr>
    `;
  }).join('');

  window._filteredMacsReadings = filtered;
}

window.openDetailModal = function(idx) {
  const item = (window._filteredMacsReadings || currentMacsReadings)[idx];
  if (!item) return;

  const modal = document.getElementById('macs-detail-modal');
  const container = document.getElementById('macs-detail-content');
  if (!modal || !container) return;

  const w = item.worker || {};
  const q = item.qc || {};

  const dateFormatted = new Date(item.reading_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  container.innerHTML = `
    <div style="background:#F8FAFC; padding:16px; border-radius:12px; border:1px solid #E2E8F0; margin-bottom:16px;">
      <div style="font-size:1.2rem; font-weight:800; color:#0F172A;">${esc(item.bmc_name || 'BMC Center')}</div>
      <div style="font-size:0.85rem; color:#64748B; margin-top:2px;">
        BMC Code: <strong>${esc(item.bmc_code)}</strong> &nbsp;|&nbsp; Date: <strong>${esc(dateFormatted)}</strong>
      </div>
    </div>

    <!-- Worker MACS Reading -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#2563EB; text-transform:uppercase; margin-bottom:8px;">
        👷 WORKER MACS READING
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#EFF6FF; padding:10px; border-radius:8px; border:1px solid #BFDBFE;">
          <div style="font-size:0.7rem; color:#1E40AF; font-weight:700;">FAT %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#1E3A8A;">${w.fat !== null && w.fat !== undefined ? w.fat + '%' : 'N/A'}</div>
        </div>
        <div style="background:#EFF6FF; padding:10px; border-radius:8px; border:1px solid #BFDBFE;">
          <div style="font-size:0.7rem; color:#1E40AF; font-weight:700;">SNF %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#1E3A8A;">${w.snf !== null && w.snf !== undefined ? w.snf + '%' : 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- QC MACS Reading -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#059669; text-transform:uppercase; margin-bottom:8px;">
        🔬 QC MACS READING
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#ECFDF5; padding:10px; border-radius:8px; border:1px solid #A7F3D0;">
          <div style="font-size:0.7rem; color:#065F46; font-weight:700;">FAT %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#064E3B;">${q.fat !== null && q.fat !== undefined ? q.fat + '%' : 'N/A'}</div>
        </div>
        <div style="background:#ECFDF5; padding:10px; border-radius:8px; border:1px solid #A7F3D0;">
          <div style="font-size:0.7rem; color:#065F46; font-weight:700;">SNF %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#064E3B;">${q.snf !== null && q.snf !== undefined ? q.snf + '%' : 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Comparison -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:8px;">
        📊 COMPARISON DIFFERENCES (QC - WORKER)
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
          <div style="font-size:0.7rem; color:#64748B; font-weight:700;">FAT DIFFERENCE</div>
          <div style="font-size:1.1rem; font-weight:800; color:${item.fat_diff === 0 ? '#16A34A' : '#DC2626'};">
            ${item.fat_diff !== null ? (item.fat_diff > 0 ? `+${item.fat_diff}` : item.fat_diff) : 'N/A'}
          </div>
        </div>
        <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
          <div style="font-size:0.7rem; color:#64748B; font-weight:700;">SNF DIFFERENCE</div>
          <div style="font-size:1.1rem; font-weight:800; color:${item.snf_diff === 0 ? '#16A34A' : '#DC2626'};">
            ${item.snf_diff !== null ? (item.snf_diff > 0 ? `+${item.snf_diff}` : item.snf_diff) : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
};

function closeDetailModal() {
  const modal = document.getElementById('macs-detail-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
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
