// eo-bmc.js — Executive Officer BMC List & Detail Page Logic

let bmcsCache = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('executive_officer');
  if (!profile) return;

  const mainContent = document.getElementById('main-dashboard-content');
  if (mainContent) mainContent.classList.remove('hidden');

  const userDisplayName = document.getElementById('user-display-name');
  if (userDisplayName) userDisplayName.textContent = profile.name || 'Executive Officer';

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLogout();
    });
  }

  const searchInput = document.getElementById('bmc-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterAndRenderBmcs(searchInput.value.trim());
    });
  }

  const btnClose = document.getElementById('close-detail-modal');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      document.getElementById('bmc-detail-modal').classList.add('hidden');
    });
  }

  await loadAssignedBmcs();

  // Check URL query parameters for auto-opening modal
  const params = new URLSearchParams(window.location.search);
  const bmcId = params.get('id');
  if (bmcId) {
    await openBmcDetailModal(bmcId);
  }
});

async function loadAssignedBmcs() {
  const container = document.getElementById('bmc-list-container');
  try {
    const data = await eoFetch('/api/eo/bmcs');
    bmcsCache = data.bmcs || [];
    filterAndRenderBmcs('');
  } catch (err) {
    console.error('Failed to load BMCs:', err);
    if (container) {
      container.innerHTML = `<div class="text-danger p-4">Failed to load assigned BMCs (${err.message}).</div>`;
    }
  }
}

function filterAndRenderBmcs(query = '') {
  const container = document.getElementById('bmc-list-container');
  const badge = document.getElementById('bmc-count-badge');
  if (!container) return;

  let filtered = bmcsCache;
  if (query) {
    const q = query.toLowerCase();
    filtered = bmcsCache.filter(b => 
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.code && b.code.toLowerCase().includes(q)) ||
      (b.location && b.location.toLowerCase().includes(q)) ||
      (b.district && b.district.toLowerCase().includes(q)) ||
      (b.association_name && b.association_name.toLowerCase().includes(q))
    );
  }

  if (badge) badge.textContent = `${filtered.length} BMC${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1; background: #FFF;">
        <h4>No BMCs Found</h4>
        <p class="text-sm mt-1">No assigned BMC centers match your search filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(bmc => {
    const card = document.createElement('div');
    card.className = 'bmc-card';
    card.onclick = () => openBmcDetailModal(bmc.id);

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h4 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: #0F172A;">🏭 ${bmc.name}</h4>
          <div style="font-size: 0.82rem; color: #64748B; margin-top: 2px;">📍 ${bmc.location || 'Location'} • ${bmc.district || 'District'}</div>
        </div>
        <span class="badge ${bmc.is_active !== false ? 'badge-success' : 'badge-neutral'}">
          ${bmc.is_active !== false ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style="font-size: 0.78rem; color: #94A3B8; margin-top: 6px;">
        🏢 ${bmc.association_name || 'Milk Producers Association'}
      </div>

      <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #F1F5F9; display: flex; justify-content: space-between; font-size: 0.8rem; color: #475569;">
        <span>Code: <strong>${bmc.code || bmc.bmc_code || 'BMC'}</strong></span>
        <span style="color: #2563EB; font-weight: 700;">View Details ➔</span>
      </div>
    `;
    container.appendChild(card);
  });
}

async function openBmcDetailModal(bmcId) {
  const modal = document.getElementById('bmc-detail-modal');
  if (!modal) return;

  try {
    const data = await eoFetch(`/api/eo/bmcs/${bmcId}`);
    const bmc = data.bmc || {};
    const workers = bmc.assigned_workers || [];

    document.getElementById('modal-bmc-name').textContent = `🏭 ${bmc.name || 'BMC'}`;
    document.getElementById('modal-bmc-code').textContent = bmc.code || bmc.bmc_code || 'BMC';
    document.getElementById('modal-bmc-location').textContent = `📍 ${bmc.location || '—'} • ${bmc.district || '—'}`;
    document.getElementById('modal-bmc-id').textContent = bmc.id || '—';
    document.getElementById('modal-bmc-district').textContent = bmc.district || '—';
    document.getElementById('modal-bmc-address').textContent = bmc.address || bmc.location || '—';
    document.getElementById('modal-bmc-association').textContent = bmc.association_name || 'Milk Producers Association';
    document.getElementById('modal-bmc-status').innerHTML = `<span class="badge ${bmc.is_active !== false ? 'badge-success' : 'badge-neutral'}">${bmc.is_active !== false ? 'Active' : 'Inactive'}</span>`;
    document.getElementById('modal-bmc-eo').textContent = bmc.assigned_eo_name || 'Executive Officer';

    // Workers list
    const workersContainer = document.getElementById('modal-workers-list');
    if (workersContainer) {
      if (workers.length > 0) {
        workersContainer.innerHTML = workers.map(w => `
          <span class="worker-chip">👷 ${w.name} (${w.email || w.phone || 'Field Officer'})</span>
        `).join('');
      } else {
        workersContainer.innerHTML = '<span class="text-muted text-sm">No field workers recorded for this BMC.</span>';
      }
    }

    // Action Links
    document.getElementById('link-bmc-tests').href = `test-results.html?bmcId=${bmc.id}`;
    document.getElementById('link-bmc-reports').href = `reports.html?bmcId=${bmc.id}`;

    modal.classList.remove('hidden');
  } catch (err) {
    showToast(err.message || 'Failed to fetch BMC details.', 'error');
  }
}
