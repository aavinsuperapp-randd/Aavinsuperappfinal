// worker-history.js — Field Worker Portal History Tab

let historyDuties = [];
let editTripId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  const nameEl = document.getElementById('header-worker-name');
  if (nameEl) nameEl.textContent = profile.name || 'Field Worker';

  const avatarEl = document.getElementById('header-worker-avatar');
  if (avatarEl && profile.name) {
    const initials = profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials || 'FW';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  setupSidebarToggle();
  setupEditTripForm();
  await loadHistory();
});

function setupSidebarToggle() {
  const sidebar = document.getElementById('worker-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      if (window.innerWidth > 900) {
        sidebar.classList.toggle('collapsed');
        const main = document.querySelector('.admin-main');
        if (main) main.classList.toggle('expanded');
      } else {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('show');
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
}

async function loadHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center text-muted py-4">
      <div style="font-size:1.8rem; margin-bottom:8px;">🔄</div>
      <div>Fetching completed duty history...</div>
    </div>
  `;

  try {
    const res = await apiGetAssignedTrips({});
    const trips = res.trips || [];

    historyDuties = trips.filter(t => t.status === 'completed');

    if (historyDuties.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted py-5">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📜</div>
          <div style="font-weight: 700; color: #334155; margin-bottom: 4px;">No Finished Duties</div>
          <div style="font-size: 0.85rem;">No completed duty records found in history.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = historyDuties.map(t => {
      const routeName = t.route_description || t.trip_name || 'Completed Duty';
      const outTimeStr = formatOutTime(t.scheduled_out_time || t.out_time || t.created_at);
      const endTimeStr = formatOutTime(t.completed_at || t.in_time);
      const tripNum = t.trip_number || t.id.slice(0, 8).toUpperCase();

      const outKm = parseFloat(t.out_km || 0);
      const inKm = parseFloat(t.in_km || 0);
      const distNum = (inKm > 0 && outKm > 0 && inKm >= outKm) ? (inKm - outKm) : (t.km_travelled ? parseFloat(t.km_travelled) : null);
      const distanceStr = distNum !== null ? distNum.toFixed(2) + ' KM' : '—';

      const outW = parseFloat(t.out_weight || t.out_tanker_weight || 0);
      const hasInWeight = t.in_weight !== null && t.in_weight !== undefined && t.in_weight !== '' && t.in_weight !== '—';
      const inW = hasInWeight ? parseFloat(t.in_weight) : null;

      let metricsHtml = `
        <div style="font-size: 0.83rem; color: #64748B; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 6px;">
          <span>⏰ Started: <strong style="color: #0F172A;">${esc(outTimeStr)}</strong></span>
          <span>🏁 Ended: <strong style="color: #0F172A;">${esc(endTimeStr)}</strong></span>
          <span>🚛 Vehicle: <strong style="color: #0F172A;">${esc(t.tanker_number || '—')}</strong></span>
          <span>👤 Driver: <strong style="color: #0F172A;">${esc(t.driver_name || '—')}</strong></span>
        </div>
      `;

      if (hasInWeight && inW !== null && !isNaN(inW) && outW > 0 && outW > inW) {
        const dieselKg = parseFloat((outW - inW).toFixed(2));
        const dieselLiters = parseFloat((dieselKg / 0.832).toFixed(2));
        const mileageVal = (distNum && distNum > 0 && dieselLiters > 0) ? (distNum / dieselLiters).toFixed(2) : null;

        metricsHtml += `
          <div style="font-size: 0.82rem; color: #334155; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; background: #F8FAFC; padding: 8px 12px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span>📏 Distance: <strong>${distanceStr}</strong></span>
            <span>⛽ Diesel: <strong>${dieselLiters} L</strong></span>
            <span>⚡ Mileage: <strong>${mileageVal ? mileageVal + ' KM/L' : '—'}</strong></span>
          </div>
        `;
      } else if (hasInWeight && t.diesel_consumption !== null && t.diesel_consumption !== undefined) {
        const dieselLiters = parseFloat(t.diesel_consumption).toFixed(2);
        const mileageVal = t.average_mileage !== null && t.average_mileage !== undefined ? parseFloat(t.average_mileage).toFixed(2) : ((distNum && distNum > 0 && parseFloat(dieselLiters) > 0) ? (distNum / parseFloat(dieselLiters)).toFixed(2) : null);

        metricsHtml += `
          <div style="font-size: 0.82rem; color: #334155; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; background: #F8FAFC; padding: 8px 12px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span>📏 Distance: <strong>${distanceStr}</strong></span>
            <span>⛽ Diesel: <strong>${dieselLiters} L</strong></span>
            <span>⚡ Mileage: <strong>${mileageVal ? mileageVal + ' KM/L' : '—'}</strong></span>
          </div>
        `;
      } else {
        metricsHtml += `
          <div style="font-size: 0.82rem; color: #334155; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; background: #F8FAFC; padding: 8px 12px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span>📏 Distance Travelled: <strong>${distanceStr}</strong></span>
            <span style="color: #94A3B8; font-size: 0.78rem;">(IN Empty Weight pending — edit to view fuel calculations)</span>
          </div>
        `;
      }

      return `
        <div class="content-card duty-card" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; margin-bottom: 14px; border-radius: 12px; border: 1px solid #E2E8F0; gap: 16px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 220px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
              <span class="badge badge-success">✓ Finished</span>
              <span style="font-size: 0.78rem; color: #64748B; font-weight: 600;">Trip #${esc(tripNum)}</span>
            </div>
            <h3 style="margin: 0 0 4px 0; font-size: 1.05rem; font-weight: 700; color: #0F172A;">${esc(routeName)}</h3>
            ${metricsHtml}
          </div>
          <div>
            <button type="button" class="btn btn-primary" style="padding: 7px 16px; font-weight: 700; font-size: 0.83rem; background: #4F46E5; border-color: #4F46E5;" onclick="openEditTripModal('${t.id}')">✏️ EDIT METRICS</button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load history:', err);
    container.innerHTML = `<div class="text-center text-muted py-4" style="color:#DC2626;"><div style="font-size:1.8rem; margin-bottom:8px;">⚠️</div><div>${esc(err.message || 'Failed to load history duties.')}</div></div>`;
  }
}

function formatOutTime(timeStr) {
  if (!timeStr) return 'Not set';
  try {
    const d = new Date(timeStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch (e) {
    return timeStr;
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── EDIT TRIP MODAL LOGIC ──────────────────────────────────────────────────

function setupEditTripForm() {
  const confirmBtn = document.getElementById('btn-confirm-edit-trip');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', handleEditTripSubmit);
  }
}

window.openEditTripModal = async function(tripId) {
  editTripId = tripId;
  let trip = historyDuties.find(t => t.id === tripId);
  if (!trip) {
    try {
      const res = await apiGetTripDetails(tripId);
      if (res && res.trip) trip = res.trip;
    } catch(e) {}
  }
  if (!trip) return;

  const modal = document.getElementById('edit-trip-modal');
  if (!modal) return;

  const titleEl = document.getElementById('et-route-title');
  const outKmInput = document.getElementById('et-out-km-input');
  const outWtInput = document.getElementById('et-out-wt-input');
  const inKmInput = document.getElementById('et-in-km');
  const inWeightInput = document.getElementById('et-in-weight');
  const endTimeInput = document.getElementById('et-end-time');

  if (titleEl) titleEl.textContent = trip.route_description || trip.trip_name || 'Completed Duty';
  
  if (outKmInput) outKmInput.value = (trip.out_km !== null && trip.out_km !== undefined) ? trip.out_km : '';
  if (outWtInput) outWtInput.value = (trip.out_weight !== null && trip.out_weight !== undefined) ? trip.out_weight : ((trip.out_tanker_weight !== null && trip.out_tanker_weight !== undefined) ? trip.out_tanker_weight : '');

  if (inKmInput) inKmInput.value = (trip.in_km !== null && trip.in_km !== undefined) ? trip.in_km : '';
  if (inWeightInput) inWeightInput.value = (trip.in_weight !== null && trip.in_weight !== undefined) ? trip.in_weight : '';

  if (endTimeInput && (trip.completed_at || trip.in_time)) {
    try {
      const d = new Date(trip.completed_at || trip.in_time);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      endTimeInput.value = d.toISOString().slice(0, 16);
    } catch(e) {
      endTimeInput.value = '';
    }
  } else if (endTimeInput) {
    endTimeInput.value = '';
  }

  modal.classList.remove('hidden');
};

window.closeEditTripModal = function() {
  const modal = document.getElementById('edit-trip-modal');
  if (modal) modal.classList.add('hidden');
};

async function handleEditTripSubmit() {
  if (!editTripId) return;
  const trip = historyDuties.find(t => t.id === editTripId) || {};

  const outKmStr = document.getElementById('et-out-km-input')?.value;
  const outWtStr = document.getElementById('et-out-wt-input')?.value;
  const inKmStr = document.getElementById('et-in-km')?.value;
  const inWeightStr = document.getElementById('et-in-weight')?.value;
  const endTimeStr = document.getElementById('et-end-time')?.value;

  const confirmBtn = document.getElementById('btn-confirm-edit-trip');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving...';
  }

  try {
    const payload = {};
    if (outKmStr !== undefined && outKmStr !== '') payload.out_km = parseFloat(outKmStr);
    if (outWtStr !== undefined && outWtStr !== '') payload.out_weight = parseFloat(outWtStr);

    if (inKmStr !== undefined && inKmStr !== '') {
      const inKm = parseFloat(inKmStr);
      const outKm = payload.out_km !== undefined ? payload.out_km : parseFloat(trip.out_km || 0);
      if (!isNaN(inKm) && outKm > 0 && inKm <= outKm) {
        if (typeof showToast === 'function') showToast(`IN KM (${inKm}) must be greater than OUT KM (${outKm} KM).`, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'SAVE CHANGES';
        return;
      }
      payload.in_km = inKm;
    }

    if (inWeightStr !== undefined && inWeightStr.trim() !== '') {
      const inWeight = parseFloat(inWeightStr);
      const outWeight = payload.out_weight !== undefined ? payload.out_weight : parseFloat(trip.out_weight || trip.out_tanker_weight || 0);
      if (!isNaN(inWeight) && outWeight > 0 && inWeight >= outWeight) {
        if (typeof showToast === 'function') showToast(`IN Empty Weight (${inWeight} kg) must be less than OUT Tanker Weight (${outWeight} kg).`, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'SAVE CHANGES';
        return;
      }
      payload.empty_tanker_weight = inWeight;
    } else if (inWeightStr === '') {
      payload.empty_tanker_weight = null;
    }

    if (endTimeStr) {
      payload.in_time = new Date(endTimeStr).toISOString();
    }

    await apiEditWorkerTrip(editTripId, payload);
    if (typeof showToast === 'function') showToast('✅ Duty metrics updated successfully!', 'success');
    closeEditTripModal();
    await loadHistory();
  } catch (err) {
    console.error('Failed to edit trip metrics:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to edit trip metrics.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'SAVE CHANGES';
    }
  }
}
    console.error('Failed to edit trip metrics:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to edit trip metrics.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'SAVE CHANGES';
    }
  }
}
