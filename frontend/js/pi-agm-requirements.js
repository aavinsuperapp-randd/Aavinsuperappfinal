// gm-requirements.js — GM BMC Requirements Management

let allRequirements = [];
let allMasterBmcs = [];

const REQ_FIELDS = [
  { key: 'acid_available',         label: 'Acids',        icon: '🧪' },
  { key: 'ftir_machine_available', label: 'FTIR Machine',  icon: '🔬' },
  { key: 'seal_cutter_available',  label: 'Seal Cutter',   icon: '✂️' },
  { key: 'power_backup_available', label: 'Power Backup',  icon: '⚡' },
];

function getMissingItems(req) {
  return REQ_FIELDS.filter(f => req[f.key] === false || req[f.key] === null);
}

function hasFault(req) {
  return getMissingItems(req).length > 0 || (req.remarks && req.remarks.trim().length > 0);
}

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  document.getElementById('main-pi-agm-content').classList.remove('hidden');
  document.getElementById('header-pi-agm-name').textContent = profile.name;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-req-btn').addEventListener('click', loadRequirements);
  document.getElementById('bmc-filter-select').addEventListener('change', renderRequirements);
  document.getElementById('status-filter-select').addEventListener('change', renderRequirements);
  document.getElementById('search-req-input').addEventListener('input', renderRequirements);

  await loadBmcDropdown();
  await loadRequirements();
});

async function loadBmcDropdown() {
  try {
    const res = await apiGetGmBmcs();
    allMasterBmcs = res.bmcs || [];
    const select = document.getElementById('bmc-filter-select');
    select.innerHTML = '<option value="">All BMCs</option>';

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
  } catch (err) { console.error('BMC dropdown error:', err); }
}

async function loadRequirements() {
  try {
    const res = await apiGetGmRequirements();
    allRequirements = res.requirements || [];
    renderRequirements();
  } catch (err) {
    console.error('Requirements error:', err);
    showToast(err.message || 'Failed to load requirements.', 'error');
  }
}

function renderRequirements() {
  const bmcId  = document.getElementById('bmc-filter-select').value;
  const status = document.getElementById('status-filter-select').value;
  const search = document.getElementById('search-req-input').value.trim().toLowerCase();

  let list = [...allRequirements].filter(hasFault);

  if (bmcId) {
    const selectedBmc = allMasterBmcs.find(b => String(b.id) === String(bmcId) || String(b.bmc_code) === String(bmcId));
    list = list.filter(r => {
      const matchId = String(r.bmc_id) === String(bmcId);
      const matchCode = selectedBmc && selectedBmc.bmc_code && String(r.bmc_code || r.bmc_id) === String(selectedBmc.bmc_code);
      const matchName = selectedBmc && selectedBmc.name && String(r.bmc_name).toLowerCase() === String(selectedBmc.name).toLowerCase();
      return matchId || matchCode || matchName;
    });
  }
  if (status !== 'all') {
    list = list.filter(r => {
      const done = r.status === 'completed' || (r.remarks && r.remarks.includes('[COMPLETED'));
      return status === 'completed' ? done : !done;
    });
  }
  if (search) {
    list = list.filter(r =>
      r.bmc_name.toLowerCase().includes(search) ||
      r.worker_name.toLowerCase().includes(search) ||
      (r.remarks || '').toLowerCase().includes(search)
    );
  }

  const container = document.getElementById('requirements-container');

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <h4>No Pending Requirements</h4>
        <p>All BMC requirements are resolved or no faults reported.</p>
      </div>`;
    return;
  }

  // Group requirements by Route Name
  const routeGroups = {};
  list.forEach(req => {
    const bmc = allMasterBmcs.find(b => String(b.id) === String(req.bmc_id) || String(b.bmc_code) === String(req.bmc_code) || String(b.name).toLowerCase() === String(req.bmc_name).toLowerCase());
    const rName = bmc?.bmc_routes?.name || bmc?.route_name || 'Unassigned Route';
    if (!routeGroups[rName]) routeGroups[rName] = [];
    routeGroups[rName].push(req);
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
          ${gList.length} Requirement${gList.length !== 1 ? 's' : ''}
        </span>
      </div>
    `;

    html += gList.map(req => {
      const isCompleted = req.status === 'completed' || (req.remarks && req.remarks.includes('[COMPLETED'));
      const missing = getMissingItems(req);

      const pills = missing.map(f =>
        `<span class="fault-pill">${f.icon} ${f.label} — Needed</span>`
      ).join('');

      return `
        <div class="item-card">
          <div>
            <div class="item-card-header">
              <div>
                <div class="item-bmc-name">🏭 ${esc(req.bmc_name)}</div>
                <div class="item-meta">🛣️ <b>${esc(rName)}</b> · 📍 ${esc(req.bmc_location || req.bmc_district)} · 👷 ${esc(req.worker_name)} · ${new Date(req.created_at).toLocaleDateString()}</div>
              </div>
              <span class="badge ${isCompleted ? 'badge-success' : 'badge-warning'}">${isCompleted ? '✓ Done' : '● Pending'}</span>
            </div>
            ${pills ? `<div class="fault-pills">${pills}</div>` : ''}
            ${req.remarks && !req.remarks.includes('[COMPLETED') ? `<div class="item-remarks">💬 ${esc(req.remarks)}</div>` : ''}
          </div>
          <div class="item-footer">
            <span class="text-xs text-muted">Trip: ${esc(req.trip_number || '—')}</span>
            ${isCompleted
              ? `<button class="btn btn-sm btn-outline" disabled style="opacity:0.5;">✓ Completed</button>`
              : `<button class="btn btn-sm btn-primary" onclick="completeRequirement('${req.id}')">✓ Mark Complete</button>`
            }
          </div>
        </div>`;
    }).join('');
  });

  container.innerHTML = html;
}

window.completeRequirement = async function(reqId) {
  try {
    await apiCompleteGmRequirement(reqId);
    showToast('Requirement marked as complete!', 'success');
    await loadRequirements();
  } catch (err) {
    showToast(err.message || 'Failed to complete requirement.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
