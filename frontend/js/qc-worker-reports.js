// qc-worker-reports.js — Logic for Reports Testing Tab

let reportsData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name;
  
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  await loadReports();
});

async function loadReports() {
  try {
    const res = await apiQcWorkerGetReports();
    reportsData = res.reports || [];
    renderReportsTable(reportsData);
  } catch (err) {
    console.error('Error fetching reports:', err);
    showToast('Failed to load denied reports.', 'error');
  }
}

function renderReportsTable(reports) {
  const tbody = document.getElementById('reports-tbody');
  if (!tbody) return;

  if (reports.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:30px; color:#64748B;">
          No denied reports found.
        </td>
      </tr>
    `;
    return;
  }

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  tbody.innerHTML = reports.map((rep, index) => {
    const item = rep.rejected_item || {};
    
    const macs = item.macs || {};
    const macsStr = (macs.liters !== null && macs.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#1E3A8A;">${macs.liters} L <span style="font-size:0.75rem; color:#475569; font-weight:600;">(${macs.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#2563EB; font-weight:700; margin-top:2px;">F: ${macs.fat ?? '-'}% | S: ${macs.snf ?? '-'}%</div>`
      : dash;

    const spot = item.spot || {};
    const spotStr = (spot.liters !== null && spot.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#92400E;">${spot.liters} L <span style="font-size:0.75rem; color:#78350F; font-weight:600;">(${spot.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#D97706; font-weight:700; margin-top:2px;">F: ${spot.fat ?? '-'}% | S: ${spot.snf ?? '-'}%</div>`
      : dash;

    const diary = item.diary || {};
    const diaryStr = (diary.liters !== null && diary.liters !== undefined)
      ? `<div style="font-size:0.88rem; font-weight:800; color:#065F46;">${diary.liters} L <span style="font-size:0.75rem; color:#047857; font-weight:600;">(${diary.kg || '-'} KG)</span></div><div style="font-size:0.78rem; color:#059669; font-weight:700; margin-top:2px;">F: ${diary.fat ?? '-'}% | S: ${diary.snf ?? '-'}%</div>`
      : dash;

    const diffDisplay = item.difference && item.difference !== '-' 
      ? `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600; color:#334155;">${item.difference}</span>`
      : dash;

    let statusDisplay = '';
    let actionBtn = '';

    if (rep.status === 'report_done' || rep.status === 'resolved') {
      statusDisplay = `<span style="background:#D1FAE5; color:#065F46; padding:4px 8px; border-radius:8px; font-weight:700; font-size:0.8rem;">Report Done</span>`;
      actionBtn = `<div style="font-size:0.8rem; color:#475569;">Worker Remarks:<br><strong style="color:#0F172A;">${esc(rep.worker_remarks || '-')}</strong></div>`;
    } else {
      statusDisplay = `<span style="background:#FEE2E2; color:#991B1B; padding:4px 8px; border-radius:8px; font-weight:700; font-size:0.8rem;">Denied</span>`;
      actionBtn = `
        <button class="btn-qc" style="background:#10B981; color:white; border:none; padding:5px 12px; border-radius:6px; font-weight:700; font-size:0.8rem; cursor:pointer;" onclick="handleReportDone('${rep.id}')">
          ✅ Done
        </button>
      `;
    }

    return `
      <tr>
        <td style="font-weight:700; color:#0F172A;">${esc(rep.bmc_name)}</td>
        <td style="font-weight:600; color:#64748B;">${esc(rep.bmc_code)}</td>
        <td><strong>${rep.date}</strong></td>
        <td>${macsStr}</td>
        <td>${spotStr}</td>
        <td>${diaryStr}</td>
        <td>${diffDisplay}</td>
        <td><span style="color:#DC2626; font-weight:600; font-size:0.85rem;">${esc(rep.agm_remarks)}</span></td>
        <td>${statusDisplay}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

window.handleReportDone = async function(id) {
  const remarks = prompt('Enter your remarks for resolving this report:');
  if (remarks === null) return;
  if (!remarks.trim()) {
    showToast('Remarks are required to mark the report as done.', 'warning');
    return;
  }

  try {
    const res = await apiQcWorkerMarkReportDone(id, remarks.trim());
    showToast(res.message || 'Report marked as done.', 'success');
    await loadReports();
  } catch (err) {
    console.error('Error marking report done:', err);
    showToast('Failed to mark report as done.', 'error');
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
