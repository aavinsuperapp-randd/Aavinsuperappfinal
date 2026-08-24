// gm-issues.js — GM BMC Issues Management

let allIssues = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  document.getElementById('main-pi-agm-content').classList.remove('hidden');
  document.getElementById('header-pi-agm-name').textContent = profile.name;

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
    const select = document.getElementById('bmc-filter-select');
    (res.bmcs || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
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
    allIssues = res.issues || [];
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

  if (bmcId) list = list.filter(i => String(i.bmc_id) === String(bmcId));
  if (status !== 'all') {
    list = list.filter(i => {
      const isResolved = i.status === 'completed' || (i.description && i.description.includes('[RESOLVED'));
      return status === 'completed' ? isResolved : !isResolved;
    });
  }
  if (severity) list = list.filter(i => (i.severity || '').toLowerCase() === severity);
  if (search) {
    list = list.filter(i =>
      (i.bmc_name || '').toLowerCase().includes(search) ||
      (i.category || '').toLowerCase().includes(search) ||
      (i.description || '').toLowerCase().includes(search) ||
      (i.worker_name || '').toLowerCase().includes(search)
    );
  }

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

    return `
      <div class="item-card">
        <div>
          <div class="item-card-header">
            <div>
              <div class="item-bmc-name">🏭 ${esc(issue.bmc_name)}</div>
              <div class="item-meta">
                📍 ${esc(issue.bmc_location || issue.bmc_district)} · 👷 ${esc(issue.worker_name)} · ${new Date(issue.created_at).toLocaleDateString()}
              </div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span class="sev-pill ${sevClass}">${esc(issue.severity || 'Low')}</span>
              <span class="badge ${isResolved ? 'badge-success' : 'badge-danger'}">
                ${isResolved ? '✓ Resolved' : '● Open'}
              </span>
            </div>
          </div>

          <div style="font-size:0.8rem; font-weight:700; color:#4B5563; margin-top:6px;">
            Category: <span style="color:#2563EB;">${esc(issue.category)}</span>
          </div>

          <div class="issue-desc">
            💬 ${esc(issue.description)}
          </div>
        </div>

        <div class="item-footer">
          <span class="text-xs text-muted">Trip: ${esc(issue.trip_number || '—')}</span>
          ${isResolved
            ? `<button class="btn btn-sm btn-outline" disabled style="opacity:0.5;">✓ Resolved</button>`
            : `<button class="btn btn-sm btn-primary" onclick="resolveIssue('${issue.id}')">✓ Mark Resolved</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

window.resolveIssue = async function(issueId) {
  try {
    await apiCompleteGmIssue(issueId);
    showToast('Issue marked as resolved!', 'success');
    await loadIssues();
  } catch (err) {
    console.error('Error resolving issue:', err);
    showToast(err.message || 'Failed to resolve issue.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
