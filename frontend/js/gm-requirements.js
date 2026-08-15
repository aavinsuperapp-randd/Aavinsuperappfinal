// gm-requirements.js — GM BMC Requirements Management

let allRequirements = [];

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
  const profile = await checkAuth('gm');
  if (!profile) return;

  document.getElementById('main-gm-content').classList.remove('hidden');
  document.getElementById('header-gm-name').textContent = profile.name;

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
    const select = document.getElementById('bmc-filter-select');
    (res.bmcs || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name} (${b.district})`;
      select.appendChild(opt);
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

  if (bmcId) list = list.filter(r => String(r.bmc_id) === String(bmcId));
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

  container.innerHTML = list.map(req => {
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
              <div class="item-meta">📍 ${esc(req.bmc_location || req.bmc_district)} · 👷 ${esc(req.worker_name)} · ${new Date(req.created_at).toLocaleDateString()}</div>
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
