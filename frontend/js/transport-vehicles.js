// transport-vehicles.js — Transport Officer Vehicles Management

let allVehicles = [];
let currentEditingVehicleId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  setupSidebarToggle();
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

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
    console.log('[VEHICLES] Loaded', allVehicles.length, 'vehicles');
    renderVehiclesTable(allVehicles);
  } catch (err) {
    console.error('Failed to load vehicles:', err);
    showToast(err.message || 'Failed to load vehicles', 'error');
  }
}

function getCapacity(vehicle) {
  return vehicle.capacity_liters ?? vehicle.capacity ?? 5000;
}

function renderVehiclesTable(vehicles) {
  const tbody = document.getElementById('vehicles-table-body');
  if (!tbody) return;

  if (vehicles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No vehicles found</td></tr>';
    return;
  }

  tbody.innerHTML = vehicles.map(vehicle => {
    const totalTrips = vehicle.total_trips || 0;
    const lastUsed = vehicle.last_used ? formatDate(vehicle.last_used) : '—';
    const cap = getCapacity(vehicle);

    return `
      <tr>
        <td><strong>${vehicle.board_number}</strong></td>
        <td>${cap}L</td>
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
  const titleEl = document.getElementById('vehicle-modal-title');
  if (titleEl) titleEl.textContent = 'Add New Vehicle';
  
  document.getElementById('vehicle-id').value = '';
  document.getElementById('vehicle-board-number').value = '';
  document.getElementById('vehicle-capacity').value = '5000';
  document.getElementById('vehicle-compartments').value = '2';
  document.getElementById('vehicle-status').value = 'true';
  
  const submitBtn = document.getElementById('vehicle-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Save Vehicle';
  openModal('vehicle-modal');
}

function editVehicle(vehicleId) {
  const vehicle = allVehicles.find(v => String(v.id) === String(vehicleId));
  if (!vehicle) {
    showToast('Vehicle record not found', 'error');
    return;
  }

  currentEditingVehicleId = vehicle.id;
  const titleEl = document.getElementById('vehicle-modal-title');
  if (titleEl) titleEl.textContent = `Edit Vehicle: ${vehicle.board_number || ''}`;

  const cap = getCapacity(vehicle);
  console.log('[EDIT] Vehicle:', vehicle.id, 'Board:', vehicle.board_number, 'Current capacity:', cap);

  document.getElementById('vehicle-id').value = vehicle.id;
  document.getElementById('vehicle-board-number').value = vehicle.board_number || '';
  document.getElementById('vehicle-capacity').value = cap;
  document.getElementById('vehicle-compartments').value = vehicle.compartments || 2;
  document.getElementById('vehicle-status').value = vehicle.is_active !== false ? 'true' : 'false';

  const submitBtn = document.getElementById('vehicle-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Vehicle';
  openModal('vehicle-modal');
}

async function handleVehicleSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('vehicle-submit-btn');
  const originalText = submitBtn ? submitBtn.textContent : 'Save';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
  }

  const boardNumber = document.getElementById('vehicle-board-number').value.trim();
  const capacity = parseInt(document.getElementById('vehicle-capacity').value) || 5000;
  const compartments = parseInt(document.getElementById('vehicle-compartments').value) || 2;
  const isActive = document.getElementById('vehicle-status').value === 'true';

  if (!boardNumber) {
    showToast('Please enter vehicle board number', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
    return;
  }

  const vehicleData = {
    board_number: boardNumber,
    capacity_liters: capacity,
    compartments: compartments,
    is_active: isActive
  };

  console.log('[SUBMIT] Mode:', currentEditingVehicleId ? 'UPDATE' : 'CREATE');
  console.log('[SUBMIT] Vehicle ID:', currentEditingVehicleId);
  console.log('[SUBMIT] Payload:', JSON.stringify(vehicleData));

  try {
    let apiSuccess = false;

    if (currentEditingVehicleId) {
      // ── UPDATE FLOW ──
      try {
        const result = await apiUpdateVehicle(currentEditingVehicleId, vehicleData);
        console.log('[SUBMIT] API update result:', JSON.stringify(result));
        apiSuccess = true;
      } catch (apiErr) {
        console.error('[SUBMIT] API update FAILED:', apiErr.message);
      }

      // If API failed, try direct Supabase write
      if (!apiSuccess) {
        console.log('[SUBMIT] Falling back to direct Supabase write...');
        const client = await initSupabase();
        if (!client) throw new Error('Cannot connect to database');

        const { data: directResult, error: sbError } = await client
          .from('tankers')
          .update({ capacity_liters: capacity, compartments: compartments, is_active: isActive })
          .eq('id', currentEditingVehicleId)
          .select();

        console.log('[SUBMIT] Direct Supabase result:', directResult, 'error:', sbError);
        if (sbError) throw sbError;
      }

      showToast(`Vehicle "${boardNumber}" updated successfully`, 'success');

    } else {
      // ── CREATE FLOW ──
      try {
        await apiCreateVehicle(vehicleData);
        apiSuccess = true;
      } catch (apiErr) {
        console.error('[SUBMIT] API create FAILED:', apiErr.message);
      }

      if (!apiSuccess) {
        const client = await initSupabase();
        if (!client) throw new Error('Cannot connect to database');

        const { error: sbError } = await client
          .from('tankers')
          .insert({ board_number: boardNumber, capacity_liters: capacity, compartments: compartments, is_active: isActive });

        if (sbError) throw sbError;
      }

      showToast(`Vehicle "${boardNumber}" created successfully`, 'success');
    }

    closeModal('vehicle-modal');

    // Force fresh reload from server
    console.log('[SUBMIT] Reloading vehicles...');
    await loadVehicles();
    console.log('[SUBMIT] Reload complete. Checking updated value...');
    const updated = allVehicles.find(v => String(v.id) === String(currentEditingVehicleId));
    if (updated) {
      console.log('[SUBMIT] After reload - capacity_liters:', updated.capacity_liters, 'capacity:', updated.capacity);
    }

  } catch (err) {
    console.error('[SUBMIT] Final error:', err);
    showToast(err.message || 'Failed to save vehicle. Please check connection and try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = currentEditingVehicleId ? 'Update Vehicle' : 'Save Vehicle';
    }
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
  const vehicle = allVehicles.find(v => String(v.id) === String(vehicleId));
  if (!vehicle) {
    showToast('Vehicle not found', 'error');
    return;
  }

  const cap = getCapacity(vehicle);
  document.getElementById('profile-vehicle-number').textContent = vehicle.board_number;
  document.getElementById('profile-vehicle-meta').textContent = `Capacity: ${cap}L`;
  document.getElementById('profile-capacity').textContent = `${cap} Liters`;
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
