// transport-vehicles.js — Transport Officer Vehicles Management

let allVehicles = [];
let currentEditingVehicleId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  setupSidebarToggle();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupVehicleModal();
  setupVehicleProfileModal();

  document.getElementById('vehicle-search-input').addEventListener('input', filterVehicles);
  document.getElementById('open-add-vehicle-btn').addEventListener('click', openAddVehicleModal);

  await loadVehicles();
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

async function loadVehicles() {
  try {
    const data = await apiGetVehicles();
    allVehicles = data.vehicles || [];
    renderVehiclesTable(allVehicles);
  } catch (err) {
    console.error('Failed to load vehicles:', err);
    showToast(err.message || 'Failed to load vehicles', 'error');
  }
}

function renderVehiclesTable(vehicles) {
  const tbody = document.getElementById('vehicles-table-body');
  if (!tbody) return;

  if (vehicles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No vehicles found</td></tr>';
    return;
  }

  tbody.innerHTML = vehicles.map(vehicle => {
    const assignedDriver = vehicle.assigned_driver || '—';
    const totalTrips = vehicle.total_trips || 0;
    const lastUsed = vehicle.last_used ? formatDate(vehicle.last_used) : '—';
    const capacity = vehicle.capacity_liters ? `${vehicle.capacity_liters}L` : '—';

    return `
      <tr>
        <td><strong>${vehicle.board_number}</strong></td>
        <td>Milk Tanker</td>
        <td>${capacity}</td>
        <td>${assignedDriver}</td>
        <td>${totalTrips}</td>
        <td>${lastUsed}</td>
        <td><span class="badge badge-${vehicle.is_active ? 'success' : 'neutral'}">${vehicle.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="viewVehicle('${vehicle.id}')">View</button>
          <button class="btn btn-ghost btn-sm" onclick="editVehicle('${vehicle.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteVehicle('${vehicle.id}', '${vehicle.board_number}')" style="color:#EF4444;">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterVehicles() {
  const query = document.getElementById('vehicle-search-input').value.toLowerCase();
  const filtered = allVehicles.filter(vehicle =>
    (vehicle.board_number || '').toLowerCase().includes(query)
  );
  renderVehiclesTable(filtered);
}

function setupVehicleModal() {
  const modal = document.getElementById('vehicle-modal');
  const closeBtn = document.getElementById('vehicle-modal-close');
  const cancelBtn = document.getElementById('vehicle-cancel-btn');
  const form = document.getElementById('vehicle-form');

  closeBtn.addEventListener('click', () => closeModal('vehicle-modal'));
  cancelBtn.addEventListener('click', () => closeModal('vehicle-modal'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('vehicle-modal');
  });

  form.addEventListener('submit', handleVehicleSubmit);
}

function openAddVehicleModal() {
  currentEditingVehicleId = null;
  document.getElementById('vehicle-modal-title').textContent = '➕ Add New Vehicle';
  document.getElementById('vehicle-id').value = '';
  document.getElementById('vehicle-board-number').value = '';
  document.getElementById('vehicle-capacity').value = '5000';
  document.getElementById('vehicle-compartments').value = '2';
  document.getElementById('vehicle-status').value = 'true';
  document.getElementById('vehicle-submit-btn').textContent = 'Save Vehicle';
  openModal('vehicle-modal');
}

function editVehicle(vehicleId) {
  const vehicle = allVehicles.find(v => v.id === vehicleId);
  if (!vehicle) {
    showToast('Vehicle not found', 'error');
    return;
  }

  currentEditingVehicleId = vehicleId;
  document.getElementById('vehicle-modal-title').textContent = '✏️ Edit Vehicle';
  document.getElementById('vehicle-id').value = vehicleId;
  document.getElementById('vehicle-board-number').value = vehicle.board_number || '';
  document.getElementById('vehicle-capacity').value = vehicle.capacity_liters || 5000;
  document.getElementById('vehicle-compartments').value = vehicle.compartments || 2;
  document.getElementById('vehicle-status').value = vehicle.is_active ? 'true' : 'false';
  document.getElementById('vehicle-submit-btn').textContent = 'Update Vehicle';
  openModal('vehicle-modal');
}

async function handleVehicleSubmit(e) {
  e.preventDefault();

  const vehicleData = {
    board_number: document.getElementById('vehicle-board-number').value.trim(),
    capacity_liters: parseInt(document.getElementById('vehicle-capacity').value) || 5000,
    compartments: parseInt(document.getElementById('vehicle-compartments').value) || 2,
    is_active: document.getElementById('vehicle-status').value === 'true'
  };

  if (!vehicleData.board_number) {
    showToast('Please enter vehicle board number', 'error');
    return;
  }

  try {
    if (currentEditingVehicleId) {
      await apiUpdateVehicle(currentEditingVehicleId, vehicleData);
      showToast('Vehicle updated successfully', 'success');
    } else {
      await apiCreateVehicle(vehicleData);
      showToast('Vehicle added successfully', 'success');
    }

    closeModal('vehicle-modal');
    await loadVehicles();
  } catch (err) {
    console.error('Failed to save vehicle:', err);
    showToast(err.message || 'Failed to save vehicle', 'error');
  }
}

async function deleteVehicle(vehicleId, boardNumber) {
  if (!confirm(`Are you sure you want to delete vehicle "${boardNumber}"?`)) {
    return;
  }

  try {
    await apiDeleteVehicle(vehicleId);
    showToast('Vehicle deleted successfully', 'success');
    await loadVehicles();
  } catch (err) {
    console.error('Failed to delete vehicle:', err);
    showToast(err.message || 'Failed to delete vehicle', 'error');
  }
}

async function viewVehicle(vehicleId) {
  const vehicle = allVehicles.find(v => v.id === vehicleId);
  if (!vehicle) {
    showToast('Vehicle not found', 'error');
    return;
  }

  document.getElementById('profile-vehicle-number').textContent = vehicle.board_number;
  document.getElementById('profile-vehicle-meta').textContent = `Capacity: ${vehicle.capacity_liters || 5000}L`;
  document.getElementById('profile-capacity').textContent = vehicle.capacity_liters ? `${vehicle.capacity_liters} Liters` : '—';
  document.getElementById('profile-compartments').textContent = vehicle.compartments || 2;
  document.getElementById('profile-vehicle-status').innerHTML = `<span class="badge badge-${vehicle.is_active ? 'success' : 'neutral'}">${vehicle.is_active ? 'Active' : 'Inactive'}</span>`;

  try {
    const perfData = await apiGetVehiclePerformance(vehicleId);
    document.getElementById('profile-assigned-driver').textContent = perfData.assigned_driver || 'Not assigned';
    document.getElementById('profile-vehicle-trips').textContent = perfData.total_trips || 0;
    document.getElementById('profile-vehicle-visits').textContent = perfData.total_visits || 0;
    document.getElementById('profile-last-used').textContent = perfData.last_used ? formatDate(perfData.last_used) : 'Never';
  } catch (err) {
    console.error('Failed to load vehicle performance:', err);
    document.getElementById('profile-assigned-driver').textContent = '—';
    document.getElementById('profile-vehicle-trips').textContent = '—';
    document.getElementById('profile-vehicle-visits').textContent = '—';
    document.getElementById('profile-last-used').textContent = '—';
  }

  openModal('vehicle-profile-modal');
}

function setupVehicleProfileModal() {
  const modal = document.getElementById('vehicle-profile-modal');
  const closeBtn = document.getElementById('vehicle-profile-close');
  const dismissBtn = document.getElementById('vehicle-profile-dismiss-btn');

  closeBtn.addEventListener('click', () => closeModal('vehicle-profile-modal'));
  dismissBtn.addEventListener('click', () => closeModal('vehicle-profile-modal'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('vehicle-profile-modal');
  });
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
