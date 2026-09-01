// gm-issues.js — GM BMC Complaints & Issues Management

let allIssues = [];
let allMasterBmcs = [];
let currentUserProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUserProfile = await checkAuth('gm');
  if (!currentUserProfile) return;

  document.getElementById('main-gm-content').classList.remove('hidden');
  const nameEl = document.getElementById('header-gm-name');
  if (nameEl) nameEl.textContent = currentUserProfile.name;

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const refreshBtn = document.getElementById('refresh-issues-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadIssues);

  document.getElementById('bmc-filter-select').addEventListener('change', renderIssues);
  document.getElementById('status-filter-select').addEventListener('change', renderIssues);
  document.getElementById('severity-filter-select').addEventListener('change', renderIssues);
  document.getElementById('search-issue-input').addEventListener('input', renderIssues);

  await loadBmcDropdown();
  await loadIssues();
});

async function loadBmcDropdown() {
  try {
    const res = await apiGetGmBmcs();
    allMasterBmcs = res.bmcs || [];
    const select = document.getElementById('bmc-filter-select');
    select.innerHTML = '<option value="">All BMC Units</option>';

    const groups = {};
    allMasterBmcs.forEach(b => {
      const rName = b.bmc_routes?.name || b.route_name || 'Unassigned Route';
      if (!groups[rName]) groups[rName] = [];
      groups[rName].push(b);
    });

    Object.keys(groups).forEach(rName => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = `🛣️ Route: ${rName}`;
      groups[rName].forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id || b.bmc_code;
        opt.textContent = `${b.name} (${b.district})`;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    });
  } catch (err) {
    console.error('Failed to load BMC dropdown:', err);
  }
}

async function loadIssues() {
  try {
    const res = await apiGetGmIssues();
    allIssues = (res.issues || []).map(item => {
      const isPrioritized = item.is_prioritized || (item.remarks || '').includes('[PRIORITIZED_BY:');
      let prioritizedBy = item.prioritized_by || '';
      if (!prioritizedBy && isPrioritized) {
        const m = (item.remarks || '').match(/\[PRIORITIZED_BY:\s*([^\]]+)\]/);
        if (m) prioritizedBy = m[1].trim();
      }
      return {
        ...item,
        is_prioritized: isPrioritized,
        prioritized_by: prioritizedBy
      };
    });
    renderIssues();
  } catch (err) {
    console.error('Failed to load issues:', err);
    showToast(err.message || 'Failed to load BMC issues.', 'error');
  }
}

function renderIssues() {
  const bmcId    = document.getElementById('bmc-filter-select').value;
  const status   = document.getElementById('status-filter-select').value;
  const severity = document.getElementById('severity-filter-select').value;
  const search   = document.getElementById('search-issue-input').value.trim().toLowerCase();

  let list = [...allIssues];

  if (bmcId) {
    const selectedBmc = allMasterBmcs.find(b => String(b.id) === String(bmcId) || String(b.bmc_code) === String(bmcId));
    list = list.filter(i => {
      const matchId = String(i.bmc_id) === String(bmcId);
      const matchCode = selectedBmc && selectedBmc.bmc_code && String(i.bmc_code || i.bmc_id) === String(selectedBmc.bmc_code);
      const matchName = selectedBmc && selectedBmc.name && String(i.bmc_name).toLowerCase() === String(selectedBmc.name).toLowerCase();
      return matchId || matchCode || matchName;
    });
  }

  if (status !== 'all') {
    if (status === 'priority') {
      list = list.filter(i => i.is_prioritized);
    } else {
      list = list.filter(i => {
        const isResolved = i.status === 'completed' || (i.description && i.description.includes('[RESOLVED'));
        return status === 'completed' ? isResolved : !isResolved;
      });
    }
  }

  if (severity) list = list.filter(i => (i.severity || '').toLowerCase() === severity);

  if (search) {
    list = list.filter(i =>
      (i.bmc_name || '').toLowerCase().includes(search) ||
      (i.category || '').toLowerCase().includes(search) ||
      (i.description || '').toLowerCase().includes(search) ||
      (i.worker_name || '').toLowerCase().includes(search) ||
      (i.prioritized_by || '').toLowerCase().includes(search)
    );
  }

  // Priority ordering: Active (unresolved) prioritized complaints MUST remain at the TOP of the list
  list.sort((a, b) => {
    const aResolved = a.status === 'completed' || (a.description && a.description.includes('[RESOLVED'));
    const bResolved = b.status === 'completed' || (b.description && b.description.includes('[RESOLVED'));

    const aActivePriority = a.is_prioritized && !aResolved;
    const bActivePriority = b.is_prioritized && !bResolved;

    if (aActivePriority && !bActivePriority) return -1;
    if (!aActivePriority && bActivePriority) return 1;

    return new Date(b.created_at) - new Date(a.created_at);
  });

  const container = document.getElementById('issues-container');

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <h4>No Issues Found</h4>
        <p>No issues match your current search/filter criteria.</p>
      </div>`;
    return;
  }

  // Group issues by Route Name
  const routeGroups = {};
  list.forEach(issue => {
    const bmc = allMasterBmcs.find(b => String(b.id) === String(issue.bmc_id) || String(b.bmc_code) === String(issue.bmc_code) || String(b.name).toLowerCase() === String(issue.bmc_name).toLowerCase());
    const rName = bmc?.bmc_routes?.name || bmc?.route_name || 'Unassigned Route';
    if (!routeGroups[rName]) routeGroups[rName] = [];
    routeGroups[rName].push(issue);
  });

  let html = '';
  Object.keys(routeGroups).forEach((rName, groupIdx) => {
    const gList = routeGroups[rName];
    html += `
      <div style="grid-column: 1 / -1; margin-top: ${groupIdx === 0 ? '0' : '18px'}; margin-bottom: 8px; padding: 10px 16px; background: linear-gradient(135deg, #1e293b, #334155); color: #ffffff; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.06);">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.1rem;">🛣️</span>
          <span style="font-size:1rem;">Route: ${esc(rName)}</span>
        </div>
        <span style="background: rgba(255,255,255,0.2); font-size: 0.78rem; padding: 3px 10px; border-radius: 20px; font-weight: 600;">
          ${gList.length} Issue${gList.length !== 1 ? 's' : ''}
        </span>
      </div>
    `;

    html += gList.map(issue => {
      const isResolved = issue.status === 'completed' || (issue.description && issue.description.includes('[RESOLVED'));
      const sevClass   = `sev-${(issue.severity || 'low').toLowerCase()}`;
      const priorityUser = issue.prioritized_by || currentUserProfile?.name || 'GM';

      return `
        <div class="item-card ${issue.is_prioritized && !isResolved ? 'prioritized-card' : ''}">
          <div>
            <div class="item-card-header">
              <div class="item-bmc-info">
                <div class="item-bmc-name">🏭 ${esc(issue.bmc_name)}</div>
                <div class="item-meta">
                  🛣️ <b>${esc(rName)}</b> · 📍 ${esc(issue.bmc_location || issue.bmc_district)} · 👷 ${esc(issue.worker_name)} · 📅 ${new Date(issue.created_at).toLocaleDateString()}
                </div>
              </div>
              <div class="item-card-badges">
                ${issue.is_prioritized 
                  ? `<span class="badge badge-priority">
                       🚨 Priority (Prioritized by: ${esc(priorityUser)})
                     </span>` 
                  : ''
                }
                <span class="sev-pill ${sevClass}">${esc(issue.severity || 'Low')}</span>
                <span class="badge ${isResolved ? 'badge-success' : 'badge-danger'}">
                  ${isResolved ? '✓ Resolved' : '● Open'}
                </span>
              </div>
            </div>

            <div class="item-category-tag">
              Category: <span>${esc(issue.category)}</span>
            </div>

            <div class="issue-desc">
              💬 ${esc(issue.description)}
            </div>
          </div>

          <div class="item-footer">
            <span class="item-trip-no">Trip: ${esc(issue.trip_number || '—')}</span>
            <div class="item-actions">
              ${isResolved
                ? `<button class="btn btn-sm btn-outline" disabled style="opacity:0.5;">✓ Resolved</button>`
                : `
                  ${issue.is_prioritized
                    ? `<button class="btn btn-sm btn-prioritized-badge" disabled>🚨 Prioritized</button>`
                    : `<button class="btn btn-sm btn-prioritize-action" onclick="prioritizeIssue('${issue.id}')">⭐ Prioritize</button>`
                  }
                  <button class="btn btn-sm btn-primary" onclick="resolveIssue('${issue.id}')">✓ Mark Resolved</button>
                `
              }
              <button class="btn btn-sm btn-danger" onclick="deleteIssueByGm('${issue.id}')" title="Delete Issue Report">🗑️ Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  });

  container.innerHTML = html;
}

window.deleteIssueByGm = async function(issueId) {
  if (!confirm("Are you sure you want to delete this complaint record permanently?")) return;
  try {
    await apiGmDeleteIssue(issueId);
    showToast('Complaint record deleted successfully.', 'success');
    allIssues = allIssues.filter(i => String(i.id) !== String(issueId));
    renderIssues();
  } catch (err) {
    console.error('Error deleting issue:', err);
    showToast(err.message || 'Failed to delete complaint record.', 'error');
  }
};

window.resolveIssue = async function(issueId) {
  const confirmed = confirm("Are you sure you want to mark this complaint as resolved?");
  if (!confirmed) return;

  const target = allIssues.find(i => String(i.id) === String(issueId));
  if (target) {
    target.status = 'completed';
    renderIssues();
  }

  try {
    await apiCompleteGmIssue(issueId);
    showToast('Complaint marked as resolved!', 'success');
  } catch (err) {
    console.error('Error resolving issue:', err);
    showToast(err.message || 'Failed to resolve complaint.', 'error');
  }
};

window.prioritizeIssue = async function(issueId) {
  const username = currentUserProfile?.name || 'GM';
  const target = allIssues.find(i => String(i.id) === String(issueId));
  
  if (target) {
    target.is_prioritized = true;
    target.prioritized_by = username;
    renderIssues();
  }

  try {
    await apiPrioritizeGmIssue(issueId, username);
    showToast('Complaint has been prioritized!', 'success');
  } catch (err) {
    console.error('Error prioritizing issue:', err);
    showToast(err.message || 'Failed to prioritize complaint.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
