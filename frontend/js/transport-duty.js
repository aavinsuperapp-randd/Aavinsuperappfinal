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
    const data = await apiGetDuties(currentFilters);
    allDuties = data.duties || [];
    renderDutiesTable(allDuties);
  } catch (err) {
    console.error('Failed to load duties:', err);
    showToast(err.message || 'Failed to load duties', 'error');
  }
}

function renderDutiesTable(duties) {
  const tbody = document.getElementById('duties-table-body');
  if (!tbody) return;

  if (duties.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No duties found for selected filters</td></tr>';
    return;
  }

  tbody.innerHTML = duties.map(duty => `
    <tr>
      <td>${formatDate(duty.duty_date)}</td>
      <td>${duty.duty_time || '—'}</td>
      <td><strong>${duty.driver_name || '—'}</strong></td>
      <td>${duty.vehicle_number || '—'}</td>
      <td>${duty.route || duty.task || '—'}</td>
      <td>${duty.worker_name || '—'}</td>
      <td><span class="badge badge-${getStatusBadge(duty.status)}">${formatStatus(duty.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="viewDutyDetails('${duty.id}')">View</button>
      </td>
    </tr>
  `).join('');
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

  document.getElementById('duty-title').textContent = `Duty #${duty.duty_number || dutyId.slice(0, 8)}`;
  document.getElementById('duty-subtitle').textContent = `${duty.driver_name || 'N/A'} • ${duty.vehicle_number || 'N/A'}`;
  
  document.getElementById('duty-date').textContent = formatDate(duty.duty_date);
  document.getElementById('duty-time').textContent = duty.duty_time || '—';
  document.getElementById('duty-driver').textContent = duty.driver_name || '—';
  document.getElementById('duty-vehicle').textContent = duty.vehicle_number || '—';
  document.getElementById('duty-route-details').textContent = duty.route || duty.task || 'No route details specified';
  document.getElementById('duty-worker').textContent = duty.worker_name || 'Not assigned';
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
