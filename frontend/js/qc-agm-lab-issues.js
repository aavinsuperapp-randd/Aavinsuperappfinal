// qc-agm-lab-issues.js — Lab Issue Report Tab Logic

let allLabIssues = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  const searchInput = document.getElementById('lab-issue-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderLabIssuesTable);
  }

  await loadLabIssues();
});

async function loadLabIssues() {
  try {
    const res = await apiQcAgmGetLabIssues();
    allLabIssues = res.issues || [];
    
    const countBadge = document.getElementById('lab-issues-count-badge');
    if (countBadge) {
      countBadge.textContent = `${allLabIssues.length} Rejected Item(s)`;
    }

    renderLabIssuesTable();
  } catch (err) {
    console.error('Error loading lab issue report:', err);
    showToast('Failed to load Lab Issue Report.', 'error');
  }
}

function renderLabIssuesTable() {
  const tbody = document.getElementById('lab-issues-tbody');
  if (!tbody) return;

  const query = (document.getElementById('lab-issue-search')?.value || '').trim().toLowerCase();

  const filtered = allLabIssues.filter(item => {
    const codeMatch = String(item.bmc_code || '').toLowerCase().includes(query);
    const nameMatch = String(item.bmc_name || '').toLowerCase().includes(query);
    const remarksMatch = String(item.remarks || '').toLowerCase().includes(query);
    return !query || codeMatch || nameMatch || remarksMatch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:30px; color:#64748B;">
          <div style="font-size:2rem; margin-bottom:8px;">✅</div>
          <div>No rejected lab test issues found.</div>
        </td>
      </tr>
    `;
    return;
  }

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  tbody.innerHTML = filtered.map((iss, index) => {
    const rej = iss.rejected_item || {};
    const macs = rej.macs || {};
    const spot = rej.spot || {};

    let resultsStr = '';
    if (macs.liters !== undefined || spot.liters !== undefined) {
      resultsStr = `
        <div style="font-size:0.83rem;">
          <span style="font-weight:700; color:#1E3A8A;">MACS:</span> ${macs.liters ? macs.liters + ' L (' + (macs.kg || '-') + ' KG) F:' + (macs.fat ?? '-') + '% S:' + (macs.snf ?? '-') + '%' : '-'}
          <br>
          <span style="font-weight:700; color:#92400E;">Spot:</span> ${spot.liters ? spot.liters + ' L (' + (spot.kg || '-') + ' KG) F:' + (spot.fat ?? '-') + '% S:' + (spot.snf ?? '-') + '%' : '-'}
        </div>
      `;
    } else {
      resultsStr = dash;
    }

    let statusStr = '';
    let remarksStr = `<span style="color:#DC2626; font-weight:700; font-size:0.85rem;">${esc(iss.remarks)}</span>`;

    if (iss.status === 'report_done' || iss.status === 'resolved') {
      statusStr = `
        <span style="background:#D1FAE5; color:#065F46; padding:4px 10px; border-radius:12px; font-weight:800; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;">
          ✅ Report Done
        </span>
      `;
      if (iss.worker_remarks) {
        remarksStr += `<br><div style="margin-top:6px; font-size:0.8rem; color:#475569;">Worker: <strong style="color:#0F172A;">${esc(iss.worker_remarks)}</strong></div>`;
      }
    } else {
      statusStr = `
        <span style="background:#FEE2E2; color:#991B1B; padding:4px 10px; border-radius:12px; font-weight:800; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;">
          🔴 Rejected
        </span>
      `;
    }

    return `
      <tr style="cursor:pointer;" onclick="window.location.href='bmc-detail.html?code=${encodeURIComponent(iss.bmc_code)}'">
        <td style="font-weight:700; color:#64748B;">${index + 1}</td>
        <td><strong style="color:#2563EB;">${esc(iss.bmc_code)}</strong></td>
        <td><strong style="color:#0F172A;">${esc(iss.bmc_name)}</strong></td>
        <td>${esc(iss.district)}</td>
        <td><strong>${iss.date}</strong></td>
        <td>${resultsStr}</td>
        <td>${remarksStr}</td>
        <td>${statusStr}</td>
      </tr>
    `;
  }).join('');
}
