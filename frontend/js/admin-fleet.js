// admin-fleet.js — Admin Drivers and Vehicles Management
// ⚠️ DEPRECATED: Driver and Vehicle management has been moved to Transport Officer Portal
// This file is kept for backwards compatibility but is no longer used in Admin dashboard

async function adminFetch(endpoint, options = {}) {
  const client = await initSupabase();
  let token = '';
  if (client) {
    const { data: { session } } = await client.auth.getSession();
    if (session) token = session.access_token;
  }

  const baseUrl = endpoint.startsWith('http') ? '' : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com');
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is active at ${baseUrl || 'https://aavin-backend.onrender.com'}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}


document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  setupModalHandlers();
  await loadDrivers();
  await loadTankers();
});


async function loadDrivers() {
  const container = document.getElementById('drivers-list');
  try {
    const res = await adminFetch('/api/admin/drivers');
    const drivers = res.drivers || [];
    document.getElementById('driver-count').textContent = drivers.length;

    if (drivers.length === 0) {
      container.innerHTML = `<div class="text-muted text-sm text-center py-3">No registered drivers found.</div>`;
      return;
    }

    container.innerHTML = drivers.map(d => `
      <div class="fleet-item">
        <div class="fleet-item-info">
          <strong>👨‍✈️ ${esc(d.name)}</strong>
          <span>Phone: ${esc(d.phone || '—')} | License: ${esc(d.license_number || '—')}</span>
        </div>
        <div class="d-flex gap-1" style="gap:4px;">
          <button class="btn btn-sm ${d.is_active ? 'btn-outline' : 'btn-primary'}" onclick="toggleDriver('${d.id}', ${!d.is_active})">
            ${d.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteDriver('${d.id}')" title="Delete Driver">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading drivers:', err);
    showToast(err.message || 'Failed to load drivers.', 'error');
  }
}

async function loadTankers() {
  const container = document.getElementById('tankers-list');
  try {
    const res = await adminFetch('/api/admin/tankers');
    const tankers = res.tankers || [];
    document.getElementById('tanker-count').textContent = tankers.length;

    if (tankers.length === 0) {
      container.innerHTML = `<div class="text-muted text-sm text-center py-3">No registered vehicles found.</div>`;
      return;
    }

    container.innerHTML = tankers.map(t => `
      <div class="fleet-item">
        <div class="fleet-item-info">
          <strong>🚛 ${esc(t.board_number)}</strong>
          <span>Capacity: ${t.capacity_liters || 5000} Kg</span>
        </div>
        <div class="d-flex gap-1" style="gap:4px;">
          <button class="btn btn-sm ${t.is_active ? 'btn-outline' : 'btn-primary'}" onclick="toggleTanker('${t.id}', ${!t.is_active})">
            ${t.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteTanker('${t.id}')" title="Delete Vehicle">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading tankers:', err);
    showToast(err.message || 'Failed to load vehicles.', 'error');
  }
}

window.toggleDriver = async function(id, is_active) {
  try {
    await adminFetch(`/api/admin/drivers/${id}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active })
    });
    showToast('Saved', 'success');
    await loadDrivers();
  } catch (err) {
    showToast(err.message || 'Failed to update driver', 'error');
  }
};

window.deleteDriver = async function(id) {
  if (!confirm('Are you sure you want to delete this driver?')) return;
  try {
    await adminFetch(`/api/admin/drivers/${id}`, { method: 'DELETE' });
    showToast('Driver deleted', 'success');
    await loadDrivers();
  } catch (err) {
    showToast(err.message || 'Failed to delete driver', 'error');
  }
};

window.toggleTanker = async function(id, is_active) {
  try {
    await adminFetch(`/api/admin/tankers/${id}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active })
    });
    showToast('Saved', 'success');
    await loadTankers();
  } catch (err) {
    showToast(err.message || 'Failed to update vehicle', 'error');
  }
};

window.deleteTanker = async function(id) {
  if (!confirm('Are you sure you want to delete this vehicle?')) return;
  try {
    await adminFetch(`/api/admin/tankers/${id}`, { method: 'DELETE' });
    showToast('Vehicle deleted', 'success');
    await loadTankers();
  } catch (err) {
    showToast(err.message || 'Failed to delete vehicle', 'error');
  }
};

function setupModalHandlers() {
  const driverModal = document.getElementById('driver-modal');
  const tankerModal = document.getElementById('tanker-modal');

  const purgeDriversBtn = document.getElementById('purge-drivers-btn');
  if (purgeDriversBtn) {
    purgeDriversBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ Are you sure you want to remove ALL registered drivers?')) return;
      try {
        await adminFetch('/api/admin/drivers/all', { method: 'DELETE' });
        showToast('All drivers removed!', 'success');
        await loadDrivers();
      } catch (err) {
        showToast(err.message || 'Failed to remove drivers.', 'error');
      }
    });
  }

  const purgeTankersBtn = document.getElementById('purge-tankers-btn');
  if (purgeTankersBtn) {
    purgeTankersBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ Are you sure you want to remove ALL registered vehicles?')) return;
      try {
        await adminFetch('/api/admin/tankers/all', { method: 'DELETE' });
        showToast('All vehicles removed!', 'success');
        await loadTankers();
      } catch (err) {
        showToast(err.message || 'Failed to remove vehicles.', 'error');
      }
    });
  }

  document.getElementById('add-driver-btn').addEventListener('click', () => {
    document.getElementById('driver-name-input').value = '';
    document.getElementById('driver-phone-input').value = '';
    document.getElementById('driver-license-input').value = '';
    driverModal.classList.remove('hidden');
  });

  document.getElementById('driver-modal-close').addEventListener('click', () => driverModal.classList.add('hidden'));
  document.getElementById('driver-cancel-btn').addEventListener('click', () => driverModal.classList.add('hidden'));

  document.getElementById('driver-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('driver-name-input').value.trim();
    const phone = document.getElementById('driver-phone-input').value.trim();
    const license_number = document.getElementById('driver-license-input').value.trim();

    if (!name) {
      showToast('Driver name is required.', 'error');
      return;
    }

    try {
      await adminFetch('/api/admin/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, license_number })
      });
      showToast('Saved', 'success');
      driverModal.classList.add('hidden');
      await loadDrivers();
    } catch (err) {
      showToast(err.message || 'Failed to add driver', 'error');
    }
  });

  document.getElementById('add-tanker-btn').addEventListener('click', () => {
    document.getElementById('tanker-board-input').value = '';
    document.getElementById('tanker-capacity-input').value = '5000';
    tankerModal.classList.remove('hidden');
  });

  document.getElementById('tanker-modal-close').addEventListener('click', () => tankerModal.classList.add('hidden'));
  document.getElementById('tanker-cancel-btn').addEventListener('click', () => tankerModal.classList.add('hidden'));

  document.getElementById('tanker-save-btn').addEventListener('click', async () => {
    const board_number = document.getElementById('tanker-board-input').value.trim();
    const capacity_liters = document.getElementById('tanker-capacity-input').value;

    if (!board_number) {
      showToast('Vehicle board number is required.', 'error');
      return;
    }

    try {
      await adminFetch('/api/admin/tankers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_number, capacity_liters })
      });
      showToast('Saved', 'success');
      tankerModal.classList.add('hidden');
      await loadTankers();
    } catch (err) {
      showToast(err.message || 'Failed to add vehicle', 'error');
    }
  });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
