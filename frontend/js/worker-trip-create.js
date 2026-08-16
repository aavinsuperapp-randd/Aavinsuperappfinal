// worker-trip-create.js — Logic for starting a new collection trip with admin driver & vehicle selection

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;
  document.getElementById('worker-display').value = `${profile.name} (${profile.email})`;

  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Set default out-time to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('out-time').value = now.toISOString().slice(0, 16);

  // Load registered drivers & tankers from master list
  await loadDriversAndTankersOptions();

  // Check if active trip exists
  await checkActiveTrip();

  // Bind Form Submit
  document.getElementById('create-trip-form').addEventListener('submit', handleCreateTrip);
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}

async function loadDriversAndTankersOptions() {
  const driverSel = document.getElementById('driver-select');
  const tankerSel = document.getElementById('tanker-select');

  try {
    const [dRes, tRes] = await Promise.all([
      workerFetch('/api/drivers'),
      workerFetch('/api/tankers')
    ]);

    const drivers = dRes.drivers || [];
    const tankers = tRes.tankers || [];

    if (drivers.length === 0) {
      driverSel.innerHTML = `<option value="">-- No drivers available (Contact Admin) --</option>`;
    } else {
      driverSel.innerHTML = `<option value="">-- Select Driver --</option>` +
        drivers.map(d => `<option value="${d.id}" data-name="${esc(d.name)}">${esc(d.name)} (${esc(d.phone || 'No Phone')})</option>`).join('');
    }

    if (tankers.length === 0) {
      tankerSel.innerHTML = `<option value="">-- No vehicles available (Contact Admin) --</option>`;
    } else {
      tankerSel.innerHTML = `<option value="">-- Select Vehicle / Tanker Number --</option>` +
        tankers.map(t => `<option value="${t.id}" data-board="${esc(t.board_number)}">${esc(t.board_number)} (${t.capacity_liters || 5000} Kg Capacity)</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to load drivers/tankers options:', err);
    driverSel.innerHTML = `<option value="">Failed to load drivers</option>`;
    tankerSel.innerHTML = `<option value="">Failed to load vehicles</option>`;
  }
}

async function checkActiveTrip() {
  try {
    const activeRes = await apiGetActiveTrip();
    if (activeRes.trip) {
      const warningBox = document.getElementById('active-trip-warning');
      const form = document.getElementById('create-trip-form');
      const goToBtn = document.getElementById('go-to-active-btn');

      warningBox.classList.remove('hidden');
      form.style.opacity = '0.5';
      form.style.pointerEvents = 'none';
      goToBtn.href = `trip.html?id=${activeRes.trip.id}`;
      showToast('You already have an active trip.', 'warning');
    }
  } catch (err) {
    console.error('Error checking active trip:', err);
  }
}

async function handleCreateTrip(e) {
  e.preventDefault();

  const trip_name = document.getElementById('trip-name').value.trim();
  const driverSel = document.getElementById('driver-select');
  const tankerSel = document.getElementById('tanker-select');
  const out_time = document.getElementById('out-time').value;

  const selectedDriverOpt = driverSel.options[driverSel.selectedIndex];
  const selectedTankerOpt = tankerSel.options[tankerSel.selectedIndex];

  const driver_id = driverSel.value;
  const driver_name = selectedDriverOpt ? (selectedDriverOpt.dataset.name || selectedDriverOpt.text) : '';

  const tanker_id = tankerSel.value;
  const tanker_number = selectedTankerOpt ? (selectedTankerOpt.dataset.board || selectedTankerOpt.text) : '';

  if (!trip_name || !driver_id || !tanker_id || !out_time) {
    showToast('Please select a driver, a vehicle, and fill in all fields.', 'error');
    return;
  }

  const submitBtn = document.getElementById('submit-trip-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating Trip...';

  try {
    const res = await apiCreateTrip({
      trip_name,
      driver_name,
      tanker_number,
      driver_id,
      tanker_id,
      out_time: new Date(out_time).toISOString()
    });

    showToast('Saved', 'success');
    setTimeout(() => {
      window.location.href = `trip.html?id=${res.trip.id}`;
    }, 500);

  } catch (err) {
    console.error('Create trip error:', err);
    showToast(err.message || 'Failed to create trip.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Initiate Trip & Add BMCs';
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
