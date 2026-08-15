// worker-trip.js — Active Trip Management Page Logic

let currentTripId = null;
let currentTrip = null;
let currentVisits = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;

  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Extract trip ID from URL
  const params = new URLSearchParams(window.location.search);
  currentTripId = params.get('id');

  if (!currentTripId) {
    // If no ID passed, try fetching active trip
    const activeRes = await apiGetActiveTrip();
    if (activeRes.trip) {
      currentTripId = activeRes.trip.id;
    } else {
      showToast('No active trip found.', 'error');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
      return;
    }
  }

  await loadTripDetails();
  setupAddBmcModal();
  setupCloseTripModal();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}

async function loadTripDetails() {
  try {
    const res = await apiGetTrip(currentTripId);
    currentTrip = res.trip;
    currentVisits = res.visits || [];

    renderTripHeader();
    renderVisitsList();

  } catch (err) {
    console.error('Error loading trip details:', err);
    showToast(err.message || 'Failed to load trip', 'error');
  }
}

function renderTripHeader() {
  document.getElementById('trip-title').textContent = currentTrip.trip_name;
  document.getElementById('trip-number-display').textContent = `Trip #: ${currentTrip.trip_number || 'N/A'}`;
  
  const statusBadge = document.getElementById('trip-status-badge');
  if (currentTrip.status === 'completed') {
    statusBadge.textContent = 'Completed';
    statusBadge.className = 'status-pill pill-completed';
    document.getElementById('close-trip-btn').style.display = 'none';
    document.getElementById('add-bmc-to-trip-btn').style.display = 'none';
  } else {
    statusBadge.textContent = 'Active';
    statusBadge.className = 'status-pill pill-active';
  }

  document.getElementById('meta-driver').textContent = currentTrip.driver_name || (currentTrip.driver ? currentTrip.driver.name : 'Unassigned');
  document.getElementById('meta-tanker').textContent = currentTrip.tanker_number || (currentTrip.tanker ? currentTrip.tanker.board_number : 'Unassigned');

  document.getElementById('meta-out-time').textContent = new Date(currentTrip.out_time).toLocaleString();
  document.getElementById('meta-in-time').textContent = currentTrip.in_time ? new Date(currentTrip.in_time).toLocaleString() : 'In Progress';
}

function renderVisitsList() {
  const container = document.getElementById('visit-list-container');
  document.getElementById('visit-count-display').textContent = currentVisits.length;

  if (currentVisits.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏭</div>
        <div class="empty-state-title">No BMCs added to this trip yet</div>
        <div class="empty-state-desc">Click "+ Add BMC to Route" to add the first Bulk Milk Cooler to visit.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = currentVisits.map((v, idx) => {
    const isDone = v.status === 'completed';
    const bmcName = v.bmc ? v.bmc.name : 'Unknown BMC';
    const bmcLocation = v.bmc ? `${v.bmc.location}, ${v.bmc.district}` : '';
    const compText = v.compartment ? `Compartment: ${v.compartment.toUpperCase()}` : 'Compartment: Not set';

    return `
      <div class="visit-item">
        <div class="visit-seq ${isDone ? 'done' : ''}">${v.visit_sequence}</div>
        <div class="visit-item-body">
          <div class="visit-item-name">${esc(bmcName)}</div>
          <div class="visit-item-meta">📍 ${esc(bmcLocation)} | ${esc(compText)}</div>
        </div>
        <div style="margin-right: 12px;">
          <span class="status-pill ${isDone ? 'pill-completed' : (v.status === 'in_progress' ? 'pill-active' : 'pill-pending')}">
            ${v.status === 'completed' ? '✓ Visited' : (v.status === 'in_progress' ? '● In Visit' : '○ Pending')}
          </span>
        </div>
        <div class="visit-item-actions" style="display:flex; gap:8px;">
          <a href="bmc-visit.html?visit_id=${v.id}" class="btn btn-sm ${isDone ? 'btn-outline' : 'btn-primary'}">
            ${isDone ? 'View / Edit Visit' : 'Perform Visit →'}
          </a>
          <button class="btn btn-outline btn-sm" style="color:#ef4444; border-color:#fca5a5;" onclick="deleteBmcVisit('${v.id}', '${esc(bmcName)}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.deleteBmcVisit = async function(visitId, bmcName) {
  if (!confirm(`Are you sure you want to delete the visit for "${bmcName}" from this trip route?`)) return;
  try {
    showToast('Removing BMC visit...', 'info');
    await apiDeleteVisit(visitId);
    showToast('BMC visit removed from trip route!', 'success');
    await loadTripDetails();
  } catch (err) {
    showToast(err.message || 'Failed to delete BMC visit.', 'error');
  }
};


function setupAddBmcModal() {
  const modal = document.getElementById('add-bmc-modal');
  const openBtn = document.getElementById('add-bmc-to-trip-btn');
  const closeBtn = document.getElementById('add-bmc-close');
  const input = document.getElementById('add-bmc-input');
  const resultsDiv = document.getElementById('add-bmc-results');

  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    input.focus();
    performBmcSearch('');
  });

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  let timer;
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => performBmcSearch(e.target.value), 300);
  });

  async function performBmcSearch(q) {
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Loading BMCs...</div></div>';
    try {
      const res = await apiSearchBmcs(q);
      const list = res.bmcs || [];
      
      // Filter out already added BMCs
      const existingBmcIds = currentVisits.map(v => v.bmc_id);
      
      if (list.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No BMC found.</div></div>';
        return;
      }

      resultsDiv.innerHTML = list.map(b => {
        const alreadyAdded = existingBmcIds.includes(b.id);
        return `
          <div class="search-result-item" style="${alreadyAdded ? 'opacity:0.5;' : ''}">
            <div class="search-result-img">
              ${b.profile_image_url ? `<img src="${esc(b.profile_image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" alt="${esc(b.name)}">` : '🏭'}
            </div>
            <div style="flex:1;">
              <div class="search-result-name">${esc(b.name)}</div>
              <div class="search-result-meta">📍 ${esc(b.location)}, ${esc(b.district)}</div>
            </div>
            <div>
              ${alreadyAdded 
                ? `<span class="status-pill pill-completed">Added</span>` 
                : `<button class="btn btn-primary btn-sm" onclick="addBmcToTrip('${b.id}')">+ Add</button>`}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      resultsDiv.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Error: ${esc(err.message)}</div></div>`;
    }
  }
}

window.addBmcToTrip = async function(bmcId) {
  try {
    showToast('Adding BMC to route...', 'info');
    await apiAddBmcToTrip(currentTripId, bmcId);
    showToast('BMC added to route!', 'success');
    document.getElementById('add-bmc-modal').classList.add('hidden');
    await loadTripDetails();
  } catch (err) {
    console.error('Failed to add BMC:', err);
    showToast(err.message || 'Failed to add BMC.', 'error');
  }
};

function setupCloseTripModal() {
  const modal = document.getElementById('close-trip-modal');
  const openBtn = document.getElementById('close-trip-btn');
  const cancelBtn = document.getElementById('close-modal-cancel');
  const confirmBtn = document.getElementById('confirm-close-trip-btn');
  const inTimeInput = document.getElementById('factory-in-time');

  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    inTimeInput.value = now.toISOString().slice(0, 16);
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  confirmBtn.addEventListener('click', async () => {
    const inTime = inTimeInput.value;
    const remarks = document.getElementById('trip-closing-remarks').value;

    if (!inTime) {
      showToast('Factory IN-time is required.', 'error');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Closing...';

    try {
      await apiCompleteTrip(currentTripId, {
        in_time: new Date(inTime).toISOString(),
        remarks
      });

      showToast('Trip successfully completed & closed!', 'success');
      modal.classList.add('hidden');
      await loadTripDetails();

    } catch (err) {
      console.error('Failed to complete trip:', err);
      showToast(err.message || 'Failed to close trip.', 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Close Trip';
    }
  });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
