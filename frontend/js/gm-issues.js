// gm-issues.js — GM BMC Complaints & Issues Management

let allIssues = [];
let allMasterBmcs = [];
let currentUserProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUserProfile = await checkAuth('gm');
  if (!currentUserProfile) return;

  document.getElementById('main-gm-content').classList.remove('hidden');
  document.getElementById('header-gm-name').textContent = currentUserProfile.name;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-issues-btn').addEventListener('click', loadIssues);

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
    select.innerHTML = '<option value="">All BMCs</option>';
    allMasterBmcs.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id || b.bmc_code;
      opt.textContent = `${b.name} (${b.district})`;
      select.appendChild(opt);
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

  container.innerHTML = list.map(issue => {
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
                📍 ${esc(issue.bmc_location || issue.bmc_district)} · 👷 ${esc(issue.worker_name)} · 📅 ${new Date(issue.created_at).toLocaleDateString()}
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
