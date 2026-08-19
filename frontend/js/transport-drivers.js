// transport-drivers.js — Transport Officer Drivers Management

let allDrivers = [];
let currentEditingDriverId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  setupSidebarToggle();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Setup modals
  setupDriverModal();
  setupDriverProfileModal();

  // Setup search
  document.getElementById('driver-search-input').addEventListener('input', filterDrivers);

  // Open add driver modal
  document.getElementById('open-add-driver-btn').addEventListener('click', openAddDriverModal);

  // Load drivers
  await loadDrivers();
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

/**
 * Load Drivers
 */
async function loadDrivers() {
  try {
    const data = await apiGetDrivers();
    allDrivers = data.drivers || [];
    renderDriversTable(allDrivers);
  } catch (err) {
    console.error('Failed to load drivers:', err);
    showToast(err.message || 'Failed to load drivers', 'error');
  }
}

/**
 * Render Drivers Table
 */
function renderDriversTable(drivers) {
  const tbody = document.getElementById('drivers-table-body');
  if (!tbody) return;

  if (drivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No drivers found</td></tr>';
    return;
  }

  tbody.innerHTML = drivers.map(driver => {
    const assignedVehicle = driver.assigned_vehicle || '—';
    const totalTrips = driver.total_trips || 0;
    const lastActivity = driver.last_activity ? formatDate(driver.last_activity) : '—';

    return `
      <tr>
        <td><strong>${driver.name}</strong></td>
        <td>${driver.license_number || '—'}</td>
        <td>${driver.phone || '—'}</td>
        <td>${assignedVehicle}</td>
        <td>${totalTrips}</td>
        <td>${lastActivity}</td>
        <td><span class="badge badge-${driver.is_active ? 'success' : 'neutral'}">${driver.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="viewDriver('${driver.id}')">View</button>
          <button class="btn btn-ghost btn-sm" onclick="editDriver('${driver.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteDriver('${driver.id}', '${driver.name}')" style="color:#EF4444;">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Filter Drivers
 */
function filterDrivers() {
  const query = document.getElementById('driver-search-input').value.toLowerCase();
  const filtered = allDrivers.filter(driver =>
    (driver.name || '').toLowerCase().includes(query) ||
    (driver.phone || '').toLowerCase().includes(query) ||
    (driver.license_number || '').toLowerCase().includes(query)
  );
  renderDriversTable(filtered);
}

/**
 * Setup Driver Modal (Add/Edit)
 */
function setupDriverModal() {
  const modal = document.getElementById('driver-modal');
  const closeBtn = document.getElementById('driver-modal-close');
  const cancelBtn = document.getElementById('driver-cancel-btn');
  const form = document.getElementById('driver-form');

  closeBtn.addEventListener('click', () => closeModal('driver-modal'));
  cancelBtn.addEventListener('click', () => closeModal('driver-modal'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('driver-modal');
  });

  form.addEventListener('submit', handleDriverSubmit);
}

/**
 * Open Add Driver Modal
 */
function openAddDriverModal() {
  currentEditingDriverId = null;
  document.getElementById('driver-modal-title').textContent = '➕ Add New Driver';
  document.getElementById('driver-id').value = '';
  document.getElementById('driver-name').value = '';
  document.getElementById('driver-license').value = '';
  document.getElementById('driver-phone').value = '';
  document.getElementById('driver-status').value = 'true';
  document.getElementById('driver-submit-btn').textContent = 'Save Driver';
  openModal('driver-modal');
}

/**
 * Edit Driver
 */
function editDriver(driverId) {
  const driver = allDrivers.find(d => d.id === driverId);
  if (!driver) {
    showToast('Driver not found', 'error');
    return;
  }

  currentEditingDriverId = driverId;
  document.getElementById('driver-modal-title').textContent = '✏️ Edit Driver';
  document.getElementById('driver-id').value = driverId;
  document.getElementById('driver-name').value = driver.name || '';
  document.getElementById('driver-license').value = driver.license_number || '';
  document.getElementById('driver-phone').value = driver.phone || '';
  document.getElementById('driver-status').value = driver.is_active ? 'true' : 'false';
  document.getElementById('driver-submit-btn').textContent = 'Update Driver';
  openModal('driver-modal');
}

/**
 * Handle Driver Form Submit
 */
async function handleDriverSubmit(e) {
  e.preventDefault();

  const driverData = {
    name: document.getElementById('driver-name').value.trim(),
    license_number: document.getElementById('driver-license').value.trim(),
    phone: document.getElementById('driver-phone').value.trim(),
    is_active: document.getElementById('driver-status').value === 'true'
  };

  if (!driverData.name || !driverData.phone) {
    showToast('Please fill in required fields', 'error');
    return;
  }

  try {
    if (currentEditingDriverId) {
      await apiUpdateDriver(currentEditingDriverId, driverData);
      showToast('Driver updated successfully', 'success');
    } else {
      await apiCreateDriver(driverData);
      showToast('Driver added successfully', 'success');
    }

    closeModal('driver-modal');
    await loadDrivers();
  } catch (err) {
    console.error('Failed to save driver:', err);
    showToast(err.message || 'Failed to save driver', 'error');
  }
}

/**
 * Delete Driver
 */
async function deleteDriver(driverId, driverName) {
  if (!confirm(`Are you sure you want to delete driver "${driverName}"?`)) {
    return;
  }

  try {
    await apiDeleteDriver(driverId);
    showToast('Driver deleted successfully', 'success');
    await loadDrivers();
  } catch (err) {
    console.error('Failed to delete driver:', err);
    showToast(err.message || 'Failed to delete driver', 'error');
  }
}

/**
 * View Driver Profile
 */
async function viewDriver(driverId) {
  const driver = allDrivers.find(d => d.id === driverId);
  if (!driver) {
    showToast('Driver not found', 'error');
    return;
  }

  // Populate profile modal
  document.getElementById('profile-driver-name').textContent = driver.name;
  document.getElementById('profile-driver-meta').textContent = driver.license_number || 'No license number';
  document.getElementById('profile-license').textContent = driver.license_number || '—';
  document.getElementById('profile-phone').textContent = driver.phone || '—';
  document.getElementById('profile-vehicle').textContent = driver.assigned_vehicle || 'Not assigned';
  document.getElementById('profile-status').innerHTML = `<span class="badge badge-${driver.is_active ? 'success' : 'neutral'}">${driver.is_active ? 'Active' : 'Inactive'}</span>`;

  // Load performance data
  try {
    const perfData = await apiGetDriverPerformance(driverId);
    document.getElementById('profile-total-trips').textContent = perfData.total_trips || 0;
    document.getElementById('profile-completed-trips').textContent = perfData.completed_trips || 0;
    document.getElementById('profile-total-visits').textContent = perfData.total_visits || 0;
    document.getElementById('profile-avg-duration').textContent = formatDurationMs(perfData.avg_duration_ms);
  } catch (err) {
    console.error('Failed to load driver performance:', err);
    document.getElementById('profile-total-trips').textContent = '—';
    document.getElementById('profile-completed-trips').textContent = '—';
    document.getElementById('profile-total-visits').textContent = '—';
    document.getElementById('profile-avg-duration').textContent = '—';
  }

  openModal('driver-profile-modal');
}

/**
 * Setup Driver Profile Modal
 */
function setupDriverProfileModal() {
  const modal = document.getElementById('driver-profile-modal');
  const closeBtn = document.getElementById('driver-profile-close');
  const dismissBtn = document.getElementById('driver-profile-dismiss-btn');

  closeBtn.addEventListener('click', () => closeModal('driver-profile-modal'));
  dismissBtn.addEventListener('click', () => closeModal('driver-profile-modal'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('driver-profile-modal');
  });
}

/**
 * Modal Helpers
 */
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
