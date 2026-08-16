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
  const driverList = document.getElementById('driver-list');
  const tankerList = document.getElementById('tanker-list');

  try {
    const [dRes, tRes] = await Promise.all([
      workerFetch('/api/drivers'),
      workerFetch('/api/tankers')
    ]);

    const drivers = dRes.drivers || [];
    const tankers = tRes.tankers || [];

    if (drivers.length > 0) {
      driverList.innerHTML = drivers.map(d => `<option value="${esc(d.name)}" data-id="${d.id}"></option>`).join('');
    }

    if (tankers.length > 0) {
      tankerList.innerHTML = tankers.map(t => `<option value="${esc(t.board_number)}" data-id="${t.id}"></option>`).join('');
    }
  } catch (err) {
    console.error('Failed to load drivers/tankers options:', err);
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
  const driverVal = document.getElementById('driver-input').value.trim();
  const tankerVal = document.getElementById('tanker-input').value.trim();
  const out_time = document.getElementById('out-time').value;

  let driver_id = null;
  const driverList = document.getElementById('driver-list');
  if (driverList && driverList.options) {
    for (let opt of driverList.options) {
      if (opt.value === driverVal) {
        driver_id = opt.getAttribute('data-id');
        break;
      }
    }
  }

  let tanker_id = null;
  const tankerList = document.getElementById('tanker-list');
  if (tankerList && tankerList.options) {
    for (let opt of tankerList.options) {
      if (opt.value === tankerVal) {
        tanker_id = opt.getAttribute('data-id');
        break;
      }
    }
  }

  if (!trip_name || !driverVal || !tankerVal || !out_time) {
    showToast('Please provide a driver, a vehicle, and fill in all fields.', 'error');
    return;
  }

  const submitBtn = document.getElementById('submit-trip-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating Trip...';

  try {
    const res = await apiCreateTrip({
      trip_name,
      driver_name: driverVal,
      tanker_number: tankerVal,
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
