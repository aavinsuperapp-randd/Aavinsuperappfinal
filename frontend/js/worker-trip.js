// worker-trip.js — Active Trip Management Page Logic

let currentTripId = null;
let currentTrip = null;
let currentVisits = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;

  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Extract trip ID from URL
  const params = new URLSearchParams(window.location.search);
  currentTripId = params.get('id');

  if (!currentTripId) {
    // If no ID passed, try fetching active trip
    const activeRes = await apiGetActiveTrip();
    if (activeRes.trip) {
      currentTripId = activeRes.trip.id;
    } else {
      showToast('No active trip found.', 'error');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
      return;
    }
  }

  await loadTripDetails();
  setupAddBmcModal();

  setupCloseTripModal();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('worker-sidebar') || document.querySelector('.worker-sidebar');
  const main = document.querySelector('.worker-main');
  const overlay = document.getElementById('sidebar-overlay');

  function toggleSidebar() {
    if (window.innerWidth > 900) {
      if (sidebar) sidebar.classList.toggle('collapsed');
      if (main) main.classList.toggle('expanded');
    } else {
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      } else {
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
      }
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 900) {
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
    }
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  if (sidebar) {
    sidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
  }
}

async function loadTripDetails() {
  try {
    const res = await apiGetTrip(currentTripId);
    currentTrip = res.trip;
    currentVisits = res.visits || [];

    renderTripHeader();
    renderVisitsList();

  } catch (err) {
    console.error('Error loading trip details:', err);
    showToast(err.message || 'Failed to load trip', 'error');
  }
}

function renderTripHeader() {
  document.getElementById('trip-title').textContent = currentTrip.trip_name;
  document.getElementById('trip-number-display').textContent = `Trip #: ${currentTrip.trip_number || 'N/A'}`;
  
  const statusBadge = document.getElementById('trip-status-badge');
  if (currentTrip.status === 'completed') {
    statusBadge.textContent = 'Completed';
    statusBadge.className = 'status-pill pill-completed';
    document.getElementById('close-trip-btn').style.display = 'none';
    document.getElementById('add-bmc-to-trip-btn').style.display = 'none';
  } else {
    statusBadge.textContent = 'Active';
    statusBadge.className = 'status-pill pill-active';
  }

  document.getElementById('meta-driver').textContent = currentTrip.driver_name || (currentTrip.driver ? currentTrip.driver.name : 'Unassigned');
  document.getElementById('meta-tanker').textContent = currentTrip.tanker_number || (currentTrip.tanker ? currentTrip.tanker.board_number : 'Unassigned');

  document.getElementById('meta-out-time').textContent = new Date(currentTrip.out_time).toLocaleString();
  document.getElementById('meta-in-time').textContent = currentTrip.in_time ? new Date(currentTrip.in_time).toLocaleString() : 'In Progress';
}

function renderVisitsList() {
  const container = document.getElementById('visit-list-container');
  document.getElementById('visit-count-display').textContent = currentVisits.length;

  if (currentVisits.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏭</div>
        <div class="empty-state-title">No BMCs added to this trip yet</div>
        <div class="empty-state-desc">Click "+ Add BMC to Route" to add the first Bulk Milk Cooler to visit.</div>
      </div>
    `;
    return;
  }

  // Count visits per bmc_id to determine first vs second (After Mixing) visit
  const bmcOccurrenceMap = {};

  container.innerHTML = currentVisits.map((v, idx) => {
    const isDone = v.status === 'completed';
    let rawBmcName = v.bmc ? v.bmc.name : 'Unknown BMC';

    const count = (bmcOccurrenceMap[v.bmc_id] || 0) + 1;
    bmcOccurrenceMap[v.bmc_id] = count;

    const isAfterMixing = v.is_after_mixing || (v.remarks && v.remarks.includes('[AFTER MIXING]')) || count > 1;
    const bmcName = rawBmcName + (isAfterMixing ? ' (After Mixing)' : '');

    const bmcLocation = v.bmc ? `${v.bmc.location}, ${v.bmc.district}` : '';
    const compText = v.compartment ? `Compartment: ${v.compartment.toUpperCase()}` : 'Compartment: Not set';

    return `
      <div class="visit-item">
        <div class="visit-seq ${isDone ? 'done' : ''}">${v.visit_sequence}</div>
        <div class="visit-item-body">
          <div class="visit-item-name">${esc(bmcName)}</div>
          <div class="visit-item-meta">📍 ${esc(bmcLocation)} | ${esc(compText)}</div>
        </div>
        <div class="visit-item-status">
          <span class="status-pill ${isDone ? 'pill-completed' : (v.status === 'in_progress' ? 'pill-active' : 'pill-pending')}">
            ${v.status === 'completed' ? '✓ Visited' : (v.status === 'in_progress' ? '● In Visit' : '○ Pending')}
          </span>
        </div>
        <div class="visit-item-actions">
          <a href="bmc-visit.html?visit_id=${v.id}" class="btn btn-sm ${isDone ? 'btn-outline' : 'btn-primary'}">
            ${isDone ? 'View / Edit Visit' : 'Perform Visit →'}
          </a>
          <button class="btn btn-outline btn-sm" style="color:#ef4444; border-color:#fca5a5;" onclick="deleteBmcVisit('${v.id}', '${esc(bmcName)}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.deleteBmcVisit = async function(visitId, bmcName) {
  if (!confirm(`Are you sure you want to delete the visit for "${bmcName}" from this trip route?`)) return;
  try {
    showToast('Removing BMC visit...', 'info');
    await apiDeleteVisit(visitId);
    showToast('BMC visit removed from trip route!', 'success');
    await loadTripDetails();
  } catch (err) {
    showToast(err.message || 'Failed to delete BMC visit.', 'error');
  }
};


function setupAddBmcModal() {
  const modal = document.getElementById('add-bmc-modal');
  const openBtn = document.getElementById('add-bmc-to-trip-btn');
  const closeBtn = document.getElementById('add-bmc-close');
  const input = document.getElementById('add-bmc-input');
  const resultsDiv = document.getElementById('add-bmc-results');

  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    input.focus();
    performBmcSearch('');
  });

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  let timer;
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => performBmcSearch(e.target.value), 300);
  });

  async function performBmcSearch(q) {
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Loading BMCs...</div></div>';
    try {
      let list = [];
      
      if (currentTrip && currentTrip.bmc_id) {
        if (currentTrip.assigned_bmc) {
          const match = q === '' || 
            (currentTrip.assigned_bmc.name && currentTrip.assigned_bmc.name.toLowerCase().includes(q.toLowerCase())) ||
            (currentTrip.assigned_bmc.district && currentTrip.assigned_bmc.district.toLowerCase().includes(q.toLowerCase())) ||
            (currentTrip.assigned_bmc.location && currentTrip.assigned_bmc.location.toLowerCase().includes(q.toLowerCase()));
          
          if (match) {
            list = [currentTrip.assigned_bmc];
          }
        } else {
          // Fallback if assigned_bmc isn't populated but bmc_id is present
          const res = await apiSearchBmcs(q);
          list = (res.bmcs || []).filter(b => b.id === currentTrip.bmc_id);
        }
      } else {
        // If no BMC is assigned to the trip, we probably shouldn't show any, 
        // but for safety if it's an old trip without an assignment, we can show none.
        list = [];
      }
      
      // Count existing visits per BMC in current trip
      const bmcCountMap = {};
      currentVisits.forEach(v => {
        bmcCountMap[v.bmc_id] = (bmcCountMap[v.bmc_id] || 0) + 1;
      });
      
      if (list.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No BMC found, or no BMC has been assigned to this trip. You can only view the BMC assigned to you for this trip.</div></div>';
        return;
      }

      resultsDiv.innerHTML = list.map(b => {
        const addedCount = bmcCountMap[b.id] || 0;
        const maxReached = addedCount >= 2;

        let buttonHtml = '';
        if (maxReached) {
          buttonHtml = `<span class="status-pill pill-completed">Added (2/2)</span>`;
        } else if (addedCount === 1) {
          buttonHtml = `<button class="btn btn-primary btn-sm" onclick="addBmcToTrip('${b.id}')">+ Add (After Mixing)</button>`;
        } else {
          buttonHtml = `<button class="btn btn-primary btn-sm" onclick="addBmcToTrip('${b.id}')">+ Add</button>`;
        }

        return `
          <div class="search-result-item" style="${maxReached ? 'opacity:0.6;' : ''}">
            <div class="search-result-img">
              ${b.profile_image_url ? `<img src="${esc(b.profile_image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" alt="${esc(b.name)}">` : '🏭'}
            </div>
            <div style="flex:1;">
              <div class="search-result-name">${esc(b.name)} ${addedCount === 1 ? '<span style="font-size:0.75rem; color:#6b7280;">(1st visit added)</span>' : ''}</div>
              <div class="search-result-meta">📍 ${esc(b.location)}, ${esc(b.district)}</div>
            </div>
            <div>
              ${buttonHtml}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      resultsDiv.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Error: ${esc(err.message)}</div></div>`;
    }
  }
}

window.addBmcToTrip = async function(bmcId) {
  try {
    showToast('Adding BMC to route...', 'info');
    await apiAddBmcToTrip(currentTripId, bmcId);
    showToast('BMC added to route!', 'success');
    document.getElementById('add-bmc-modal').classList.add('hidden');
    await loadTripDetails();
  } catch (err) {
    console.error('Failed to add BMC:', err);
    showToast(err.message || 'Failed to add BMC.', 'error');
  }
};



function getOptimizedBase64(file, maxWidth = 800, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function setupCloseTripModal() {
  const modal = document.getElementById('close-trip-modal');
  const openBtn = document.getElementById('close-trip-btn');
  const cancelBtn = document.getElementById('close-modal-cancel');
  const confirmBtn = document.getElementById('confirm-close-trip-btn');
  const inTimeInput = document.getElementById('factory-in-time');

  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    inTimeInput.value = now.toISOString().slice(0, 16);
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  confirmBtn.addEventListener('click', async () => {
    const inTime = inTimeInput.value;
    const remarks = document.getElementById('trip-closing-remarks').value;

    if (!inTime) {
      showToast('Factory IN-time is required.', 'error');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Closing...';

    try {
      await apiCompleteTrip(currentTripId, {
        in_time: new Date(inTime).toISOString(),
        remarks
      });

      showToast('Trip successfully completed & closed!', 'success');
      modal.classList.add('hidden');
      await loadTripDetails();

    } catch (err) {
      console.error('Failed to complete trip:', err);
      showToast(err.message || 'Failed to close trip.', 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Close Trip';
    }
  });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.downloadTripReport = function() {
  if (!currentTrip || !currentVisits) {
    showToast('Trip data not loaded yet.', 'error');
    return;
  }

  try {
    const aoa = [];

    // Title rows
    aoa.push(['MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD - MADURAI-20']);
    aoa.push(['SPOT ACKNOWLEDGEMENT TEST DETAILS']);

    // Header rows (Row 3 & 4)
    aoa.push([
      'S.NO',
      'NAME OF THE BMC',
      'FTIR TEST', '', '',
      'GERBER TEST', '', '', '',
      'CONTAINER',
      'TOTAL (kg)',
      'SUMMARY'
    ]);
    aoa.push([
      '', '',
      'FAT', 'SNF', 'QNTY(KG)',
      'FAT', 'LMR', 'SNF', 'QNTY(KG)',
      '', '', ''
    ]);

    let grandTotalQty = 0;
    const bmcCountMap = {};

    currentVisits.forEach((v, idx) => {
      const count = (bmcCountMap[v.bmc_id] || 0) + 1;
      bmcCountMap[v.bmc_id] = count;
      const isAfterMixing = v.is_after_mixing || (v.remarks && v.remarks.includes('[AFTER MIXING]')) || count > 1;

      const rawBmcName = v.bmc ? v.bmc.name : 'Unknown BMC';
      const bmcName = rawBmcName + (isAfterMixing ? ' (After Mixing)' : '');

      const ftir = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : v.ftir_tests;
      const gerber = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : v.gerber_tests;

      const ftirFat = (ftir && ftir.fat !== null && ftir.fat !== undefined) ? ftir.fat : '-';
      const ftirSnf = (ftir && ftir.snf !== null && ftir.snf !== undefined) ? ftir.snf : '-';

      const gerberFat = (gerber && gerber.fat_percentage !== null && gerber.fat_percentage !== undefined) ? gerber.fat_percentage : '-';
      const gerberLmr = (gerber && gerber.clr !== null && gerber.clr !== undefined) ? gerber.clr : '-';
      const gerberSnf = (gerber && gerber.snf !== null && gerber.snf !== undefined) ? gerber.snf : '-';

      const qty = v.milk_quantity_liters ? Number(v.milk_quantity_liters) : null;
      if (qty && !isAfterMixing) {
        grandTotalQty += qty;
      }

      // Container text formatting
      let containerText = '-';
      if (v.compartment) {
        const compUpper = String(v.compartment).toLowerCase();
        if (compUpper.includes('front')) containerText = '1(FrontSide)';
        else if (compUpper.includes('back')) containerText = '2(Backside)';
        else containerText = v.compartment;
      }

      // Summary compiling: collect remarks & issues
      const summaryParts = [];
      if (v.remarks && !v.remarks.includes('[AFTER MIXING]')) {
        summaryParts.push(v.remarks.replace(/\[FTIR_IMAGE:.*?\]/g, '').trim());
      }
      if (v.bmc_issues && Array.isArray(v.bmc_issues) && v.bmc_issues.length > 0) {
        v.bmc_issues.forEach(iss => {
          if (iss.description) summaryParts.push(iss.description);
        });
      }
      if (ftir && ftir.remarks) summaryParts.push(ftir.remarks);
      if (gerber && gerber.remarks) summaryParts.push(gerber.remarks);

      const summaryText = summaryParts.filter(Boolean).join('; ') || '-';

      aoa.push([
        idx + 1,
        bmcName,
        ftirFat,
        ftirSnf,
        qty ? qty : (isAfterMixing ? '' : '-'),
        gerberFat,
        gerberLmr,
        gerberSnf,
        qty ? qty : (isAfterMixing ? '' : '-'),
        containerText,
        qty ? qty : '-',
        summaryText
      ]);
    });

    // Total row at bottom
    aoa.push([
      '', '', '', '', '', '', '', '', '', '',
      grandTotalQty > 0 ? grandTotalQty : '-',
      ''
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Merges
    ws['!merges'] = [
      // Title 1: A1:L1
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      // Title 2: A2:L2
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      // S.NO: A3:A4
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
      // NAME OF THE BMC: B3:B4
      { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } },
      // FTIR TEST: C3:E3
      { s: { r: 2, c: 2 }, e: { r: 2, c: 4 } },
      // GERBER TEST: F3:I3
      { s: { r: 2, c: 5 }, e: { r: 2, c: 8 } },
      // CONTAINER: J3:J4
      { s: { r: 2, c: 9 }, e: { r: 3, c: 9 } },
      // TOTAL: K3:K4
      { s: { r: 2, c: 10 }, e: { r: 3, c: 10 } },
      // SUMMARY: L3:L4
      { s: { r: 2, c: 11 }, e: { r: 3, c: 11 } }
    ];

    // Column widths
    ws['!cols'] = [
      { wch: 6 },   // S.NO
      { wch: 30 },  // BMC NAME
      { wch: 8 },   // FTIR FAT
      { wch: 8 },   // FTIR SNF
      { wch: 10 },  // FTIR QNTY
      { wch: 8 },   // GERBER FAT
      { wch: 8 },   // GERBER LMR
      { wch: 8 },   // GERBER SNF
      { wch: 10 },  // GERBER QNTY
      { wch: 15 },  // CONTAINER
      { wch: 12 },  // TOTAL (kg)
      { wch: 45 }   // SUMMARY
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Spot Acknowledgement');

    const fileName = `AAVIN_Trip_${currentTrip.trip_number || currentTrip.id}_Spot_Acknowledgement.xlsx`;
    XLSX.writeFile(wb, fileName);

    showToast('Report downloaded successfully!', 'success');
  } catch (err) {
    console.error('Failed to export Excel report:', err);
    showToast('Export failed: ' + (err.message || 'Unknown error'), 'error');
  }
};
