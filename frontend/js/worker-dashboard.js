// worker-dashboard.js — Field Worker Portal Dashboard Logic

let currentDuties = [];
let finishedDuties = [];
let selectedTripId = null;
let activeTripData = null;

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
  setupStartTripForm();
  setupCloseTripForm();
  setupEditTripForm();
  await loadDuties();

  const urlParams = new URLSearchParams(window.location.search);
  const autoTripId = urlParams.get('tripId');
  if (autoTripId) {
    openViewDutyModal(autoTripId);
  }
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

window.switchDutyTab = function(tab) {
  const btnAvailable = document.getElementById('tab-available');
  const btnFinished = document.getElementById('tab-finished');
  const secAvailable = document.getElementById('section-available');
  const secFinished = document.getElementById('section-finished');

  if (tab === 'available') {
    if (btnAvailable) { btnAvailable.classList.add('active'); btnAvailable.style.borderBottom = '3px solid #2563EB'; btnAvailable.style.color = '#2563EB'; }
    if (btnFinished) { btnFinished.classList.remove('active'); btnFinished.style.borderBottom = '3px solid transparent'; btnFinished.style.color = '#64748B'; }
    if (secAvailable) secAvailable.style.display = 'block';
    if (secFinished) secFinished.style.display = 'none';
  } else {
    if (btnFinished) { btnFinished.classList.add('active'); btnFinished.style.borderBottom = '3px solid #2563EB'; btnFinished.style.color = '#2563EB'; }
    if (btnAvailable) { btnAvailable.classList.remove('active'); btnAvailable.style.borderBottom = '3px solid transparent'; btnAvailable.style.color = '#64748B'; }
    if (secAvailable) secAvailable.style.display = 'none';
    if (secFinished) secFinished.style.display = 'block';
  }
};

async function loadDuties() {
  const availContainer = document.getElementById('available-duties-container');
  const finContainer = document.getElementById('finished-duties-container');

  if (availContainer) availContainer.innerHTML = '<div class="text-center text-muted py-4"><div style="font-size:1.8rem; margin-bottom:8px;">🔄</div><div>Fetching available duties...</div></div>';
  if (finContainer) finContainer.innerHTML = '<div class="text-center text-muted py-4"><div style="font-size:1.8rem; margin-bottom:8px;">🔄</div><div>Fetching finished duties...</div></div>';

  try {
    const res = await apiGetAssignedTrips({}); // fetch all assigned trips, no date filter
    const trips = res.trips || [];

    currentDuties = trips.filter(t => t.status !== 'completed' && t.status !== 'deleted');
    finishedDuties = trips.filter(t => t.status === 'completed');

    const activeTrip = currentDuties.find(t => t.status === 'in_progress' || t.status === 'active');

    if (activeTrip) {
      await updateActiveTripCard(activeTrip);
    } else {
      activeTripData = null;
      const section = document.getElementById('active-trip-section');
      if (section) section.classList.add('hidden');
    }

    renderDutiesList(currentDuties, 'available-duties-container', 'No Available Duties', 'You have no pending planned duties at this moment.');
    renderDutiesList(finishedDuties, 'finished-duties-container', 'No Finished Duties', 'You have not completed any duties yet.');
  } catch (err) {
    console.error('Failed to load duties:', err);
    if (availContainer) availContainer.innerHTML = `<div class="text-center text-muted py-4" style="color:#DC2626;"><div style="font-size:1.8rem; margin-bottom:8px;">⚠️</div><div>${esc(err.message || 'Failed to load duties.')}</div></div>`;
    if (finContainer) finContainer.innerHTML = `<div class="text-center text-muted py-4" style="color:#DC2626;"><div style="font-size:1.8rem; margin-bottom:8px;">⚠️</div><div>${esc(err.message || 'Failed to load duties.')}</div></div>`;
  }
}

async function updateActiveTripCard(trip) {
  activeTripData = trip;
  const section = document.getElementById('active-trip-section');
  const routeNameEl = document.getElementById('at-route-name');
  const startTimeEl = document.getElementById('at-start-time');
  const viewBtn = document.getElementById('at-btn-view');
  const closeBtn = document.getElementById('at-btn-close');
  const progressBar = document.getElementById('at-progress-bar');
  const bmcCountEl = document.getElementById('at-bmc-count');

  if (!section) return;

  const routeName = trip.route_description || trip.route || trip.trip_name || trip.bmc_name || 'Active Route';
  const startTimeStr = formatOutTime(trip.started_at || trip.out_time || trip.scheduled_out_time || trip.created_at);

  if (routeNameEl) routeNameEl.textContent = routeName;
  if (startTimeEl) startTimeEl.textContent = startTimeStr;

  if (viewBtn) {
    viewBtn.onclick = () => openViewDutyModal(trip.id);
  }
  if (closeBtn) {
    closeBtn.onclick = () => openCloseTripModal(trip.id);
  }

  section.classList.remove('hidden');

  // Fetch actual database visits for this trip
  try {
    const details = await apiGetTripDetails(trip.id);
    const visits = details.visits || [];
    const totalBmcs = visits.length || (trip.selected_bmcs ? trip.selected_bmcs.length : 0);

    const completedBmcs = visits.filter(v => 
      v.status === 'completed' || v.visit_end_time || v.in_weight || v.sample_liters
    ).length;

    const pct = totalBmcs > 0 ? Math.min(100, Math.round((completedBmcs / totalBmcs) * 100)) : 0;

    if (progressBar) progressBar.style.width = `${pct}%`;
    if (bmcCountEl) bmcCountEl.textContent = `${completedBmcs}/${totalBmcs} BMC Completed`;
  } catch (err) {
    console.warn('Failed to load active trip BMC visits:', err);
    if (progressBar) progressBar.style.width = '0%';
    if (bmcCountEl) bmcCountEl.textContent = '0/0 BMC Completed';
  }
}

function renderDutiesList(duties, containerId, emptyTitle, emptyDesc) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (duties.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted py-5">
        <div style="font-size:2.5rem; margin-bottom:8px;">🚚</div>
        <div style="font-weight:700; color:#334155; margin-bottom:4px; font-size: 1rem;">${esc(emptyTitle)}</div>
        <div style="font-size: 0.85rem;">${esc(emptyDesc)}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = duties.map(t => {
    const routeName = t.route_description || t.trip_name || 'Route Duty';
    const outTimeStr = formatOutTime(t.scheduled_out_time || t.out_time || t.created_at);
    const tripNum = t.trip_number || t.id.slice(0, 8).toUpperCase();
    const isCompleted = t.status === 'completed';
    const isStarted = t.status === 'in_progress' || t.status === 'active';
    
    let statusBadgeClass = 'badge badge-warning';
    let statusText = 'Planned';
    if (isCompleted) {
      statusBadgeClass = 'badge badge-success';
      statusText = '✓ Finished';
    } else if (isStarted) {
      statusBadgeClass = 'badge badge-blue';
      statusText = 'In Progress';
    }

    const outKm = parseFloat(t.out_km || 0);
    const inKm = parseFloat(t.in_km || 0);
    const distNum = (inKm > 0 && outKm > 0 && inKm >= outKm) ? (inKm - outKm) : (t.km_travelled ? parseFloat(t.km_travelled) : null);
    const distanceStr = distNum !== null ? distNum.toFixed(2) + ' KM' : '—';

    const outW = parseFloat(t.out_weight || t.out_tanker_weight || 0);
    const hasInWeight = t.in_weight !== null && t.in_weight !== undefined && t.in_weight !== '' && t.in_weight !== '—';
    const inW = hasInWeight ? parseFloat(t.in_weight) : null;

    let metricsHtml = `
      <div style="font-size: 0.83rem; color: #64748B; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 6px;">
        <span>⏰ OUT: <strong style="color: #0F172A;">${esc(outTimeStr)}</strong></span>
        <span>🚛 Vehicle: <strong style="color: #0F172A;">${esc(t.tanker_number || '—')}</strong></span>
        <span>👤 Driver: <strong style="color: #0F172A;">${esc(t.driver_name || '—')}</strong></span>
      </div>
    `;

    if (isCompleted) {
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
    }

    const actionButtons = isCompleted ? `
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn btn-outline" style="padding: 7px 14px; font-weight: 700; font-size: 0.83rem;" onclick="openViewDutyModal('${t.id}')">👁️ VIEW</button>
        <button type="button" class="btn btn-primary" style="padding: 7px 14px; font-weight: 700; font-size: 0.83rem; background: #4F46E5; border-color: #4F46E5;" onclick="openEditTripModal('${t.id}')">✏️ EDIT</button>
      </div>
    ` : `
      <button type="button" class="btn btn-primary" style="padding: 8px 18px; font-weight: 700; font-size: 0.85rem;" onclick="openViewDutyModal('${t.id}')">👁️ VIEW DUTY</button>
    `;

    return `
      <div class="content-card duty-card" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; margin-bottom: 14px; border-radius: 12px; border: 1px solid #E2E8F0; gap: 16px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 220px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <span class="${statusBadgeClass}">${statusText}</span>
            <span style="font-size: 0.78rem; color: #64748B; font-weight: 600;">Trip #${esc(tripNum)}</span>
          </div>
          <h3 style="margin: 0 0 4px 0; font-size: 1.05rem; font-weight: 700; color: #0F172A;">${esc(routeName)}</h3>
          ${metricsHtml}
        </div>
        <div>
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');
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

// ── VIEW DUTY MODAL ──────────────────────────────────────────────────────────

window.openViewDutyModal = async function(tripId) {
  selectedTripId = tripId;
  const modal = document.getElementById('view-duty-modal');
  if (!modal) return;

  // Reset fields to loading state
  if (document.getElementById('vd-route-name')) document.getElementById('vd-route-name').textContent = 'Loading...';
  if (document.getElementById('vd-driver-name')) document.getElementById('vd-driver-name').textContent = 'Loading...';
  if (document.getElementById('vd-tanker-number')) document.getElementById('vd-tanker-number').textContent = 'Loading...';
  if (document.getElementById('vd-out-time')) document.getElementById('vd-out-time').textContent = 'Loading...';
  if (document.getElementById('vd-in-time')) document.getElementById('vd-in-time').textContent = 'Loading...';
  if (document.getElementById('vd-duty-date')) document.getElementById('vd-duty-date').textContent = 'Loading...';
  
  const statusPill = document.getElementById('vd-status-pill');
  if (statusPill) {
    statusPill.className = 'badge badge-warning';
    statusPill.textContent = 'Planned';
  }

  const tbody = document.getElementById('vd-bmc-table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Loading BMC list...</td></tr>`;

  const reportContainer = document.getElementById('vd-reports-review-container');
  if (reportContainer) reportContainer.innerHTML = `<div class="text-muted" style="font-size:0.88rem; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px 16px;">Loading reports...</div>`;

  modal.classList.remove('hidden');

  try {
    const { trip, visits = [] } = await apiGetTripDetails(tripId);
    activeTripData = { trip, visits };

    // Fill metadata
    if (document.getElementById('vd-route-name')) document.getElementById('vd-route-name').textContent = trip.route_description || trip.trip_name || 'Planned Duty';
    if (document.getElementById('vd-driver-name')) document.getElementById('vd-driver-name').textContent = trip.driver_name || (trip.driver ? trip.driver.name : 'Assigned Driver');
    if (document.getElementById('vd-tanker-number')) document.getElementById('vd-tanker-number').textContent = trip.tanker_number || (trip.tanker ? trip.tanker.board_number : 'Unassigned');
    
    // OUT Time (Start Time) & IN Time (End Time)
    const outTimeStr = formatOutTime(trip.started_at || trip.out_time || trip.scheduled_start_time || trip.created_at);
    const inTimeStr = (trip.in_time || trip.completed_at) ? formatOutTime(trip.in_time || trip.completed_at) : (trip.status === 'completed' ? 'Finished' : 'In Transit / Active');
    
    if (document.getElementById('vd-out-time')) document.getElementById('vd-out-time').textContent = outTimeStr;
    if (document.getElementById('vd-in-time')) document.getElementById('vd-in-time').textContent = inTimeStr;
    
    const d = new Date(trip.out_time || trip.created_at || new Date());
    if (document.getElementById('vd-duty-date')) document.getElementById('vd-duty-date').textContent = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    // Status pill
    const isCompleted = trip.status === 'completed';
    const isStarted = trip.status === 'in_progress' || trip.status === 'active';
    if (statusPill) {
      if (isCompleted) {
        statusPill.className = 'badge badge-success';
        statusPill.textContent = '✓ Finished';
      } else if (isStarted) {
        statusPill.className = 'badge badge-blue';
        statusPill.textContent = 'In Progress';
      } else {
        statusPill.className = 'badge badge-warning';
        statusPill.textContent = 'Planned';
      }
    }

    // Modal Footer Button
    const footer = document.getElementById('vd-modal-footer');
    if (footer) {
      if (isCompleted) {
        footer.innerHTML = `
          <button type="button" class="btn btn-outline" onclick="closeViewDutyModal()">Close</button>
          <span style="align-self:center; font-weight:700; color:#16A34A; font-size:0.88rem;">✓ Duty Completed &amp; Finished</span>
        `;
      } else if (isStarted) {
        footer.innerHTML = `
          <button type="button" class="btn btn-outline" onclick="closeViewDutyModal()">Close</button>
          <span style="align-self:center; font-weight:700; color:#2563EB; font-size:0.88rem;">● Trip Currently In Progress</span>
        `;
      } else {
        footer.innerHTML = `
          <button type="button" class="btn btn-outline" onclick="closeViewDutyModal()">Close</button>
          <button type="button" class="btn btn-primary" onclick="triggerStartTripFromView()">🚀 START TRIP</button>
        `;
      }
    }

    // Render BMCs list
    if (tbody) {
      if (visits.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No BMCs selected for this route.</td></tr>`;
      } else {
        tbody.innerHTML = visits.map((v, idx) => {
          const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
          const bmcCode = v.bmc ? (v.bmc.bmc_code || v.bmc.district || '') : '';
          const codeText = bmcCode ? ` (${esc(bmcCode)})` : '';
          const comp = v.compartment || 'Front';

          const isVisited = v.status === 'completed' || v.visit_end_time || v.status === 'visited';

          const statusBadge = isVisited 
            ? '<span class="badge badge-success" style="font-weight:700;">✓ Visited</span>'
            : (v.status === 'in_progress' ? '<span class="badge badge-blue">In Progress</span>' : '<span class="badge badge-warning">Pending</span>');

          // Action Buttons: Always show View Test button, plus Visit button if in_progress
          const viewTestBtn = `<button type="button" class="btn btn-outline btn-sm" style="padding: 5px 12px; font-weight:700; font-size:0.78rem; border-color:#3B82F6; color:#1D4ED8;" onclick="openViewTestModal(${idx})">🧪 View Test</button>`;
          const pdfBtn = v.invoice_serial_no ? `<button type="button" class="btn btn-outline btn-sm" style="padding: 5px 12px; font-weight:700; font-size:0.78rem; border-color:#DC2626; color:#DC2626; margin-left:6px;" onclick="downloadInvoicePdf('${v.id}')">📄 PDF</button>` : '';

          let visitBtn = '';
          if (isStarted) {
            visitBtn = isVisited
              ? `<button type="button" class="btn btn-success btn-sm" style="padding: 5px 12px; font-weight:700; font-size:0.78rem; background-color:#16A34A; border-color:#16A34A; color:#FFFFFF;" onclick="openBmcVisitModal('${v.id}', '${selectedTripId}', '${v.bmc_id || (v.bmc ? v.bmc.id : '')}', '${v.bmc ? (v.bmc.bmc_code || v.bmc.code || '') : (v.bmc_code || '')}')">✓ VISITED</button>`
              : `<button type="button" class="btn btn-primary btn-sm" style="padding: 5px 12px; font-weight:700; font-size:0.78rem;" onclick="openBmcVisitModal('${v.id || ('virtual-' + idx)}', '${selectedTripId}', '${v.bmc_id || (v.bmc ? v.bmc.id : '')}', '${v.bmc ? (v.bmc.bmc_code || v.bmc.code || '') : (v.bmc_code || '')}')">📍 VISIT</button>`;
          }

          return `
            <tr>
              <td style="text-align: center;"><strong>${v.visit_sequence || (idx + 1)}</strong></td>
              <td><strong>${esc(bmcName)}</strong>${codeText}</td>
              <td><span class="badge badge-neutral">${esc(comp)}</span></td>
              <td>${statusBadge}</td>
              <td style="text-align: right; white-space: nowrap;">
                <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                  ${viewTestBtn}
                  ${pdfBtn}
                  ${visitBtn}
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Render Reports & Review Section
    renderReportsAndReview(visits);

  } catch (err) {
    console.error('Failed to load view duty details:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load duty details.', 'error');
  }
};

window.openViewTestModal = function(visitIdx) {
  if (!activeTripData || !activeTripData.visits || !activeTripData.visits[visitIdx]) {
    if (typeof showToast === 'function') showToast('Visit test data not found.', 'error');
    return;
  }

  const v = activeTripData.visits[visitIdx];
  const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
  const modal = document.getElementById('view-test-modal');
  if (!modal) return;

  if (document.getElementById('vt-bmc-name')) document.getElementById('vt-bmc-name').textContent = bmcName;

  // FTIR Test Data (FAT & SNF only)
  const ftirObj = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : (v.ftir_tests || null);
  const ftirGrid = document.getElementById('vt-ftir-grid');
  const ftirStatusPill = document.getElementById('vt-ftir-status');

  if (ftirObj || v.ftir_result) {
    const fatVal = ftirObj?.fat !== undefined ? `${ftirObj.fat}%` : (v.ftir_result && v.ftir_result.includes('FAT:') ? v.ftir_result.split('FAT:')[1].split(',')[0].trim() : '—');
    const snfVal = ftirObj?.snf !== undefined ? `${ftirObj.snf}%` : (v.ftir_result && v.ftir_result.includes('SNF:') ? v.ftir_result.split('SNF:')[1].trim() : '—');
    const overallRes = ftirObj?.overall_result || (v.ftir_result && v.ftir_result.includes('[FAIL]') ? 'FAIL' : (v.ftir_result && v.ftir_result !== '—' && v.ftir_result !== 'Pending' ? 'PASS' : 'Pending'));

    if (ftirStatusPill) {
      ftirStatusPill.className = `badge ${overallRes.toLowerCase() === 'pass' ? 'badge-success' : (overallRes.toLowerCase() === 'fail' ? 'badge-danger' : 'badge-neutral')}`;
      ftirStatusPill.textContent = overallRes.toUpperCase();
    }

    if (ftirGrid) {
      ftirGrid.innerHTML = `
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">FAT (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${fatVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">SNF (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${snfVal}</div></div>
      `;
    }
  } else {
    if (ftirStatusPill) { ftirStatusPill.className = 'badge badge-neutral'; ftirStatusPill.textContent = 'Not Tested'; }
    if (ftirGrid) ftirGrid.innerHTML = `<div style="grid-column: 1 / -1; font-size: 0.85rem; color:#64748B; font-style:italic;">No FTIR test performed for this BMC visit.</div>`;
  }

  // Gerber Test Data (FAT, SNF & Lacto only)
  const gerberObj = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : (v.gerber_tests || null);
  const gerberGrid = document.getElementById('vt-gerber-grid');
  const gerberStatusPill = document.getElementById('vt-gerber-status');

  if (gerberObj || v.gerber_result) {
    const gFatVal = gerberObj?.fat_percentage !== undefined ? `${gerberObj.fat_percentage}%` : (v.gerber_result && v.gerber_result.includes('FAT:') ? v.gerber_result.split('FAT:')[1].split(',')[0].trim() : '—');
    const gSnfVal = gerberObj?.snf !== undefined ? `${gerberObj.snf}%` : (v.gerber_result && v.gerber_result.includes('SNF:') ? v.gerber_result.split('SNF:')[1].trim() : '—');
    const gLactoVal = gerberObj?.clr !== undefined ? gerberObj.clr : (v.gerber_result && v.gerber_result.includes('CLR:') ? v.gerber_result.split('CLR:')[1].split(' ')[0].trim() : '—');
    const gOverallRes = gerberObj?.overall_result || (v.gerber_result && v.gerber_result.includes('[FAIL]') ? 'FAIL' : (v.gerber_result && v.gerber_result !== '—' && v.gerber_result !== 'Pending' ? 'PASS' : 'Pending'));

    if (gerberStatusPill) {
      gerberStatusPill.className = `badge ${gOverallRes.toLowerCase() === 'pass' ? 'badge-success' : (gOverallRes.toLowerCase() === 'fail' ? 'badge-danger' : 'badge-neutral')}`;
      gerberStatusPill.textContent = gOverallRes.toUpperCase();
    }

    if (gerberGrid) {
      gerberGrid.innerHTML = `
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">FAT (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gFatVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">SNF (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gSnfVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">LACTO</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gLactoVal}</div></div>
      `;
    }
  } else {
    if (gerberStatusPill) { gerberStatusPill.className = 'badge badge-neutral'; gerberStatusPill.textContent = 'Not Tested'; }
    if (gerberGrid) gerberGrid.innerHTML = `<div style="grid-column: 1 / -1; font-size: 0.85rem; color:#64748B; font-style:italic;">No Gerber test performed for this BMC visit.</div>`;
  }

  modal.classList.remove('hidden');
};

window.closeViewTestModal = function() {
  const modal = document.getElementById('view-test-modal');
  if (modal) modal.classList.add('hidden');
};

function renderReportsAndReview(visits = []) {
  const container = document.getElementById('vd-reports-review-container');
  if (!container) return;

  const allIssues = [];

  visits.forEach(v => {
    const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
    if (v.bmc_issues && Array.isArray(v.bmc_issues) && v.bmc_issues.length > 0) {
      v.bmc_issues.forEach(i => allIssues.push({ ...i, bmc_name: bmcName }));
    }
  });

  if (allIssues.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.88rem; color: #64748B; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-style: italic;">
        No issues reported for this trip.
      </div>
    `;
    return;
  }

  let html = '';

  if (allIssues.length > 0) {
    html += `
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #DC2626; margin-bottom: 8px;">⚠️ Reported Issues / Non-Conformances (${allIssues.length})</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${allIssues.map(issue => `
            <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 10px 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.82rem; font-weight: 800; color: #991B1B;">🏢 ${esc(issue.bmc_name)} — ${esc(issue.issue_type || 'General Issue')}</span>
                <span class="badge badge-danger" style="font-size: 0.72rem;">${esc(issue.severity || 'Medium').toUpperCase()}</span>
              </div>
              <div style="font-size: 0.85rem; color: #7F1D1D; margin-top: 4px;">${esc(issue.description || issue.remarks || 'No detailed description')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

window.closeViewDutyModal = function() {
  const modal = document.getElementById('view-duty-modal');
  if (modal) modal.classList.add('hidden');
};

window.triggerStartTripFromView = function() {
  closeViewDutyModal();
  openStartTripModal(selectedTripId);
};

// ── START TRIP MODAL ─────────────────────────────────────────────────────────

let currentStartTripLocation = null;

window.openStartTripModal = function(tripId) {
  selectedTripId = tripId;
  currentStartTripLocation = null;
  const modal = document.getElementById('start-trip-modal');
  if (!modal) return;

  // Clear inputs
  const outKmInput = document.getElementById('st-out-km');
  const outWeightInput = document.getElementById('st-out-weight');
  const statusEl = document.getElementById('st-location-status');
  const coordsBox = document.getElementById('st-location-coords');
  const reqBtn = document.getElementById('btn-request-st-location');

  if (outKmInput) outKmInput.value = '';
  if (outWeightInput) outWeightInput.value = '';

  if (statusEl) {
    statusEl.textContent = 'Location permission required to start trip';
    statusEl.style.color = '#64748B';
  }
  if (coordsBox) coordsBox.style.display = 'none';
  if (reqBtn) {
    reqBtn.textContent = '📡 Enable Location';
    reqBtn.disabled = false;
  }

  modal.classList.remove('hidden');
};

window.closeStartTripModal = function() {
  const modal = document.getElementById('start-trip-modal');
  if (modal) modal.classList.add('hidden');
};

async function requestStartTripLocationPermission() {
  const reqBtn = document.getElementById('btn-request-st-location');
  const statusEl = document.getElementById('st-location-status');
  const coordsBox = document.getElementById('st-location-coords');
  const latVal = document.getElementById('st-lat-val');
  const lngVal = document.getElementById('st-lng-val');

  if (reqBtn) {
    reqBtn.disabled = true;
    reqBtn.textContent = '📡 Requesting...';
  }
  if (statusEl) statusEl.textContent = 'Requesting browser location permission...';

  try {
    const pos = await getCurrentPositionPromise();
    currentStartTripLocation = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };

    if (statusEl) {
      statusEl.textContent = '✅ Location permission granted';
      statusEl.style.color = '#16A34A';
    }
    if (latVal) latVal.textContent = pos.coords.latitude.toFixed(6);
    if (lngVal) lngVal.textContent = pos.coords.longitude.toFixed(6);
    if (coordsBox) coordsBox.style.display = 'block';

    if (reqBtn) {
      reqBtn.textContent = '✅ Location Ready';
      reqBtn.disabled = false;
    }
    if (typeof showToast === 'function') showToast('Location permission granted.', 'success');
    return currentStartTripLocation;
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '❌ ' + (err.message || 'Location access denied');
      statusEl.style.color = '#DC2626';
    }
    if (reqBtn) {
      reqBtn.textContent = '📡 Enable Location';
      reqBtn.disabled = false;
    }
    if (typeof showToast === 'function') showToast(err.message || 'Location permission denied.', 'error');
    throw err;
  }
}

function setupStartTripForm() {
  const confirmBtn = document.getElementById('btn-confirm-start-trip');
  const reqBtn = document.getElementById('btn-request-st-location');

  if (reqBtn) {
    reqBtn.addEventListener('click', requestStartTripLocationPermission);
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const outKm = document.getElementById('st-out-km')?.value;
      const outWeight = document.getElementById('st-out-weight')?.value;

      if (!outKm) {
        if (typeof showToast === 'function') showToast('OUT KM odometer reading is required.', 'error');
        return;
      }
      if (!outWeight) {
        if (typeof showToast === 'function') showToast('OUT Weight of tanker is required.', 'error');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Starting Trip...';

      try {
        let loc = currentStartTripLocation;
        if (!loc) {
          try {
            loc = await requestStartTripLocationPermission();
          } catch (geoErr) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'CONFIRM START TRIP';
            return;
          }
        }

        const payload = {
          out_km: parseFloat(outKm),
          out_tanker_weight: parseFloat(outWeight),
          latitude: loc ? loc.lat : null,
          longitude: loc ? loc.lng : null
        };

        const res = await apiStartWorkerTrip(selectedTripId, payload);

        if (typeof showToast === 'function') showToast('🚀 Trip started successfully! Active trip is now in progress.', 'success');
        closeStartTripModal();

        // Start continuous active location tracking
        startWorkerLocationTracking(selectedTripId);

        // Reload duties and reopen view duty modal
        await loadDuties();
        openViewDutyModal(selectedTripId);

      } catch (err) {
        console.error('Failed to start trip:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Failed to start trip.', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'CONFIRM START TRIP';
      }
    });
  }
}

function getCurrentPositionPromise() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by your device.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
}

// ── LOCATION TRACKING SYSTEM FOR FIELD WORKER ──────────────────────────────
let workerLocationWatchId = null;
let workerTrackingActive = false;
let workerWakeLock = null;
let workerFallbackInterval = null;
let activeTrackingTripId = null;

async function requestWorkerWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      workerWakeLock = await navigator.wakeLock.request('screen');
    } catch(e) {}
  }
}

function releaseWorkerWakeLock() {
  if (workerWakeLock) {
    try { workerWakeLock.release(); } catch(e) {}
    workerWakeLock = null;
  }
}

function getWorkerGpsQueueKey(tripId) {
  return `worker_offline_gps_queue_${tripId || 'current'}`;
}

function getWorkerGpsQueue(tripId) {
  try {
    const raw = localStorage.getItem(getWorkerGpsQueueKey(tripId));
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveWorkerGpsQueue(tripId, queue) {
  try {
    localStorage.setItem(getWorkerGpsQueueKey(tripId), JSON.stringify(queue));
  } catch(e) {}
}

async function flushWorkerGpsQueue(tripId) {
  if (!tripId) return;
  const queue = getWorkerGpsQueue(tripId);
  if (queue.length === 0) return;

  try {
    await apiUpdateWorkerTripLocation(tripId, { points: queue });
    localStorage.removeItem(getWorkerGpsQueueKey(tripId));
  } catch(err) {
    console.warn('Worker GPS sync failed, retaining queue:', err.message);
  }
}

async function startWorkerLocationTracking(tripId) {
  if (!tripId) return;
  activeTrackingTripId = tripId;

  if (!navigator.geolocation) {
    if (typeof showToast === 'function') showToast('Geolocation is not supported by your device.', 'error');
    return;
  }

  workerTrackingActive = true;
  await requestWorkerWakeLock();
  await flushWorkerGpsQueue(tripId);

  if (!workerLocationWatchId) {
    workerLocationWatchId = navigator.geolocation.watchPosition(
      async (position) => {
        const pt = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: new Date().toISOString()
        };
        const queue = getWorkerGpsQueue(tripId);
        queue.push(pt);
        saveWorkerGpsQueue(tripId, queue);
        await flushWorkerGpsQueue(tripId);
      },
      (error) => {
        console.warn('Worker location watch error:', error.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  if (!workerFallbackInterval) {
    workerFallbackInterval = setInterval(() => {
      if (!workerTrackingActive || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const pt = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            timestamp: new Date().toISOString()
          };
          const queue = getWorkerGpsQueue(tripId);
          queue.push(pt);
          saveWorkerGpsQueue(tripId, queue);
          await flushWorkerGpsQueue(tripId);
        },
        (error) => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }, 20000);
  }
}

function stopWorkerLocationTracking() {
  workerTrackingActive = false;
  if (workerLocationWatchId) {
    navigator.geolocation.clearWatch(workerLocationWatchId);
    workerLocationWatchId = null;
  }
  if (workerFallbackInterval) {
    clearInterval(workerFallbackInterval);
    workerFallbackInterval = null;
  }
  releaseWorkerWakeLock();
  if (activeTrackingTripId) {
    flushWorkerGpsQueue(activeTrackingTripId);
    activeTrackingTripId = null;
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── PHASE 2 — BMC VISIT & TESTING FLOW ──────────────────────────────────────

let currentVisitData = null;

window.closeBmcVisitRow = async function(visitId) {
  if (!visitId || visitId.startsWith('virtual-')) {
    if (typeof showToast === 'function') showToast('Cannot close a virtual visit. Open the visit first.', 'error');
    return;
  }

  // Fetch existing visit data to pre-fill any saved invoice fields
  let existingVisit = null;
  if (activeTripData && activeTripData.visits) {
    existingVisit = activeTripData.visits.find(v => v.id === visitId);
  }

  const serialVal = existingVisit?.invoice_serial_no || '';
  const tempVal = existingVisit?.temperature || '';
  const sealVal = existingVisit?.seal_number || '';
  const brokenVal = existingVisit?.broken_seal_number || '';
  const bmcName = existingVisit?.bmc?.name || existingVisit?.bmc_name || 'BMC';

  // Show invoice modal
  let existing = document.getElementById('close-visit-invoice-modal-dash');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'close-visit-invoice-modal-dash';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="padding:20px 24px 14px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:1.05rem;font-weight:800;color:#0F172A;">🔒 Close BMC Visit — Invoice Details</h3>
        <button class="cvid-cancel" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#94A3B8;padding:4px;">✕</button>
      </div>
      <div style="padding:12px 24px;background:#F0FDF4;border-bottom:1px solid #D1FAE5;font-size:0.85rem;color:#065F46;font-weight:600;">
        📍 ${esc(bmcName)}
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Invoice Serial Number <span style="color:#EF4444;">*</span></label>
          <input id="cvid-serial" type="text" value="${esc(String(serialVal))}" placeholder="e.g. INV-2026-001" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Temperature (°C) <span style="color:#EF4444;">*</span></label>
          <input id="cvid-temperature" type="number" step="0.1" value="${esc(String(tempVal))}" placeholder="e.g. 4.5" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Seal Number <span style="color:#EF4444;">*</span></label>
          <input id="cvid-seal" type="text" value="${esc(String(sealVal))}" placeholder="e.g. SL-0042" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Broken Seal Number <span style="color:#EF4444;">*</span></label>
          <input id="cvid-broken-seal" type="text" value="${esc(String(brokenVal))}" placeholder="e.g. BSL-0019" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;">
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #E2E8F0;display:flex;gap:10px;justify-content:flex-end;">
        <button class="cvid-cancel" style="padding:8px 18px;border:1.5px solid #CBD5E1;border-radius:10px;background:#F8FAFC;color:#475569;font-weight:600;font-size:0.88rem;cursor:pointer;">← Cancel</button>
        <button id="cvid-confirm" style="padding:8px 22px;border:none;border-radius:10px;background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;font-weight:700;font-size:0.88rem;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,0.3);">🔒 Close & Save Invoice</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('.cvid-cancel').forEach(btn => btn.addEventListener('click', () => modal.remove()));

  document.getElementById('cvid-confirm').addEventListener('click', async () => {
    const serial = document.getElementById('cvid-serial').value.trim();
    const temperature = document.getElementById('cvid-temperature').value.trim();
    const seal = document.getElementById('cvid-seal').value.trim();
    const brokenSeal = document.getElementById('cvid-broken-seal').value.trim();

    if (!serial) { if (typeof showToast === 'function') showToast('Invoice Serial Number is mandatory.', 'error'); return; }
    if (!temperature) { if (typeof showToast === 'function') showToast('Temperature is mandatory.', 'error'); return; }
    if (!seal) { if (typeof showToast === 'function') showToast('Seal Number is mandatory.', 'error'); return; }
    if (!brokenSeal) { if (typeof showToast === 'function') showToast('Broken Seal Number is mandatory.', 'error'); return; }

    const confirmBtn = document.getElementById('cvid-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⌛ Saving...';

    try {
      await apiUpdateVisitWeight(visitId, {
        status: 'completed',
        visit_end_time: new Date().toISOString(),
        invoice_serial_no: serial,
        temperature: parseFloat(temperature),
        seal_number: seal,
        broken_seal_number: brokenSeal
      });
      if (typeof showToast === 'function') showToast('BMC visit closed with invoice data saved.', 'success');
      modal.remove();
      if (selectedTripId) await openViewDutyModal(selectedTripId);
      await loadDuties();
    } catch (err) {
      console.error('Error closing BMC visit row:', err);
      if (typeof showToast === 'function') showToast(err.message || 'Failed to close BMC visit.', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = '🔒 Close & Save Invoice';
    }
  });

  setTimeout(() => document.getElementById('cvid-serial')?.focus(), 100);
};

window.openBmcVisitModal = function(visitId, tripId, bmcId, bmcCode) {
  const tId = tripId || selectedTripId || '';
  const params = new URLSearchParams();
  if (visitId) params.set('visitId', visitId);
  if (tId) params.set('tripId', tId);
  if (bmcId) params.set('bmcId', bmcId);
  if (bmcCode) params.set('bmcCode', bmcCode);
  window.location.href = `bmc-visit.html?${params.toString()}`;
};

// ── CLOSE TRIP MODAL LOGIC ──────────────────────────────────────────────────
let closeTripId = null;

function setupCloseTripForm() {
  const confirmBtn = document.getElementById('btn-confirm-close-trip');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', handleCloseTripSubmit);
  }
}

window.openCloseTripModal = async function(tripId) {
  closeTripId = tripId || (activeTripData ? activeTripData.id : null);
  if (!closeTripId) return;

  let trip = currentDuties.find(t => t.id === closeTripId) || activeTripData || {};

  // Always fetch detailed trip from API to ensure we have actual saved out_km & out_weight
  try {
    const detailRes = await apiGetTripDetails(closeTripId);
    if (detailRes && detailRes.trip) {
      trip = { ...trip, ...detailRes.trip };
    }
  } catch(e) {
    console.warn('Failed to fetch trip detail for modal:', e.message);
  }

  const modal = document.getElementById('close-trip-modal');
  if (!modal) return;

  const outKmVal = document.getElementById('ct-out-km-val');
  const outWtVal = document.getElementById('ct-out-wt-val');
  const inKmInput = document.getElementById('ct-in-km');
  const inWeightInput = document.getElementById('ct-in-weight');
  const endTimeInput = document.getElementById('ct-end-time');

  // Robust parsing of OUT KM
  let outKm = null;
  if (trip.out_km !== null && trip.out_km !== undefined && !isNaN(Number(trip.out_km))) {
    outKm = Number(trip.out_km);
  } else if (trip.remarks && trip.remarks.includes('OUT KM:')) {
    const m = trip.remarks.match(/OUT KM:\s*([\d.]+)/i);
    if (m && m[1]) outKm = parseFloat(m[1]);
  }

  // Robust parsing of OUT Weight
  let outWt = null;
  if (trip.out_weight !== null && trip.out_weight !== undefined && !isNaN(Number(trip.out_weight))) {
    outWt = Number(trip.out_weight);
  } else if (trip.out_tanker_weight !== null && trip.out_tanker_weight !== undefined && !isNaN(Number(trip.out_tanker_weight))) {
    outWt = Number(trip.out_tanker_weight);
  } else if (trip.remarks && trip.remarks.includes('OUT Wt:')) {
    const m = trip.remarks.match(/OUT Wt:\s*([\d.]+)/i);
    if (m && m[1]) outWt = parseFloat(m[1]);
  }

  if (outKm !== null) trip.out_km = outKm;
  if (outWt !== null) trip.out_weight = outWt;

  if (outKmVal) outKmVal.textContent = outKm !== null ? `${outKm} KM` : '—';
  if (outWtVal) outWtVal.textContent = outWt !== null ? `${outWt} KG` : '—';

  if (inKmInput) inKmInput.value = '';
  if (inWeightInput) inWeightInput.value = '';

  if (endTimeInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    endTimeInput.value = now.toISOString().slice(0, 16);
  }

  modal.classList.remove('hidden');
};

window.closeCloseTripModal = function() {
  const modal = document.getElementById('close-trip-modal');
  if (modal) modal.classList.add('hidden');
};

async function handleCloseTripSubmit() {
  if (!closeTripId) return;
  const trip = currentDuties.find(t => t.id === closeTripId) || activeTripData || {};
  
  const inKmStr = document.getElementById('ct-in-km')?.value;
  const inWeightStr = document.getElementById('ct-in-weight')?.value;
  const endTimeStr = document.getElementById('ct-end-time')?.value;

  if (!inKmStr) {
    if (typeof showToast === 'function') showToast('IN KM is required to close trip.', 'error');
    return;
  }

  const inKm = parseFloat(inKmStr);
  const outKm = parseFloat(trip.out_km || 0);

  if (isNaN(inKm) || (outKm > 0 && inKm <= outKm)) {
    if (typeof showToast === 'function') showToast(`IN KM (${inKmStr}) must be greater than OUT KM (${outKm} KM).`, 'error');
    return;
  }

  let inWeight = null;
  if (inWeightStr !== undefined && inWeightStr !== null && inWeightStr.trim() !== '') {
    inWeight = parseFloat(inWeightStr);
    const outWeight = parseFloat(trip.out_weight || trip.out_tanker_weight || 0);
    if (!isNaN(inWeight) && outWeight > 0 && inWeight >= outWeight) {
      if (typeof showToast === 'function') showToast(`IN Empty Weight (${inWeight} kg) must be less than OUT Empty Weight (${outWeight} kg).`, 'error');
      return;
    }
  }

  const confirmBtn = document.getElementById('btn-confirm-close-trip');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Closing Trip...';
  }

  try {
    let inTimeIso = null;
    if (endTimeStr) {
      inTimeIso = new Date(endTimeStr).toISOString();
    } else {
      inTimeIso = new Date().toISOString();
    }

    const payload = {
      in_km: inKm,
      empty_tanker_weight: inWeight,
      in_time: inTimeIso
    };

    await apiCompleteWorkerTrip(closeTripId, payload);
    stopWorkerLocationTracking();

    if (typeof showToast === 'function') showToast('✅ Trip completed and closed successfully!', 'success');
    closeCloseTripModal();

    await loadDuties();
    window.switchDutyTab('finished');
  } catch (err) {
    console.error('Failed to close trip:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to close trip.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'CONFIRM CLOSE TRIP';
    }
  }
}

// ── EDIT TRIP MODAL LOGIC ──────────────────────────────────────────────────
let editTripId = null;

function setupEditTripForm() {
  const confirmBtn = document.getElementById('btn-confirm-edit-trip');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', handleEditTripSubmit);
  }
}

window.openEditTripModal = function(tripId) {
  editTripId = tripId;
  const trip = finishedDuties.find(t => t.id === tripId) || currentDuties.find(t => t.id === tripId);
  if (!trip) return;

  const modal = document.getElementById('edit-trip-modal');
  if (!modal) return;

  const titleEl = document.getElementById('et-route-title');
  const outKmVal = document.getElementById('et-out-km-val');
  const outWtVal = document.getElementById('et-out-wt-val');
  const inKmInput = document.getElementById('et-in-km');
  const inWeightInput = document.getElementById('et-in-weight');
  const endTimeInput = document.getElementById('et-end-time');

  if (titleEl) titleEl.textContent = trip.route_description || trip.trip_name || 'Completed Duty';
  if (outKmVal) outKmVal.textContent = (trip.out_km || '—') + ' KM';
  if (outWtVal) outWtVal.textContent = (trip.out_weight || trip.out_tanker_weight || '—') + ' KG';

  if (inKmInput) inKmInput.value = trip.in_km || '';
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
  const trip = finishedDuties.find(t => t.id === editTripId) || {};

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
    if (inKmStr !== undefined && inKmStr !== '') {
      const inKm = parseFloat(inKmStr);
      const outKm = parseFloat(trip.out_km || 0);
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
      const outWeight = parseFloat(trip.out_weight || trip.out_tanker_weight || 0);
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
    await loadDuties();
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
