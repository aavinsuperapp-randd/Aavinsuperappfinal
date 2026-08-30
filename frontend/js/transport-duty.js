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
  if (document.getElementById('header-to-name')) {
    document.getElementById('header-to-name').textContent = profile.name;
  }

  setupSidebarToggle();
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  setupDutyFilters();
  setupDutyModal();
  setupCreateTripModal();

  document.getElementById('duty-search-input').addEventListener('input', filterDuties);

  await loadDuties();


  // Auto-open duty details if id is in URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const dutyId = urlParams.get('id');
  if (dutyId) {
    viewDutyDetails(dutyId);
  }
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
    const dType = (duty.duty_type || '').toLowerCase();
    let dutyBadgeText = '🌅 Morning';
    let dutyBadgeClass = 'badge-info';
    if (dType === 'evening' || dType === 'night duty') {
      dutyBadgeText = '🌙 Evening';
      dutyBadgeClass = 'badge-warning';
    } else if (dType === 'both') {
      dutyBadgeText = '🌅🌙 Both';
      dutyBadgeClass = 'badge-primary';
    }
    const dutyBadge = `<span class="badge ${dutyBadgeClass}" style="font-size:0.75rem;">${dutyBadgeText}</span>`;

    return `
    <tr>
      <td>${formatDate(sDate)}</td>
      <td>${formatTime(sDate)}</td>
      <td><strong>${duty.driver_name || '—'}</strong></td>
      <td>${duty.vehicle_number || '—'}</td>
      <td>${dutyBadge} <span style="margin-left:4px; font-weight:600; color:#0F172A;">${duty.route || duty.destination || duty.bmc_name || '—'}</span></td>
      <td><span class="badge badge-${getStatusBadge(duty.status)}">${formatStatus(duty.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="viewDutyDetails('${duty.id}')">View</button>
        <button class="btn btn-outline btn-sm" onclick="copyDutyDetailsById('${duty.id}')" style="margin-left:4px; font-weight:700; border-color:#CBD5E1; color:#2563EB;">📋 Copy</button>
      </td>
    </tr>
  `}).join('');
}

let driversList = [];
let vehiclesList = [];
let bmcsList = [];

let selectedBmcs = [];
let currentBmcToAssign = null;
let isBmcSelectionSaved = false;

async function setupCreateTripModal() {
  const btnCreate = document.getElementById('btn-create-trip');
  const modal = document.getElementById('create-trip-modal');
  const btnClose = document.getElementById('create-trip-modal-close');
  const btnCancel = document.getElementById('create-trip-cancel');
  const form = document.getElementById('create-trip-form');
  const searchInput = document.getElementById('ct-bmc-search');
  const btnSaveBmcs = document.getElementById('btn-save-bmcs');
  const dateInput = document.getElementById('ct-macs-date');
  const periodSelect = document.getElementById('ct-macs-period');

  if (!btnCreate || !modal) return;

  btnCreate.addEventListener('click', async () => {
    selectedBmcs = [];
    isBmcSelectionSaved = false;
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    renderSelectedBmcs();
    lockStep2();
    openModal('create-trip-modal');
    await fetchCreateTripOptions();
  });

  btnClose.addEventListener('click', () => closeModal('create-trip-modal'));
  btnCancel.addEventListener('click', () => closeModal('create-trip-cancel'));

  const handleMacsFilterChange = async () => {
    const selDate = dateInput?.value || new Date().toISOString().split('T')[0];
    const selPeriod = periodSelect?.value || 'both';
    try {
      const bRes = await apiGetBmcsList(selDate, selPeriod);
      bmcsList = bRes.bmcs || [];
      renderAvailableBmcs(searchInput?.value.trim() || '');
      renderSelectedBmcs();
    } catch (err) {
      console.error('Failed to reload BMC MACS data:', err);
    }
  };

  if (dateInput) dateInput.addEventListener('change', handleMacsFilterChange);
  if (periodSelect) periodSelect.addEventListener('change', handleMacsFilterChange);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderAvailableBmcs(searchInput.value.trim());
    });
  }

  // Button 1: Save & Confirm BMC Details
  if (btnSaveBmcs) {
    btnSaveBmcs.addEventListener('click', () => {
      if (selectedBmcs.length === 0) {
        showToast('Cannot save empty BMC list. Please add at least one BMC with compartment assignment.', 'error');
        lockStep2();
        return;
      }
      isBmcSelectionSaved = true;
      unlockStep2();
      showToast(`✅ ${selectedBmcs.length} BMC details saved & confirmed! Step 2 is now unlocked.`, 'success');
    });
  }

  // Setup compartment sub-modal
  const compCancel = document.getElementById('comp-modal-cancel');
  const compBtns = document.querySelectorAll('.btn-compartment');

  if (compCancel) {
    compCancel.addEventListener('click', () => closeModal('compartment-modal'));
  }

  compBtns.forEach(btn => {
    btn.onclick = () => {
      const comp = btn.getAttribute('data-comp');
      if (currentBmcToAssign && comp) {
        selectedBmcs.push({
          bmc_id: currentBmcToAssign.id,
          bmc_name: currentBmcToAssign.name,
          compartment: comp
        });
        closeModal('compartment-modal');
        currentBmcToAssign = null;
        isBmcSelectionSaved = false;
        lockStep2('⚠️ BMC list modified. Click "Save & Confirm BMC Details" to apply changes.');
        renderSelectedBmcs();
        renderAvailableBmcs(document.getElementById('ct-bmc-search')?.value.trim() || '');
      }
    };
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isBmcSelectionSaved || selectedBmcs.length === 0) {
      showToast('Please click "Save & Confirm BMC Details" (Step 1) before assigning duty.', 'error');
      return;
    }

    const btnSubmit = document.getElementById('create-trip-submit');
    const driverSelect = document.getElementById('ct-driver');
    const vehicleSelect = document.getElementById('ct-vehicle');
    const routeInput = document.getElementById('ct-route');
    const periodSelect = document.getElementById('ct-macs-period');

    if (!driverSelect.value) { showToast('Please select a driver.', 'error'); return; }
    if (!vehicleSelect.value) { showToast('Please select a vehicle.', 'error'); return; }
    if (!routeInput.value.trim()) { showToast('Please enter a Route Name.', 'error'); return; }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Assigning...';

    const vehicleId = vehicleSelect.value;
    const vehicleObj = vehiclesList.find(v => v.id === vehicleId);

    const nowIso = new Date().toISOString();

    const payload = {
      assigned_driver_id: driverSelect.value,
      vehicle_id: vehicleId || null,
      vehicle_number: vehicleObj ? vehicleObj.board_number : null,
      selected_bmcs: selectedBmcs,
      route: routeInput.value.trim(),
      duty_type: periodSelect ? periodSelect.value : 'morning',
      scheduled_start_time: nowIso,
      remarks: document.getElementById('ct-remarks').value.trim()
    };

    try {
      const driverTripResult = await apiCreateDriverTrip(payload);
      const driverTripId = driverTripResult?.trip?.id;

      // Also create a P&I AGM pending trip record so the P&I AGM can assign a Field Worker
      try {
        const driverObj = driversList.find(d => d.id === driverSelect.value);
        const driverName = driverObj ? driverObj.name : 'Driver';
        const tankerNum = vehicleObj ? vehicleObj.board_number : 'Tanker';
        const firstBmc = selectedBmcs[0] || null;

        await apiCreateTransportTrip({
          id: driverTripId,
          trip_name: `Trip - ${routeInput.value.trim()}`,
          driver_name: driverName,
          tanker_number: tankerNum,
          route_description: routeInput.value.trim(),
          bmc_id: firstBmc ? firstBmc.bmc_id : null,
          out_time: nowIso
        });
      } catch (toErr) {
        console.warn('Transport trip record creation warning:', toErr.message);
      }

      showToast('Driver trip assigned successfully! Pending P&I AGM Field Worker assignment.', 'success');
      closeModal('create-trip-modal');
      form.reset();
      selectedBmcs = [];
      isBmcSelectionSaved = false;
      lockStep2();
      renderSelectedBmcs();
      loadDuties();
    } catch (err) {
      showToast(err.message || 'Failed to assign trip', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = '🚀 Assign Driver Duty';
    }
  });
}

function lockStep2(msg = '⚠️ Select BMCs above and click "Save & Confirm BMC Details".') {
  isBmcSelectionSaved = false;
  const hint = document.getElementById('bmc-save-status-hint');
  const step2 = document.getElementById('duty-assignment-step2');
  const submitBtn = document.getElementById('create-trip-submit');

  if (hint) {
    hint.textContent = msg;
    hint.style.color = '#DC2626';
  }
  if (step2) {
    step2.style.opacity = '0.5';
    step2.style.pointerEvents = 'none';
    step2.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
  }
}

function unlockStep2() {
  const hint = document.getElementById('bmc-save-status-hint');
  const step2 = document.getElementById('duty-assignment-step2');
  const submitBtn = document.getElementById('create-trip-submit');

  if (hint) {
    hint.textContent = `✅ BMC Selection Saved (${selectedBmcs.length} BMC${selectedBmcs.length === 1 ? '' : 's'} Confirmed)`;
    hint.style.color = '#16A34A';
  }
  if (step2) {
    step2.style.opacity = '1';
    step2.style.pointerEvents = 'auto';
    step2.querySelectorAll('input, select, textarea').forEach(el => el.disabled = false);
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

function renderAvailableBmcs(query = '') {
  const bmcContainer = document.getElementById('ct-bmcs-container');
  if (!bmcContainer) return;

  const filtered = bmcsList.filter(b =>
    !query || (b.name || '').toLowerCase().includes(query.toLowerCase()) || (b.location || '').toLowerCase().includes(query.toLowerCase()) || (b.route_name || b.bmc_routes?.name || '').toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    bmcContainer.innerHTML = '<span class="text-muted text-sm" style="padding:8px;">No matching BMCs found</span>';
    return;
  }

  // Group by Route Name
  const groups = {};
  filtered.forEach(b => {
    const rName = b.bmc_routes?.name || b.route_name || b.route || 'Unassigned Route';
    if (!groups[rName]) groups[rName] = [];
    groups[rName].push(b);
  });

  let html = '';
  Object.keys(groups).forEach((rName, gIdx) => {
    const gList = groups[rName];
    html += `
      <div style="margin-top:${gIdx === 0 ? '0' : '14px'}; margin-bottom:6px; padding:6px 12px; background:linear-gradient(135deg, #1e293b, #334155); border-radius:8px; font-size:0.85rem; font-weight:800; color:#FFFFFF; display:flex; justify-space-between; align-items:center;">
        <span style="display:flex; align-items:center; gap:6px;">🛣️ Route: ${rName}</span>
        <span style="font-size:0.75rem; color:#FFFFFF; background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:12px; margin-left:auto;">${gList.length} BMC${gList.length !== 1 ? 's' : ''}</span>
      </div>
    `;

    html += gList.map(b => {
      const isSelected = selectedBmcs.some(item => item.bmc_id === b.id);
      const selectedItem = selectedBmcs.find(item => item.bmc_id === b.id);
      const macsQtyStr = (b.macs_quantity_kg !== null && b.macs_quantity_kg !== undefined) ? `${b.macs_quantity_kg} KG` : '-';

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; margin-bottom:6px; border: 1.5px solid ${isSelected ? '#86EFAC' : '#E2E8F0'}; border-radius: 10px; background: ${isSelected ? '#F0FDF4' : '#FFFFFF'}; transition: all 0.2s ease;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <strong style="font-size: 0.92rem; color: #0F172A;">🏢 ${b.name}</strong>
            <span style="font-size:0.78rem; font-weight:700; color:${b.macs_quantity_kg ? '#1D4ED8' : '#64748B'}; background:${b.macs_quantity_kg ? '#EFF6FF' : '#F1F5F9'}; padding:3px 8px; border-radius:6px; border:1px solid ${b.macs_quantity_kg ? '#BFDBFE' : '#E2E8F0'};">
              MACS: ${macsQtyStr}
            </span>
            ${b.location ? `<span style="font-size: 0.8rem; color: #64748B;">(${b.location})</span>` : ''}
          </div>
          ${isSelected
            ? `<span class="badge badge-success" style="font-size: 0.78rem; padding:5px 10px; font-weight:700;">✓ Added (${selectedItem.compartment})</span>`
            : `<button type="button" class="btn btn-outline btn-sm" onclick="promptCompartment('${b.id}')" style="padding: 6px 14px; font-weight: 700; border-radius:8px; border-color:#2563EB; color:#2563EB; background:#F0F7FF;">➕ Add</button>`
          }
        </div>
      `;
    }).join('');
  });

  bmcContainer.innerHTML = html;
}

window.promptCompartment = function(bmcId) {
  const bmc = bmcsList.find(b => b.id === bmcId);
  if (!bmc) return;
  currentBmcToAssign = bmc;
  document.getElementById('comp-modal-bmc-name').textContent = `Assign ${bmc.name} to Compartment`;
  openModal('compartment-modal');
};

function renderSelectedBmcs() {
  const container = document.getElementById('ct-selected-bmcs-list');
  const countEl = document.getElementById('ct-selected-count');
  if (countEl) countEl.textContent = `${selectedBmcs.length} BMC${selectedBmcs.length === 1 ? '' : 's'} selected`;

  if (!container) return;

  if (selectedBmcs.length === 0) {
    container.innerHTML = '<span class="text-muted text-sm" style="font-style: italic;">No BMCs selected yet. Search and click (+) Add above.</span>';
    updateVehicleUtilization();
    return;
  }

  // Group assigned BMCs by compartment: Front, Mid, Back
  const compFront = selectedBmcs.filter(b => b.compartment === 'Front');
  const compMid = selectedBmcs.filter(b => b.compartment === 'Mid');
  const compBack = selectedBmcs.filter(b => b.compartment === 'Back');

  const getBmcWeightDisplay = (bObj) => {
    const fullBmc = bmcsList.find(b => b.id === bObj.bmc_id);
    if (fullBmc?.macs_quantity_kg !== null && fullBmc?.macs_quantity_kg !== undefined) {
      return `${fullBmc.macs_quantity_kg} KG`;
    }
    return '-'; // Show - if no MACS data
  };

  const getBmcWeightValue = (bObj) => {
    const fullBmc = bmcsList.find(b => b.id === bObj.bmc_id);
    if (fullBmc?.macs_quantity_kg !== null && fullBmc?.macs_quantity_kg !== undefined) {
      return Number(fullBmc.macs_quantity_kg);
    }
    return 0; // Don't add generic capacity if no real MACS data
  };

  const frontKg = compFront.reduce((acc, b) => acc + getBmcWeightValue(b), 0);
  const midKg = compMid.reduce((acc, b) => acc + getBmcWeightValue(b), 0);
  const backKg = compBack.reduce((acc, b) => acc + getBmcWeightValue(b), 0);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:14px; margin-top:8px;">
      
      <!-- FRONT COMPARTMENT -->
      <div style="background:#FEF2F2; border:1.5px solid #FECACA; border-radius:12px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #FCA5A5; padding-bottom:6px;">
          <strong style="font-size:0.88rem; color:#991B1B; display:flex; align-items:center; gap:4px;">🔴 FRONT Compartment</strong>
          <span style="font-size:0.78rem; font-weight:800; color:#B91C1C; background:#FEE2E2; padding:3px 8px; border-radius:12px; border:1px solid #FCA5A5;">${frontKg.toLocaleString()} KG</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${compFront.length === 0 ? '<span class="text-xs text-muted" style="padding:4px 0;">No BMC assigned</span>' : compFront.map((item, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:8px 10px; border-radius:8px; border:1px solid #FCA5A5; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
              <span style="font-size:0.83rem; font-weight:700; color:#0F172A;">${idx+1}. ${item.bmc_name} <span style="color:#64748B; font-weight:500; font-size:0.78rem; margin-left:4px;">(${getBmcWeightDisplay(item)})</span></span>
              <button type="button" onclick="removeSelectedBmcByBmcId('${item.bmc_id}')" style="border:none; background:#FEE2E2; color:#DC2626; font-size:0.85rem; width:24px; height:24px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:800;" title="Remove">✕</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- MID COMPARTMENT -->
      <div style="background:#FFFBEB; border:1.5px solid #FDE68A; border-radius:12px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #FCD34D; padding-bottom:6px;">
          <strong style="font-size:0.88rem; color:#92400E; display:flex; align-items:center; gap:4px;">🟡 MID Compartment</strong>
          <span style="font-size:0.78rem; font-weight:800; color:#B45309; background:#FEF3C7; padding:3px 8px; border-radius:12px; border:1px solid #FCD34D;">${midKg.toLocaleString()} KG</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${compMid.length === 0 ? '<span class="text-xs text-muted" style="padding:4px 0;">No BMC assigned</span>' : compMid.map((item, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:8px 10px; border-radius:8px; border:1px solid #FCD34D; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
              <span style="font-size:0.83rem; font-weight:700; color:#0F172A;">${idx+1}. ${item.bmc_name} <span style="color:#64748B; font-weight:500; font-size:0.78rem; margin-left:4px;">(${getBmcWeightDisplay(item)})</span></span>
              <button type="button" onclick="removeSelectedBmcByBmcId('${item.bmc_id}')" style="border:none; background:#FEF3C7; color:#B45309; font-size:0.85rem; width:24px; height:24px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:800;" title="Remove">✕</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- BACK COMPARTMENT -->
      <div style="background:#EFF6FF; border:1.5px solid #BFDBFE; border-radius:12px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #93C5FD; padding-bottom:6px;">
          <strong style="font-size:0.88rem; color:#1E40AF; display:flex; align-items:center; gap:4px;">🔵 BACK Compartment</strong>
          <span style="font-size:0.78rem; font-weight:800; color:#1D4ED8; background:#DBEAFE; padding:3px 8px; border-radius:12px; border:1px solid #93C5FD;">${backKg.toLocaleString()} KG</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${compBack.length === 0 ? '<span class="text-xs text-muted" style="padding:4px 0;">No BMC assigned</span>' : compBack.map((item, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:8px 10px; border-radius:8px; border:1px solid #93C5FD; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
              <span style="font-size:0.83rem; font-weight:700; color:#0F172A;">${idx+1}. ${item.bmc_name} <span style="color:#64748B; font-weight:500; font-size:0.78rem; margin-left:4px;">(${getBmcWeightDisplay(item)})</span></span>
              <button type="button" onclick="removeSelectedBmcByBmcId('${item.bmc_id}')" style="border:none; background:#DBEAFE; color:#1E40AF; font-size:0.85rem; width:24px; height:24px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:800;" title="Remove">✕</button>
            </div>
          `).join('')}
        </div>
      </div>

    </div>
  `;

  updateVehicleUtilization();
}

window.removeSelectedBmcByBmcId = function(bmcId) {
  selectedBmcs = selectedBmcs.filter(item => item.bmc_id !== bmcId);
  isBmcSelectionSaved = false;
  lockStep2('⚠️ BMC list modified. Click "Save & Confirm BMC Details" to apply changes.');
  renderSelectedBmcs();
  renderAvailableBmcs(document.getElementById('ct-bmc-search')?.value.trim() || '');
};

window.removeSelectedBmc = function(index) {
  selectedBmcs.splice(index, 1);
  isBmcSelectionSaved = false;
  lockStep2('⚠️ BMC list modified. Click "Save & Confirm BMC Details" to apply changes.');
  renderSelectedBmcs();
  renderAvailableBmcs(document.getElementById('ct-bmc-search')?.value.trim() || '');
};

function updateVehicleUtilization() {
  const card = document.getElementById('vehicle-utilization-card');
  const capLabel = document.getElementById('util-vehicle-cap');
  const assignedLabel = document.getElementById('util-assigned-kg');
  const badge = document.getElementById('utilization-badge');
  const bar = document.getElementById('utilization-bar');

  if (!card) return;

  const vehicleId = document.getElementById('ct-vehicle')?.value;
  const vehicle = vehiclesList.find(v => v.id === vehicleId);

  // Get vehicle capacity in KG from vehicle record (default 10,000 KG if missing)
  const vehicleCapKg = vehicle?.capacity_kg || vehicle?.capacity || 10000;

  // Calculate assigned BMC total milk weight
  const totalAssignedKg = selectedBmcs.reduce((sum, item) => {
    const fullBmc = bmcsList.find(b => b.id === item.bmc_id);
    if (fullBmc?.macs_quantity_kg !== null && fullBmc?.macs_quantity_kg !== undefined) {
      return sum + Number(fullBmc.macs_quantity_kg);
    }
    return sum;
  }, 0);

  const percent = Math.min(100, Math.round((totalAssignedKg / vehicleCapKg) * 100));

  card.style.display = 'block';
  if (capLabel) capLabel.textContent = `${vehicleCapKg.toLocaleString()} KG`;
  if (assignedLabel) assignedLabel.textContent = `${totalAssignedKg.toLocaleString()} KG`;

  if (badge) {
    badge.textContent = `${percent}% Utilized`;
    if (percent > 85) {
      badge.style.background = '#16A34A'; // GREEN
      if (bar) bar.style.background = '#16A34A';
    } else if (percent >= 80) {
      badge.style.background = '#D97706'; // ORANGE
      if (bar) bar.style.background = '#D97706';
    } else {
      badge.style.background = '#DC2626'; // RED
      if (bar) bar.style.background = '#DC2626';
    }
  }

  if (bar) bar.style.width = `${percent}%`;
}

async function fetchCreateTripOptions() {
  try {
    const dateInput = document.getElementById('ct-macs-date');
    const periodSelect = document.getElementById('ct-macs-period');
    
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
    const selDate = dateInput?.value || new Date().toISOString().split('T')[0];
    const selPeriod = periodSelect?.value || 'both';

    const [dRes, vRes, bRes] = await Promise.all([
      apiGetDriversList(),
      apiGetVehicles(),
      apiGetBmcsList(selDate, selPeriod)
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

    vehicleSel.addEventListener('change', () => {
      updateVehicleUtilization();
    });

    renderAvailableBmcs();
    renderSelectedBmcs();

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

let currentDutyForDeletion = null;
let dutyMap = null;
let dutyMapPolyline = null;
let dutyMapMarker = null;
let dutyMapInterval = null;

async function viewDutyDetails(dutyId) {
  let duty = allDuties.find(d => d.id === dutyId);
  if (!duty) {
    try {
      const res = await apiGetDriverTrip(dutyId);
      duty = res?.trip;
    } catch (err) {
      console.error('Failed to fetch duty details fallback:', err);
    }
  }
  if (!duty) {
    showToast('Duty not found', 'error');
    return;
  }
  currentDutyForDeletion = duty;

  const sDate = duty.scheduled_start_time ? new Date(duty.scheduled_start_time) : new Date(duty.created_at);

  document.getElementById('duty-title').textContent = `Trip #${duty.trip_number || dutyId.slice(0, 8)}`;
  document.getElementById('duty-subtitle').textContent = `${duty.driver_name || 'N/A'} • ${duty.vehicle_number || 'N/A'}`;
  
  document.getElementById('duty-date').textContent = formatDate(sDate);
  document.getElementById('duty-time').textContent = formatTime(sDate);

  const dutyTypeEl = document.getElementById('duty-type');
  if (dutyTypeEl) {
    const dType = (duty.duty_type || '').toLowerCase();
    let dutyText = '🌅 Morning Duty';
    let badgeClass = 'badge-info';
    if (dType === 'evening' || dType === 'night duty') {
      dutyText = '🌙 Evening Duty';
      badgeClass = 'badge-warning';
    } else if (dType === 'both') {
      dutyText = '🌅🌙 Both Duty';
      badgeClass = 'badge-primary';
    }
    dutyTypeEl.innerHTML = `<span class="badge ${badgeClass}">${dutyText}</span>`;
  }

  document.getElementById('duty-driver').textContent = duty.driver_name || '—';
  document.getElementById('duty-vehicle').textContent = duty.vehicle_number || '—';
  
  const routeText = duty.route || duty.destination || duty.bmc_name || 'No route details specified';
  document.getElementById('duty-route-details').textContent = routeText;

  // Render Assigned BMCs List using 4-Tier Robust Decoder
  const bmcsContainer = document.getElementById('duty-bmcs-list-container');
  if (bmcsContainer) {
    let bmcsArray = [];

    // Tier 1: Direct selected_bmcs array
    if (Array.isArray(duty.selected_bmcs) && duty.selected_bmcs.length > 0) {
      bmcsArray = duty.selected_bmcs;
    }
    // Tier 2: Check embedded __BMC_DATA__ JSON in remarks or destination
    else if (duty.remarks && duty.remarks.includes('__BMC_DATA__=')) {
      try {
        const jsonStr = duty.remarks.split('__BMC_DATA__=')[1];
        bmcsArray = JSON.parse(jsonStr);
      } catch (e) {}
    }
    else if (duty.destination && duty.destination.startsWith('[{"')) {
      try { bmcsArray = JSON.parse(duty.destination); } catch (e) {}
    }

    // Tier 3: Parse formatted string (e.g., "1. Thirumangalam — Front | 2. Kalligudi — Mid")
    if (bmcsArray.length === 0 && (duty.bmc_name || duty.destination || duty.route)) {
      const rawText = duty.bmc_name || duty.destination || duty.route || '';
      if (rawText.includes(' — ') || rawText.includes(' | ') || rawText.includes(' ➔ ')) {
        const parts = rawText.split(/\s*(?:\||➔)\s*/);
        bmcsArray = parts.map(p => {
          const clean = p.replace(/^\d+\.\s*/, '').trim();
          const [name, comp] = clean.split(/\s*—\s*/);
          return {
            bmc_name: (name || clean).replace(/^BMC\s*[-–]?\s*/i, ''),
            compartment: comp || 'Front'
          };
        });
      } else if (rawText && !rawText.toLowerCase().includes('no route')) {
        bmcsArray = [{ bmc_name: rawText.replace(/^BMC\s*[-–]?\s*/i, ''), compartment: 'Front' }];
      }
    }

    if (bmcsArray.length === 0) {
      bmcsContainer.innerHTML = `
        <div style="padding: 12px; background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; color: #991B1B; font-weight: 600; font-size: 0.88rem;">
          ⚠️ No specific BMC details recorded for this duty.
        </div>
      `;
    } else {
      bmcsContainer.innerHTML = bmcsArray.map((b, idx) => {
        const rawName = b.bmc_name || b.name || 'BMC';
        const name = rawName.replace(/^BMC\s*[-–]?\s*/i, '');
        const comp = b.compartment || 'Front';
        const compBadge = comp === 'Front' ? 'badge-danger' : comp === 'Mid' ? 'badge-warning' : 'badge-info';
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-weight: 800; color: #2563EB; font-size: 0.95rem; width: 24px;">${idx + 1}.</span>
              <span style="font-weight: 700; color: #0F172A; font-size: 0.92rem;">🏢 BMC ${name}</span>
            </div>
            <span class="badge ${compBadge}" style="font-size: 0.78rem; font-weight: 700;">${comp} Compartment</span>
          </div>
        `;
      }).join('');
    }
  }

  document.getElementById('duty-status').innerHTML = `<span class="badge badge-${getStatusBadge(duty.status)}">${formatStatus(duty.status)}</span>`;

  // Clean user remarks (strip internal __BMC_DATA__ string)
  const cleanRemarks = (duty.remarks || '').split('\n__BMC_DATA__=')[0].trim();
  document.getElementById('duty-remarks').textContent = cleanRemarks || 'No remarks';

  setupDutyMap(duty);

  openModal('duty-detail-modal');
}

function formatDutyToCopyText(duty) {
  if (!duty) return '';

  const tripName = duty.route || duty.trip_name || duty.destination || duty.bmc_name || 'N/A';
  
  let rawRemarks = duty.remarks || '';
  const cleanRemarks = rawRemarks.split('\n__BMC_DATA__=')[0].split('\n__JOURNEY_DATA__=')[0].trim() || 'No remarks';

  let bmcsArray = [];

  if (Array.isArray(duty.selected_bmcs) && duty.selected_bmcs.length > 0) {
    bmcsArray = duty.selected_bmcs;
  }
  else if (duty.remarks && duty.remarks.includes('__BMC_DATA__=')) {
    try {
      const jsonStr = duty.remarks.split('__BMC_DATA__=')[1].split('\n')[0];
      bmcsArray = JSON.parse(jsonStr);
    } catch (e) {}
  }
  else if (duty.destination && duty.destination.startsWith('[{"')) {
    try { bmcsArray = JSON.parse(duty.destination); } catch (e) {}
  }

  if (bmcsArray.length === 0 && (duty.bmc_name || duty.destination || duty.route)) {
    const rawText = duty.bmc_name || duty.destination || duty.route || '';
    if (rawText.includes(' — ') || rawText.includes(' | ') || rawText.includes(' ➔ ')) {
      const parts = rawText.split(/\s*(?:\||➔)\s*/);
      bmcsArray = parts.map(p => {
        const clean = p.replace(/^\d+\.\s*/, '').trim();
        const [name, comp] = clean.split(/\s*—\s*/);
        return {
          bmc_name: (name || clean).replace(/^BMC\s*[-–]?\s*/i, ''),
          compartment: comp || 'Front'
        };
      });
    } else if (rawText && !rawText.toLowerCase().includes('no route')) {
      bmcsArray = [{ bmc_name: rawText.replace(/^BMC\s*[-–]?\s*/i, ''), compartment: 'Front' }];
    }
  }

  let bmcSectionText = 'No BMCs listed';
  if (bmcsArray.length > 0) {
    const bmcLines = bmcsArray.map((b, idx) => {
      const rawName = b.bmc_name || b.name || 'BMC';
      const name = rawName.replace(/^BMC\s*[-–]?\s*/i, '').trim();
      const comp = (b.compartment || 'Front').toLowerCase();
      return `${idx + 1}. ${name} ( ${comp} )`;
    });
    bmcSectionText = bmcLines.join('\n');
  }

  return `trip name : ${tripName}\nremarks : ${cleanRemarks}\nbmc :\n\n${bmcSectionText}`;
}

window.copyDutyTextToClipboard = async function(duty) {
  if (!duty) return;
  const text = formatDutyToCopyText(duty);
  
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showToast('Duty details copied to clipboard!', 'success');
  } catch (err) {
    console.error('Failed to copy text:', err);
    showToast('Failed to copy to clipboard', 'error');
  }
};

window.copyDutyDetailsById = function(dutyId) {
  let duty = allDuties.find(d => d.id === dutyId);
  if (duty) {
    copyDutyTextToClipboard(duty);
  } else {
    apiGetDriverTrip(dutyId).then(res => {
      if (res?.trip) copyDutyTextToClipboard(res.trip);
    }).catch(e => showToast('Failed to fetch duty details for copy', 'error'));
  }
};

function setupDutyModal() {
  const modal = document.getElementById('duty-detail-modal');
  const closeBtn = document.getElementById('duty-modal-close');
  const dismissBtn = document.getElementById('duty-modal-dismiss-btn');
  const deleteBtn = document.getElementById('duty-delete-btn');
  const copyTopBtn = document.getElementById('duty-copy-top-btn');
  const copyBottomBtn = document.getElementById('duty-copy-bottom-btn');

  closeBtn?.addEventListener('click', () => closeModal('duty-detail-modal'));
  dismissBtn?.addEventListener('click', () => closeModal('duty-detail-modal'));

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal('duty-detail-modal');
  });

  const handleCopyClick = () => {
    if (currentDutyForDeletion) {
      copyDutyTextToClipboard(currentDutyForDeletion);
    }
  };

  copyTopBtn?.addEventListener('click', handleCopyClick);
  copyBottomBtn?.addEventListener('click', handleCopyClick);

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (!currentDutyForDeletion) return;
      openDeleteDutyModal(currentDutyForDeletion);
    };
  }

  setupDeleteDutyConfirmModal();
}

function openDeleteDutyModal(duty) {
  const targetRouteEl = document.getElementById('delete-target-route');
  const inputEl = document.getElementById('delete-duty-confirm-input');
  const hintEl = document.getElementById('delete-duty-match-hint');
  const confirmBtn = document.getElementById('btn-confirm-delete-duty');

  const targetText = duty.route || duty.destination || duty.bmc_name || `Duty #${duty.trip_number || duty.id.slice(0, 8)}`;
  targetRouteEl.textContent = targetText;
  inputEl.value = '';

  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.5';
  hintEl.textContent = '❌ Text does not match';
  hintEl.style.color = '#DC2626';

  openModal('delete-duty-modal');

  inputEl.oninput = () => {
    const isExact = inputEl.value.trim() === targetText.trim();
    if (isExact) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      hintEl.textContent = '✓ Exact match! Click below to permanently delete this duty.';
      hintEl.style.color = '#16A34A';
    } else {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      hintEl.textContent = '❌ Text does not match exact Route/Task details';
      hintEl.style.color = '#DC2626';
    }
  };
}

function setupDeleteDutyConfirmModal() {
  const cancelBtn = document.getElementById('btn-cancel-delete-duty');
  const confirmBtn = document.getElementById('btn-confirm-delete-duty');

  if (cancelBtn) {
    cancelBtn.onclick = () => closeModal('delete-duty-modal');
  }

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      if (!currentDutyForDeletion) return;

      const inputEl = document.getElementById('delete-duty-confirm-input');
      const targetText = document.getElementById('delete-target-route').textContent;

      if (inputEl.value.trim() !== targetText.trim()) {
        showToast('Confirmation text does not match. Duty was NOT deleted.', 'error');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting...';

      try {
        await apiDeleteDriverTrip(currentDutyForDeletion.id);
        showToast('Duty deleted successfully.', 'success');
        closeModal('delete-duty-modal');
        closeModal('duty-detail-modal');
        currentDutyForDeletion = null;
        loadDuties();
      } catch (err) {
        showToast(err.message || 'Failed to delete duty', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Permanent Delete Duty';
      }
    };
  }
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
    if (modalId === 'duty-detail-modal') {
      if (dutyMapInterval) clearInterval(dutyMapInterval);
    }
  }
}

async function setupDutyMap(duty) {
  const mapSection = document.getElementById('duty-map-section');
  if (dutyMapInterval) clearInterval(dutyMapInterval);

  if (['started', 'in_progress', 'active', 'returning'].includes(duty.status) || (duty.journey_path && duty.journey_path.length > 0) || duty.start_lat) {
    mapSection.classList.remove('hidden');
    
    // Ensure map initializes after modal shows
    setTimeout(() => {
      if (!dutyMap) {
        dutyMap = L.map('driver-journey-map').setView([11.1271, 78.6569], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(dutyMap);
      }
      // Force leaflet to resize properly inside modal
      dutyMap.invalidateSize();
      updateMapData(duty.id);
      
      if (['started', 'in_progress', 'active', 'returning'].includes(duty.status)) {
        dutyMapInterval = setInterval(() => updateMapData(duty.id), 10000);
      }
    }, 300);
  } else {
    mapSection.classList.add('hidden');
  }
}

async function updateMapData(tripId) {
  try {
    const data = await transportFetch(`/api/transport/driver-trips/${tripId}`);
    const trip = data.trip;
    if (!trip) return;

    let remarks = trip.remarks || '';
    let interruptions = [];
    if (remarks.includes('__INTERRUPTIONS_DATA__=')) {
      try {
        const iStr = remarks.split('__INTERRUPTIONS_DATA__=')[1].split('\n')[0];
        interruptions = JSON.parse(iStr);
      } catch(e) {}
    }
    
    let journey = [];
    if (remarks.includes('__JOURNEY_DATA__=')) {
      try {
        const jStr = remarks.split('__JOURNEY_DATA__=')[1].split('\n')[0];
        journey = JSON.parse(jStr);
      } catch(e) {}
    }
    
    let latestLoc = null;

    if (trip.end_lat && trip.end_lng) {
      latestLoc = { lat: trip.end_lat, lng: trip.end_lng, timestamp: trip.updated_at };
    } else if (journey.length > 0) {
      latestLoc = journey[journey.length - 1];
    } else if (trip.start_lat && trip.start_lng) {
      latestLoc = { lat: trip.start_lat, lng: trip.start_lng, timestamp: trip.started_at };
      journey.push(latestLoc); // treat start as first point if journey array is empty
    }

    // Status UI
    const isTrackingOff = interruptions.length > 0 && interruptions[interruptions.length - 1].status.includes('OFF');
    document.getElementById('map-status-text').textContent = trip.status === 'completed' ? 'Trip Completed (Tracking Stopped)' : isTrackingOff ? '🔴 Tracking OFF' : '🟢 Tracking ON';
    document.getElementById('map-status-text').style.color = trip.status === 'completed' ? '#475569' : isTrackingOff ? '#DC2626' : '#16A34A';
    document.getElementById('map-last-update').textContent = latestLoc ? formatDateTime(latestLoc.timestamp) : 'No data';

    // Interruptions list
    const intrContainer = document.getElementById('map-interruptions-container');
    const intrList = document.getElementById('map-interruptions-list');
    if (interruptions.length > 0) {
      intrContainer.classList.remove('hidden');
      intrList.innerHTML = interruptions.map(i => `<li>${formatTime(i.timestamp)}: ${i.status}</li>`).join('');
    } else {
      intrContainer.classList.add('hidden');
    }

    // Draw Map Elements — Connect sequential GPS points using a RED Leaflet polyline
    if (dutyMapPolyline) dutyMap.removeLayer(dutyMapPolyline);
    if (dutyMapMarker) dutyMap.removeLayer(dutyMapMarker);

    const latlngs = journey.map(point => [Number(point.lat), Number(point.lng)]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const lastPt = latlngs.length > 0 ? latlngs[latlngs.length - 1] : null;
      if (!lastPt || lastPt[0] !== Number(latestLoc.lat) || lastPt[1] !== Number(latestLoc.lng)) {
        latlngs.push([Number(latestLoc.lat), Number(latestLoc.lng)]);
      }
    }

    if (latlngs.length > 0) {
      dutyMapPolyline = L.polyline(latlngs, { color: '#DC2626', weight: 4, opacity: 0.9 }).addTo(dutyMap);
      dutyMap.fitBounds(dutyMapPolyline.getBounds());
    }

    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const isLive = trip.status !== 'completed' && latestLoc.timestamp && (Date.now() - new Date(latestLoc.timestamp).getTime() < 10 * 60 * 1000);
      const timeStr = isLive ? `🟢 Live Location (Updated: ${formatTime(latestLoc.timestamp)})` : `📍 Last Location (${formatDateTime(latestLoc.timestamp)})`;
      dutyMapMarker = L.marker([Number(latestLoc.lat), Number(latestLoc.lng)]).addTo(dutyMap);
      dutyMapMarker.bindPopup(`<div style="font-family:'Outfit',sans-serif; padding:2px;"><b>👨‍✈️ ${trip.driver_name || 'Driver'}</b><br><span style="font-size:0.82rem; color:#475569;">🚛 ${trip.vehicle_number || 'Tanker'}</span><br><span style="font-size:0.8rem; color:#0F172A; font-weight:600;">${timeStr}</span></div>`).openPopup();
    }
  } catch (err) {
    console.error('Failed to update map data:', err);
  }
}

// ─── ALL ACTIVE DUTIES LIVE MAP ────────────────────────────────
let allActiveMap = null;
let allActiveMapMarkers = {};
let allActiveMapPolylines = {};
let allActiveMapInterval = null;

function setupAllActiveMap() {
  const mapDiv = document.getElementById('all-active-duties-map');
  if (!mapDiv) return;

  if (!allActiveMap) {
    allActiveMap = L.map('all-active-duties-map').setView([11.1271, 78.6569], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(allActiveMap);
  }

  setTimeout(() => {
    allActiveMap.invalidateSize();
    updateAllActiveMapData();
  }, 400);

  if (allActiveMapInterval) clearInterval(allActiveMapInterval);
  allActiveMapInterval = setInterval(updateAllActiveMapData, 10000);
}

async function updateAllActiveMapData() {
  if (!allActiveMap) return;

  try {
    const data = await transportFetch('/api/transport/active-duties-locations');
    const activeDuties = data.activeDuties || [];

    const liveCount = activeDuties.filter(d => d.is_live).length;
    const badge = document.getElementById('active-map-count-badge');
    const updateTime = document.getElementById('active-map-update-time');
    
    if (badge) {
      if (liveCount === activeDuties.length && activeDuties.length > 0) {
        badge.textContent = `🟢 ${activeDuties.length} Active (Live)`;
      } else {
        badge.textContent = `${activeDuties.length} Active Driver${activeDuties.length === 1 ? '' : 's'}${liveCount > 0 ? ` (${liveCount} Live)` : ''}`;
      }
    }
    if (updateTime) {
      updateTime.textContent = `Updated: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    const currentTripIds = new Set(activeDuties.map(d => d.id));

    // Remove markers & polylines for trips that are no longer active
    Object.keys(allActiveMapMarkers).forEach(tripId => {
      if (!currentTripIds.has(tripId)) {
        if (allActiveMapMarkers[tripId]) allActiveMap.removeLayer(allActiveMapMarkers[tripId]);
        if (allActiveMapPolylines[tripId]) allActiveMap.removeLayer(allActiveMapPolylines[tripId]);
        delete allActiveMapMarkers[tripId];
        delete allActiveMapPolylines[tripId];
      }
    });

    const allBounds = [];

    // Render each active driver's route and position marker separately
    activeDuties.forEach(duty => {
      const journey = duty.journey_path || [];
      const latlngs = journey
        .map(pt => [Number(pt.lat), Number(pt.lng)])
        .filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]) && pt[0] !== 0 && pt[1] !== 0);

      const latest = duty.latest_location;
      if (latest && !isNaN(Number(latest.lat)) && !isNaN(Number(latest.lng)) && Number(latest.lat) !== 0) {
        const lastPt = latlngs.length > 0 ? latlngs[latlngs.length - 1] : null;
        if (!lastPt || lastPt[0] !== Number(latest.lat) || lastPt[1] !== Number(latest.lng)) {
          latlngs.push([Number(latest.lat), Number(latest.lng)]);
        }
      }

      // 1. Draw RED polyline for this specific driver's trip
      if (allActiveMapPolylines[duty.id]) {
        allActiveMap.removeLayer(allActiveMapPolylines[duty.id]);
      }

      if (latlngs.length > 0) {
        const polyline = L.polyline(latlngs, {
          color: '#DC2626', // Connected RED line
          weight: 4,
          opacity: 0.9
        }).addTo(allActiveMap);
        allActiveMapPolylines[duty.id] = polyline;
        latlngs.forEach(pt => allBounds.push(pt));
      }

      // 2. Draw current location marker for driver
      if (allActiveMapMarkers[duty.id]) {
        allActiveMap.removeLayer(allActiveMapMarkers[duty.id]);
      }

      if (latest && !isNaN(Number(latest.lat)) && !isNaN(Number(latest.lng)) && Number(latest.lat) !== 0) {
        const lat = Number(latest.lat);
        const lng = Number(latest.lng);
        allBounds.push([lat, lng]);

        // Custom Leaflet DivIcon for Live vs Last Location
        const isLive = duty.is_live;
        const iconHtml = isLive
          ? `<div style="position:relative; width:34px; height:34px; display:flex; align-items:center; justify-content:center;">
               <div style="position:absolute; width:32px; height:32px; border-radius:50%; background:rgba(22, 163, 74, 0.35); animation:pulse 1.8s infinite ease-out;"></div>
               <div style="position:relative; width:26px; height:26px; border-radius:50%; background:#16A34A; border:2px solid #FFFFFF; box-shadow:0 2px 6px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; color:#FFF; font-size:13px; font-weight:700;">🚛</div>
             </div>`
          : `<div style="position:relative; width:30px; height:30px; display:flex; align-items:center; justify-content:center;">
               <div style="position:relative; width:24px; height:24px; border-radius:50%; background:#475569; border:2px solid #FFFFFF; box-shadow:0 2px 5px rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center; color:#FFF; font-size:12px;">📍</div>
             </div>`;

        const customIcon = L.divIcon({
          className: 'custom-driver-map-pin',
          html: iconHtml,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          popupAnchor: [0, -18]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(allActiveMap);

        const timeString = isLive
          ? `🟢 Live Location (Updated: ${formatTime(latest.timestamp)})`
          : `📍 Last Known Location (${formatDateTime(latest.timestamp)})`;

        const popupContent = `
          <div style="font-family:'Outfit',sans-serif; padding:6px; min-width:210px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px;">
              <span style="font-weight:800; font-size:0.95rem; color:#0F172A;">👨‍✈️ ${duty.driver_name}</span>
              <span class="badge ${isLive ? 'badge-success' : 'badge-neutral'}" style="font-size:0.7rem; font-weight:700;">
                ${isLive ? '🟢 Live' : '📍 Last Location'}
              </span>
            </div>
            <div style="font-size:0.82rem; color:#475569; margin-top:2px;">🚛 Vehicle: <strong>${duty.vehicle_number}</strong></div>
            <div style="font-size:0.82rem; color:#475569;">🗺️ Route: <strong>${duty.route}</strong></div>
            <div style="font-size:0.78rem; color:#2563EB; margin-top:4px; font-weight:600;">Status: ${formatStatus(duty.status)}</div>
            <div style="font-size:0.78rem; color:#475569; margin-top:4px; padding-top:4px; border-top:1px solid #E2E8F0;">
              ${timeString}
            </div>
            <button type="button" class="btn btn-primary btn-sm" style="width:100%; margin-top:8px; padding:5px 8px; font-size:0.8rem; font-weight:700;" onclick="viewDutyDetails('${duty.id}')">
              📋 View Duty Details
            </button>
          </div>
        `;
        marker.bindPopup(popupContent);
        allActiveMapMarkers[duty.id] = marker;
      }
    });

    if (allBounds.length > 0) {
      allActiveMap.fitBounds(allBounds, { padding: [40, 40], maxZoom: 14 });
    }
  } catch (err) {
    console.error('Failed to update All Active Duties Map:', err);
  }
}


