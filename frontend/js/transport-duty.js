// transport-duty.js — Transport Officer Duty Management

let allDuties = [];
let currentFilters = {
  date: '',
  status: '',
  dateRange: 'all'
};

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  setupSidebarToggle();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupDutyFilters();
  setupDutyModal();
  setupCreateTripModal();

  document.getElementById('duty-search-input').addEventListener('input', filterDuties);

  await loadDuties();
});

function setupSidebarToggle() {
  const sidebar = document.getElementById('transport-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar || !toggleBtn || !overlay) return;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

function setupDutyFilters() {
  // Date picker
  const datePicker = document.getElementById('duty-date-filter');
  datePicker.addEventListener('change', () => {
    currentFilters.date = datePicker.value;
    currentFilters.dateRange = '';
    loadDuties();
  });

  // Status filter
  const statusFilter = document.getElementById('duty-status-filter');
  statusFilter.addEventListener('change', () => {
    currentFilters.status = statusFilter.value;
    loadDuties();
  });

  // Quick date presets
  document.getElementById('btn-today').addEventListener('click', () => {
    setDatePreset('today');
  });

  document.getElementById('btn-this-week').addEventListener('click', () => {
    setDatePreset('this_week');
  });

  document.getElementById('btn-all').addEventListener('click', () => {
    setDatePreset('all');
  });
}

function setDatePreset(preset) {
  // Update button states
  document.querySelectorAll('.type-toggle-btn').forEach(btn => btn.classList.remove('active'));
  
  if (preset === 'today') {
    document.getElementById('btn-today').classList.add('active');
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('duty-date-filter').value = today;
    currentFilters.date = today;
    currentFilters.dateRange = '';
  } else if (preset === 'this_week') {
    document.getElementById('btn-this-week').classList.add('active');
    currentFilters.date = '';
    currentFilters.dateRange = 'this_week';
    document.getElementById('duty-date-filter').value = '';
  } else if (preset === 'all') {
    document.getElementById('btn-all').classList.add('active');
    currentFilters.date = '';
    currentFilters.dateRange = 'all';
    document.getElementById('duty-date-filter').value = '';
  }

  loadDuties();
}

async function loadDuties() {
  try {
    const data = await apiGetDriverTrips(currentFilters);
    allDuties = data.trips || [];
    renderDutiesTable(allDuties);
  } catch (err) {
    console.error('Failed to load driver trips:', err);
    showToast(err.message || 'Failed to load driver trips', 'error');
  }
}

function renderDutiesTable(duties) {
  const tbody = document.getElementById('duties-table-body');
  if (!tbody) return;

  if (duties.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">No driver trips found for selected filters</td></tr>';
    return;
  }

  tbody.innerHTML = duties.map(duty => {
    const sDate = duty.scheduled_start_time ? new Date(duty.scheduled_start_time) : new Date(duty.created_at);
    return `
    <tr>
      <td>${formatDate(sDate)}</td>
      <td>${formatTime(sDate)}</td>
      <td><strong>${duty.driver_name || '—'}</strong></td>
      <td>${duty.vehicle_number || '—'}</td>
      <td>${duty.route || duty.destination || duty.bmc_name || '—'}</td>
      <td><span class="badge badge-${getStatusBadge(duty.status)}">${formatStatus(duty.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="viewDutyDetails('${duty.id}')">View</button>
      </td>
    </tr>
  `}).join('');
}

let driversList = [];
let vehiclesList = [];
let bmcsList = [];

async function setupCreateTripModal() {
  const btnCreate = document.getElementById('btn-create-trip');
  const modal = document.getElementById('create-trip-modal');
  const btnClose = document.getElementById('create-trip-modal-close');
  const btnCancel = document.getElementById('create-trip-cancel');
  const form = document.getElementById('create-trip-form');

  if (!btnCreate || !modal) return;

  btnCreate.addEventListener('click', async () => {
    openModal('create-trip-modal');
    await fetchCreateTripOptions();
  });

  btnClose.addEventListener('click', () => closeModal('create-trip-modal'));
  btnCancel.addEventListener('click', () => closeModal('create-trip-modal'));
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('create-trip-modal');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('create-trip-submit');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Assigning...';

    const driverSelect = document.getElementById('ct-driver');
    const vehicleSelect = document.getElementById('ct-vehicle');

    const vehicleId = vehicleSelect.value;
    const vehicleObj = vehiclesList.find(v => v.id === vehicleId);

    const checkedBmcEls = Array.from(document.querySelectorAll('.ct-bmc-checkbox:checked'));
    const bmcIds = checkedBmcEls.map(el => el.value);
    const bmcNames = checkedBmcEls.map(el => el.getAttribute('data-name'));
    const formattedBmcRoute = bmcNames.length > 0 ? bmcNames.join(' ➔ ') : '';
    const customDest = document.getElementById('ct-destination').value.trim();

    const payload = {
      assigned_driver_id: driverSelect.value,
      vehicle_id: vehicleId || null,
      vehicle_number: vehicleObj ? vehicleObj.board_number : null,
      bmc_id: bmcIds[0] || null,
      bmc_ids: bmcIds,
      bmc_name: formattedBmcRoute || null,
      bmc_names: bmcNames,
      destination: customDest || formattedBmcRoute || null,
      route: document.getElementById('ct-route').value || formattedBmcRoute || null,
      scheduled_start_time: document.getElementById('ct-start-time').value || null,
      scheduled_return_time: document.getElementById('ct-return-time').value || null,
      remarks: document.getElementById('ct-remarks').value
    };

    try {
      await apiCreateDriverTrip(payload);
      showToast('Driver trip with multiple BMCs assigned successfully', 'success');
      closeModal('create-trip-modal');
      form.reset();
      loadDuties();
    } catch (err) {
      showToast(err.message || 'Failed to assign trip', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Assign Trip';
    }
  });
}

async function fetchCreateTripOptions() {
  try {
    const [dRes, vRes, bRes] = await Promise.all([
      apiGetDriversList(),
      apiGetVehicles(),
      apiGetBmcsList()
    ]);

    driversList = dRes.drivers || [];
    vehiclesList = vRes.vehicles || [];
    bmcsList = bRes.bmcs || [];

    const driverSel = document.getElementById('ct-driver');
    driverSel.innerHTML = '<option value="">Select Driver...</option>' + 
      driversList.map(d => `<option value="${d.id}">${d.name} (${d.phone || d.email || 'Driver'})</option>`).join('');

    const vehicleSel = document.getElementById('ct-vehicle');
    vehicleSel.innerHTML = '<option value="">Select Vehicle...</option>' + 
      vehiclesList.map(v => `<option value="${v.id}">${v.board_number} (${v.vehicle_type || 'Tanker'})</option>`).join('');

    const bmcContainer = document.getElementById('ct-bmcs-container');
    if (bmcContainer) {
      if (bmcsList.length === 0) {
        bmcContainer.innerHTML = '<span class="text-muted text-sm">No BMCs available</span>';
      } else {
        bmcContainer.innerHTML = bmcsList.map(b => `
          <label style="display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #F1F5F9; cursor: pointer;">
            <input type="checkbox" class="ct-bmc-checkbox" value="${b.id}" data-name="${b.name}" style="width: 16px; height: 16px; accent-color: #2563EB;">
            <span style="font-size: 0.88rem; font-weight: 500; color: #1E293B;">🏢 ${b.name} ${b.location ? `<span style="font-size: 0.78rem; color: #64748B;">(${b.location})</span>` : ''}</span>
          </label>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Failed to fetch options', err);
  }
}


function filterDuties() {
  const query = document.getElementById('duty-search-input').value.toLowerCase();
  const filtered = allDuties.filter(duty =>
    (duty.driver_name || '').toLowerCase().includes(query) ||
    (duty.vehicle_number || '').toLowerCase().includes(query) ||
    (duty.route || '').toLowerCase().includes(query) ||
    (duty.worker_name || '').toLowerCase().includes(query)
  );
  renderDutiesTable(filtered);
}

function viewDutyDetails(dutyId) {
  const duty = allDuties.find(d => d.id === dutyId);
  if (!duty) {
    showToast('Duty not found', 'error');
    return;
  }

  const sDate = duty.scheduled_start_time ? new Date(duty.scheduled_start_time) : new Date(duty.created_at);

  document.getElementById('duty-title').textContent = `Trip #${duty.trip_number || dutyId.slice(0, 8)}`;
  document.getElementById('duty-subtitle').textContent = `${duty.driver_name || 'N/A'} • ${duty.vehicle_number || 'N/A'}`;
  
  document.getElementById('duty-date').textContent = formatDate(sDate);
  document.getElementById('duty-time').textContent = formatTime(sDate);
  document.getElementById('duty-driver').textContent = duty.driver_name || '—';
  document.getElementById('duty-vehicle').textContent = duty.vehicle_number || '—';
  document.getElementById('duty-route-details').textContent = duty.route || duty.destination || duty.bmc_name || 'No route details specified';
  document.getElementById('duty-worker').textContent = duty.bmc_name || duty.destination || 'Not assigned';
  document.getElementById('duty-status').innerHTML = `<span class="badge badge-${getStatusBadge(duty.status)}">${formatStatus(duty.status)}</span>`;
  document.getElementById('duty-remarks').textContent = duty.remarks || 'No remarks';

  openModal('duty-detail-modal');
}

function setupDutyModal() {
  const modal = document.getElementById('duty-detail-modal');
  const closeBtn = document.getElementById('duty-modal-close');
  const dismissBtn = document.getElementById('duty-modal-dismiss-btn');

  closeBtn.addEventListener('click', () => closeModal('duty-detail-modal'));
  dismissBtn.addEventListener('click', () => closeModal('duty-detail-modal'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('duty-detail-modal');
  });
}

function getStatusBadge(status) {
  const s = (status || 'pending').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'in_progress') return 'blue';
  if (s === 'assigned') return 'blue';
  if (s === 'cancelled') return 'danger';
  return 'neutral';
}

function formatStatus(status) {
  if (!status) return 'Pending';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}
