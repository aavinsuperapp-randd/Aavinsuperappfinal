// gm-bmc-profile.js — GM BMC Profile Search & Resolution

let activeBmcId = null;
let currentProfileData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  document.getElementById('main-pi-agm-content').classList.remove('hidden');
  document.getElementById('header-pi-agm-name').textContent = profile.name;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('inspect-bmc-btn').addEventListener('click', handleInspectBmc);

  setupTabs();
  await loadBmcDropdown();

  // Check URL params for bmc_id
  const params = new URLSearchParams(window.location.search);
  const urlBmcId = params.get('id') || params.get('bmc_id');
  if (urlBmcId) {
    document.getElementById('bmc-search-select').value = urlBmcId;
    await inspectBmc(urlBmcId);
  }
});

function setupTabs() {
  const buttons = document.querySelectorAll('.profile-tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.profile-tab-panel').forEach(p => p.classList.add('hidden'));
      const target = btn.dataset.tab;
      document.getElementById(target).classList.remove('hidden');
    });
  });
}

async function loadBmcDropdown() {
  try {
    const res = await apiGetGmBmcs();
    const select = document.getElementById('bmc-search-select');
    (res.bmcs || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `🏭 ${b.name} (${b.district}, ${b.location})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load BMC dropdown:', err);
  }
}

async function handleInspectBmc() {
  const bmcId = document.getElementById('bmc-search-select').value;
  if (!bmcId) {
    showToast('Please select a BMC unit first.', 'warning');
    return;
  }
  await inspectBmc(bmcId);
}

async function inspectBmc(bmcId) {
  activeBmcId = bmcId;
  try {
    const data = await apiGetGmBmcProfile(bmcId);
    currentProfileData = data;
    renderProfile();
  } catch (err) {
    console.error('Failed to load BMC profile:', err);
    showToast(err.message || 'Failed to load BMC profile.', 'error');
  }
}

function renderProfile() {
  if (!currentProfileData) return;

  document.getElementById('bmc-empty-state').classList.add('hidden');
  document.getElementById('bmc-profile-content').classList.remove('hidden');

  const { bmc, total_visits, avg_rating, requirements, issues, ratings } = currentProfileData;

  // Banner
  document.getElementById('prof-bmc-name').textContent = bmc.name || 'BMC Center';
  document.getElementById('prof-bmc-meta').textContent = `📍 ${bmc.location || ''}, ${bmc.district || ''}`;
  document.getElementById('prof-total-visits').textContent = total_visits || 0;
  document.getElementById('prof-avg-rating').textContent = avg_rating ? `${avg_rating} ★` : '—';

  // Counts
  const countReqsEl = document.getElementById('count-reqs');
  if (countReqsEl) countReqsEl.textContent = (requirements || []).length;
  document.getElementById('count-issues').textContent = (issues || []).length;
  document.getElementById('count-ratings').textContent = (ratings || []).length;

  // Issues Tab
  renderIssuesTab(issues || []);

  // Ratings Tab
  renderRatingsTab(ratings || []);
}

const PROFILE_REQ_FIELDS = [
  { key: 'acid_available',         label: 'Acids',       icon: '🧪' },
  { key: 'ftir_machine_available', label: 'FTIR Machine', icon: '🔬' },
  { key: 'seal_cutter_available',  label: 'Seal Cutter',  icon: '✂️' },
  { key: 'power_backup_available', label: 'Power Backup', icon: '⚡' },
];

function renderRequirementsTab(reqs) {
  const container = document.getElementById('prof-requirements-container');

  // Only show records that have at least one missing item or a remark
  const faultyReqs = reqs.filter(req => {
    const hasMissing = PROFILE_REQ_FIELDS.some(f => req[f.key] === false || req[f.key] === null);
    const hasRemark  = req.remarks && req.remarks.trim().length > 0;
    return hasMissing || hasRemark;
  });

  if (faultyReqs.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-4">✅ No missing requirements reported for this BMC.</div>`;
    return;
  }

  container.innerHTML = faultyReqs.map(req => {
    const isCompleted  = req.status === 'completed' || (req.remarks && req.remarks.includes('[COMPLETED'));
    const missingItems = PROFILE_REQ_FIELDS.filter(f => req[f.key] === false || req[f.key] === null);

    const faultPills = missingItems.map(f =>
      `<span class="badge badge-danger" style="margin:2px;">${f.icon} ${f.label} — Needed</span>`
    ).join('');

    return `
      <div class="item-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <span class="badge ${isCompleted ? 'badge-success' : 'badge-warning'}">
              ${isCompleted ? '✓ Completed' : '● Pending'}
            </span>
            <span class="text-xs text-muted ml-2">
              👷 <strong>${esc(req.worker_name)}</strong> · ${new Date(req.created_at).toLocaleDateString()}
            </span>
          </div>
          ${!isCompleted
            ? `<button class="btn btn-sm btn-primary" onclick="completeProfileReq('${req.id}')">✓ Mark Complete</button>`
            : `<span class="text-xs text-success font-bold">✓ Done</span>`
          }
        </div>

        <div style="margin:8px 0; display:flex; flex-wrap:wrap; gap:4px;">
          ${faultPills || '<span class="text-xs text-muted">No specific item faults — see remark below.</span>'}
        </div>

        ${req.remarks && !req.remarks.includes('[COMPLETED')
          ? `<div class="text-sm text-gray-700 mt-1">💬 ${esc(req.remarks)}</div>`
          : ''
        }
      </div>
    `;
  }).join('');
}

function renderIssuesTab(issues) {
  const container = document.getElementById('prof-issues-container');
  if (issues.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-4">No issues reported for this BMC.</div>`;
    return;
  }

  container.innerHTML = issues.map(iss => {
    const isCompleted = iss.status === 'completed' || (iss.remarks && iss.remarks.includes('[RESOLVED'));
    return `
      <div class="item-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <span class="badge ${isCompleted ? 'badge-success' : 'badge-warning'}">
              ${isCompleted ? '✓ Resolved' : '● Pending Anomaly'}
            </span>
            <span class="badge badge-neutral ml-2" style="text-transform:capitalize;">Severity: ${esc(iss.severity)}</span>
            <span class="text-xs text-muted ml-2">Worker: <strong>${esc(iss.worker_name)}</strong> | ${new Date(iss.created_at).toLocaleString()}</span>
          </div>
          ${!isCompleted ? `<button class="btn btn-sm btn-success" onclick="completeProfileIssue('${iss.id}')">✓ Tick Resolved</button>` : `<span class="text-xs text-success font-bold">✓ Resolved</span>`}
        </div>

        <div class="text-sm text-gray-900 font-bold mb-1">Category: ${esc(iss.category)}</div>
        <div class="text-sm text-gray-700 bg-white p-2 border rounded mb-2">${esc(iss.description)}</div>

        ${iss.image_url ? `<div><a href="${esc(iss.image_url)}" target="_blank" class="text-xs text-primary font-bold">📷 View Photo Attachment</a></div>` : ''}
      </div>
    `;
  }).join('');
}

function renderRatingsTab(ratings) {
  const container = document.getElementById('prof-ratings-container');
  if (ratings.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-4">No worker ratings/reviews submitted yet.</div>`;
    return;
  }

  container.innerHTML = ratings.map(rat => `
    <div class="item-card">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <div class="text-sm font-bold text-gray-900">Worker: ${esc(rat.worker_name)}</div>
        <div style="color:#F59E0B; font-weight:800; font-size:1.1rem;">${rat.overall_rating} ★</div>
      </div>
      <div class="text-xs text-muted mb-2">${new Date(rat.created_at).toLocaleString()}</div>
      ${rat.remarks ? `<div class="text-sm text-gray-700">💬 "${esc(rat.remarks)}"</div>` : '<div class="text-xs text-muted italic">No written remarks provided.</div>'}
    </div>
  `).join('');
}

window.completeProfileReq = async function(reqId) {
  try {
    await apiCompleteGmRequirement(reqId);
    showToast('Requirement completed!', 'success');
    if (activeBmcId) await inspectBmc(activeBmcId);
  } catch (err) {
    showToast(err.message || 'Failed to complete requirement.', 'error');
  }
};

window.completeProfileIssue = async function(issueId) {
  try {
    await apiCompleteGmIssue(issueId);
    showToast('Issue resolved!', 'success');
    if (activeBmcId) await inspectBmc(activeBmcId);
  } catch (err) {
    showToast(err.message || 'Failed to resolve issue.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
