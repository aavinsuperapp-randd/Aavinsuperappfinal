// worker-bmc-visit.js — Dedicated BMC Visit Page Controller

let currentVisitData = null;
let currentTripId = null;
let currentVisitId = null;
let currentBmcId = null;
let currentBmcCode = null;

function getUrlParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name) || urlParams.get(name.replace(/([A-Z])/g, '_$1').toLowerCase());
}

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  const urlParams = new URLSearchParams(window.location.search);
  currentVisitId = urlParams.get('visitId');
  currentTripId = urlParams.get('tripId');
  currentBmcId = urlParams.get('bmcId');
  currentBmcCode = urlParams.get('bmcCode');

  setupSidebarToggle();
  setupSaveButtonListeners();
  
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  if (!currentVisitId && !currentTripId && !currentBmcId && !currentBmcCode) {
    alert('Invalid visit request. Redirecting to Duty dashboard.');
    window.location.href = 'dashboard.html';
    return;
  }

  await loadVisitDetails();
});

function setupSidebarToggle() {
  const sidebar = document.getElementById('worker-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      if (overlay) overlay.classList.toggle('active');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

async function loadVisitDetails() {
  const bmcNameEl = document.getElementById('bv-bmc-name');
  const bmcSubEl = document.getElementById('bv-bmc-sub');
  const seqBadgeEl = document.getElementById('bv-seq-badge');
  const statusBadgeEl = document.getElementById('bv-status-badge');

  const weightKgInput = document.getElementById('bv-weight-kg');
  const ftirFatInput = document.getElementById('bv-ftir-fat');
  const ftirSnfInput = document.getElementById('bv-ftir-snf');
  const gerberFatInput = document.getElementById('bv-gerber-fat');
  const gerberSnfInput = document.getElementById('bv-gerber-snf');
  const gerberLactoInput = document.getElementById('bv-gerber-lacto');
  const reportTextInput = document.getElementById('bv-report-text');
  const reportPrioritySelect = document.getElementById('bv-report-priority');

  try {
    let visitData = null;

    // 1. Try direct fetch if visitId is a real UUID
    if (currentVisitId && !currentVisitId.startsWith('virtual-')) {
      try {
        const res = await apiGetVisitDetails(currentVisitId);
        if (res && res.visit) visitData = res.visit;
      } catch (e) {
        console.warn('Direct visit fetch warning:', e);
      }
    }

    // 2. If visitData not loaded yet, use trip details & bmcId/bmcCode to resolve or create database visit record
    if (!visitData && currentTripId) {
      let tripRes = null;
      try {
        tripRes = await apiGetTripDetails(currentTripId);
      } catch (e) {
        console.warn('Trip details fetch error:', e);
      }

      const visits = (tripRes && tripRes.visits) || [];
      const selectedBmcs = (tripRes && tripRes.trip && tripRes.trip.selected_bmcs) || [];

      let targetBmcId = currentBmcId || null;

      if (!targetBmcId) {
        if (currentVisitId && currentVisitId.startsWith('virtual-')) {
          const idx = parseInt(currentVisitId.replace('virtual-', ''), 10);
          if (!isNaN(idx)) {
            if (visits[idx] && visits[idx].bmc_id) {
              targetBmcId = visits[idx].bmc_id;
            } else if (selectedBmcs[idx] && selectedBmcs[idx].bmc_id) {
              targetBmcId = selectedBmcs[idx].bmc_id;
            }
          }
        }

        if (!targetBmcId && currentBmcCode) {
          const matchedVis = visits.find(v => (v.bmc && (v.bmc.bmc_code === currentBmcCode || v.bmc.code === currentBmcCode)) || v.bmc_code === currentBmcCode);
          const matchedSel = selectedBmcs.find(b => b.bmc_code === currentBmcCode || b.bmc_name === currentBmcCode);
          if (matchedVis) targetBmcId = matchedVis.bmc_id;
          else if (matchedSel) targetBmcId = matchedSel.bmc_id;
        }

        if (!targetBmcId && visits.length > 0) {
          const found = visits.find(v => v.id === currentVisitId);
          targetBmcId = found ? found.bmc_id : (visits[0] ? visits[0].bmc_id : null);
        }

        if (!targetBmcId && selectedBmcs.length > 0) {
          targetBmcId = selectedBmcs[0].bmc_id;
        }
      }

      const bmcToResolve = targetBmcId || currentBmcId || currentBmcCode;
      if (bmcToResolve) {
        try {
          const createRes = await workerFetch(`/api/trips/${currentTripId}/visits`, {
            method: 'POST',
            body: JSON.stringify({ bmc_id: bmcToResolve })
          });
          if (createRes && createRes.visit) {
            visitData = createRes.visit;
            currentVisitId = visitData.id;
          }
        } catch (e) {
          console.error('Visit resolution failed:', e);
        }
      }

      if (!visitData && visits.length > 0) {
        const found = visits.find(v => v.id === currentVisitId || v.bmc_id === targetBmcId) || visits[0];
        if (found && !found.id.startsWith('virtual-')) {
          visitData = found;
          currentVisitId = visitData.id;
        }
      }
    }

    if (!visitData) {
      throw new Error('BMC Visit record could not be loaded from database.');
    }

    currentVisitData = visitData;
    currentVisitId = visitData.id;

    const bmcName = visitData.bmc ? visitData.bmc.name : (visitData.bmc_name || 'BMC Unit');
    const bmcCode = visitData.bmc ? (visitData.bmc.code || visitData.bmc.bmc_code || '') : '';
    const bmcLoc = visitData.bmc ? (visitData.bmc.district || visitData.bmc.location || 'BMC Center') : 'BMC Center';

    if (seqBadgeEl) seqBadgeEl.textContent = `BMC #${visitData.visit_sequence || 1}`;
    if (bmcNameEl) bmcNameEl.textContent = bmcName;
    if (bmcSubEl) bmcSubEl.textContent = bmcCode ? `${bmcCode} • ${bmcLoc}` : bmcLoc;

    if (statusBadgeEl) {
      const isComp = visitData.status === 'completed' || visitData.visit_end_time;
      statusBadgeEl.className = isComp ? 'badge badge-success' : (visitData.status === 'in_progress' ? 'badge badge-blue' : 'badge badge-warning');
      statusBadgeEl.textContent = isComp ? 'Completed' : (visitData.status === 'in_progress' ? 'In Progress' : 'Pending');
    }

    if (document.getElementById('bv-compartment') && visitData.compartment) {
      const rawC = String(visitData.compartment).toLowerCase().trim();
      let compVal = 'Front';
      if (rawC === 'mid' || rawC === 'middle') compVal = 'Mid';
      else if (rawC === 'rear' || rawC === 'back') compVal = 'Rear';
      else if (rawC === 'front') compVal = 'Front';
      else compVal = visitData.compartment.charAt(0).toUpperCase() + visitData.compartment.slice(1);
      document.getElementById('bv-compartment').value = compVal;
    }

    // Populate saved weight
    if (visitData.milk_quantity_kg || visitData.milk_quantity_liters || visitData.in_weight) {
      const kg = visitData.milk_quantity_kg || visitData.in_weight || (visitData.milk_quantity_liters ? Math.round(visitData.milk_quantity_liters * 1.03 * 10) / 10 : '');
      if (weightKgInput) weightKgInput.value = kg;
      markSectionSaved('weight');
    }

    // Populate saved FTIR
    const ftirData = Array.isArray(visitData.ftir_tests) ? visitData.ftir_tests[0] : visitData.ftir_tests;
    if (ftirData) {
      if (ftirData.fat !== undefined && ftirData.fat !== null && ftirFatInput) ftirFatInput.value = ftirData.fat;
      if (ftirData.snf !== undefined && ftirData.snf !== null && ftirSnfInput) ftirSnfInput.value = ftirData.snf;
      markSectionSaved('ftir');
    }

    // Populate saved Gerber
    const gerberData = Array.isArray(visitData.gerber_tests) ? visitData.gerber_tests[0] : visitData.gerber_tests;
    if (gerberData) {
      if (gerberData.fat_percentage !== undefined && gerberData.fat_percentage !== null && gerberFatInput) gerberFatInput.value = gerberData.fat_percentage;
      if (gerberData.snf !== undefined && gerberData.snf !== null && gerberSnfInput) gerberSnfInput.value = gerberData.snf;
      if (gerberData.clr !== undefined && gerberData.clr !== null && gerberLactoInput) gerberLactoInput.value = gerberData.clr;
      markSectionSaved('gerber');
    }

    // Populate saved Report/Issues
    const issueData = Array.isArray(visitData.bmc_issues) ? visitData.bmc_issues[visitData.bmc_issues.length - 1] : visitData.bmc_issues;
    if (issueData) {
      if (reportTextInput) reportTextInput.value = issueData.description || issueData.remarks || '';
      if (issueData.severity && reportPrioritySelect) {
        const s = String(issueData.severity).toLowerCase();
        reportPrioritySelect.value = s === 'high' ? 'High' : (s === 'low' ? 'Low' : 'Mid');
      }
      markSectionSaved('report');
    }

  } catch (err) {
    console.error('Error loading visit details page:', err);
    alert(err.message || 'Failed to load BMC visit data.');
  }
}

function markSectionSaved(section) {
  const btnMap = {
    weight: { id: 'bv-btn-save-weight' },
    ftir: { id: 'bv-btn-save-ftir' },
    gerber: { id: 'bv-btn-save-gerber' },
    report: { id: 'bv-btn-save-report' }
  };

  const item = btnMap[section];
  if (!item) return;
  const btn = document.getElementById(item.id);
  if (!btn) return;

  btn.dataset.saved = 'true';
  btn.innerHTML = '✓ Saved';
  btn.style.backgroundColor = '#16A34A';
  btn.style.borderColor = '#16A34A';
  btn.style.color = '#FFFFFF';
}

function markSectionEdit(section) {
  const btnMap = {
    weight: { id: 'bv-btn-save-weight', label: '💾 UPDATE WEIGHT' },
    ftir: { id: 'bv-btn-save-ftir', label: '💾 UPDATE FTIR TEST' },
    gerber: { id: 'bv-btn-save-gerber', label: '💾 UPDATE GERBER TEST' },
    report: { id: 'bv-btn-save-report', label: '💾 UPDATE REPORT' }
  };

  const item = btnMap[section];
  if (!item) return;
  const btn = document.getElementById(item.id);
  if (!btn || btn.dataset.saved !== 'true') return;

  btn.dataset.saved = 'false';
  btn.innerHTML = item.label;
  btn.style.backgroundColor = '';
  btn.style.borderColor = '';
  btn.style.color = '';
}

function setupSaveButtonListeners() {
  const setupEditListener = (fieldIds, section) => {
    fieldIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => markSectionEdit(section));
        el.addEventListener('change', () => markSectionEdit(section));
      }
    });
  };

  setupEditListener(['bv-compartment', 'bv-weight-kg'], 'weight');
  setupEditListener(['bv-ftir-fat', 'bv-ftir-snf'], 'ftir');
  setupEditListener(['bv-gerber-fat', 'bv-gerber-snf', 'bv-gerber-lacto'], 'gerber');
  setupEditListener(['bv-report-text', 'bv-report-priority'], 'report');

  // 1. Save Weight
  const btnSaveWeight = document.getElementById('bv-btn-save-weight');
  if (btnSaveWeight) {
    btnSaveWeight.addEventListener('click', async () => {
      if (btnSaveWeight.dataset.saved === 'true') {
        markSectionEdit('weight');
        document.getElementById('bv-weight-kg')?.focus();
        return;
      }

      if (!currentVisitData || !currentVisitData.id) {
        alert('No active visit loaded.');
        return;
      }
      const comp = document.getElementById('bv-compartment')?.value || 'Front';
      const weightKg = parseFloat(document.getElementById('bv-weight-kg')?.value);

      if (isNaN(weightKg) || weightKg <= 0) {
        alert('Please enter a valid Milk Weight in KG.');
        return;
      }

      const liters = parseFloat((weightKg / 1.03).toFixed(2));

      const rawC = String(comp).toLowerCase().trim();
      let compDB = 'front';
      if (rawC === 'mid' || rawC === 'middle') compDB = 'mid';
      else if (rawC === 'rear' || rawC === 'back') compDB = 'rear';

      try {
        const updateRes = await apiUpdateVisitWeight(currentVisitData.id, {
          compartment: compDB,
          milk_quantity_liters: liters,
          milk_quantity_kg: weightKg,
          in_weight: weightKg,
          status: 'in_progress',
          visit_start_time: currentVisitData.visit_start_time || new Date().toISOString()
        });
        if (updateRes && updateRes.visit) {
          currentVisitData = updateRes.visit;
        }
        markSectionSaved('weight');
      } catch (err) {
        alert(err.message || 'Failed to save weight.');
      }
    });
  }

  // 2. Save FTIR Test
  const btnSaveFtir = document.getElementById('bv-btn-save-ftir');
  if (btnSaveFtir) {
    btnSaveFtir.addEventListener('click', async () => {
      if (btnSaveFtir.dataset.saved === 'true') {
        markSectionEdit('ftir');
        document.getElementById('bv-ftir-fat')?.focus();
        return;
      }

      if (!currentVisitData || !currentVisitData.id) {
        alert('No active visit loaded.');
        return;
      }
      const fat = parseFloat(document.getElementById('bv-ftir-fat')?.value);
      const snf = parseFloat(document.getElementById('bv-ftir-snf')?.value);

      if (isNaN(fat) || isNaN(snf)) {
        alert('Please enter valid FAT and SNF values for FTIR test.');
        return;
      }

      try {
        const res = await apiSaveFtirTest(currentVisitData.id, { fat, snf });
        if (res && res.ftir) {
          currentVisitData.ftir_tests = [res.ftir];
        }
        markSectionSaved('ftir');
      } catch (err) {
        alert(err.message || 'Failed to save FTIR test.');
      }
    });
  }

  // 3. Save Gerber Test
  const btnSaveGerber = document.getElementById('bv-btn-save-gerber');
  if (btnSaveGerber) {
    btnSaveGerber.addEventListener('click', async () => {
      if (btnSaveGerber.dataset.saved === 'true') {
        markSectionEdit('gerber');
        document.getElementById('bv-gerber-fat')?.focus();
        return;
      }

      if (!currentVisitData || !currentVisitData.id) {
        alert('No active visit loaded.');
        return;
      }
      const fat = parseFloat(document.getElementById('bv-gerber-fat')?.value);
      const snf = parseFloat(document.getElementById('bv-gerber-snf')?.value);
      const lacto = parseFloat(document.getElementById('bv-gerber-lacto')?.value);

      if (isNaN(fat) || isNaN(snf) || isNaN(lacto)) {
        alert('Please enter FAT, SNF, and Lactometer values for Gerber test.');
        return;
      }

      try {
        const res = await apiSaveGerberTest(currentVisitData.id, {
          fat_percentage: fat,
          snf,
          clr: lacto
        });
        if (res && res.gerber) {
          currentVisitData.gerber_tests = [res.gerber];
        }
        markSectionSaved('gerber');
      } catch (err) {
        alert(err.message || 'Failed to save Gerber test.');
      }
    });
  }

  // 4. Save Report
  const btnSaveReport = document.getElementById('bv-btn-save-report');
  if (btnSaveReport) {
    btnSaveReport.addEventListener('click', async () => {
      if (btnSaveReport.dataset.saved === 'true') {
        markSectionEdit('report');
        document.getElementById('bv-report-text')?.focus();
        return;
      }

      if (!currentVisitData || !currentVisitData.id) {
        alert('No active visit loaded.');
        return;
      }
      const text = document.getElementById('bv-report-text')?.value.trim();
      const priority = document.getElementById('bv-report-priority')?.value.toLowerCase() || 'medium';

      if (!text) {
        alert('Please enter report/remarks text.');
        return;
      }

      try {
        const res = await apiSaveReportIssue(currentVisitData.id, {
          category: 'operational',
          description: text,
          severity: priority === 'high' ? 'high' : (priority === 'low' ? 'low' : 'medium'),
          remarks: text
        });
        if (res && res.issue) {
          currentVisitData.bmc_issues = [res.issue];
        }
        markSectionSaved('report');
      } catch (err) {
        alert(err.message || 'Failed to save report.');
      }
    });
  }
}

window.handleCloseBmcVisit = async function() {
  const tripId = getUrlParam('tripId') || currentTripId;
  const bmcId = getUrlParam('bmcId') || currentBmcId;
  const bmcCode = getUrlParam('bmcCode') || currentBmcCode;

  let targetVisitId = (currentVisitData && currentVisitData.id) ? currentVisitData.id : (currentVisitId && !currentVisitId.startsWith('virtual-') ? currentVisitId : null);

  // If no real visit ID, create one first
  if (!targetVisitId || targetVisitId.startsWith('virtual-')) {
    if (tripId) {
      try {
        const createRes = await workerFetch(`/api/trips/${tripId}/visits`, {
          method: 'POST',
          body: JSON.stringify({ bmc_id: bmcId || bmcCode || null, bmc_code: bmcCode || null })
        });
        if (createRes && createRes.visit) {
          targetVisitId = createRes.visit.id;
          currentVisitData = createRes.visit;
        }
      } catch(e) {
        alert('Could not resolve visit record: ' + e.message);
        return;
      }
    }
  }

  if (!targetVisitId || targetVisitId.startsWith('virtual-')) {
    alert('Could not resolve a valid BMC visit record to close.');
    return;
  }

  // Check if invoice data already exists (re-open case)
  const existingSerial = currentVisitData?.invoice_serial_no || '';
  const existingTemp = currentVisitData?.temperature || '';
  const existingSeal = currentVisitData?.seal_number || '';
  const existingBroken = currentVisitData?.broken_seal_number || '';

  // Show the close visit invoice modal
  showCloseVisitInvoiceModal(targetVisitId, tripId, existingSerial, existingTemp, existingSeal, existingBroken);
};

function showCloseVisitInvoiceModal(visitId, tripId, serialVal, tempVal, sealVal, brokenVal) {
  // Remove old modal if present
  let existing = document.getElementById('close-visit-invoice-modal');
  if (existing) existing.remove();

  const bmcName = currentVisitData?.bmc?.name || currentVisitData?.bmc_name || 'BMC';

  const modal = document.createElement('div');
  modal.id = 'close-visit-invoice-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="padding:20px 24px 14px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:1.05rem;font-weight:800;color:#0F172A;">🔒 Close BMC Visit — Invoice Details</h3>
        <button id="cvi-modal-cancel" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#94A3B8;padding:4px;">✕</button>
      </div>
      <div style="padding:12px 24px;background:#F0FDF4;border-bottom:1px solid #D1FAE5;font-size:0.85rem;color:#065F46;font-weight:600;">
        📍 ${bmcName}
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Invoice Serial Number <span style="color:#EF4444;">*</span></label>
          <input id="cvi-serial" type="text" value="${serialVal}" placeholder="e.g. INV-2026-001" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;transition:border 0.15s;" onfocus="this.style.borderColor='#2563EB'" onblur="this.style.borderColor='#CBD5E1'">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Temperature (°C) <span style="color:#EF4444;">*</span></label>
          <input id="cvi-temperature" type="number" step="0.1" value="${tempVal}" placeholder="e.g. 4.5" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;transition:border 0.15s;" onfocus="this.style.borderColor='#2563EB'" onblur="this.style.borderColor='#CBD5E1'">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Seal Number <span style="color:#EF4444;">*</span></label>
          <input id="cvi-seal" type="text" value="${sealVal}" placeholder="e.g. SL-0042" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;transition:border 0.15s;" onfocus="this.style.borderColor='#2563EB'" onblur="this.style.borderColor='#CBD5E1'">
        </div>
        <div>
          <label style="font-size:0.82rem;font-weight:700;color:#334155;display:block;margin-bottom:4px;">Broken Seal Number <span style="color:#EF4444;">*</span></label>
          <input id="cvi-broken-seal" type="text" value="${brokenVal}" placeholder="e.g. BSL-0019" style="width:100%;padding:10px 14px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.92rem;font-family:Outfit,sans-serif;outline:none;transition:border 0.15s;" onfocus="this.style.borderColor='#2563EB'" onblur="this.style.borderColor='#CBD5E1'">
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #E2E8F0;display:flex;gap:10px;justify-content:flex-end;">
        <button id="cvi-modal-back" style="padding:8px 18px;border:1.5px solid #CBD5E1;border-radius:10px;background:#F8FAFC;color:#475569;font-weight:600;font-size:0.88rem;cursor:pointer;">← Cancel</button>
        <button id="cvi-modal-confirm" style="padding:8px 22px;border:none;border-radius:10px;background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;font-weight:700;font-size:0.88rem;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,0.3);">🔒 Close & Save Invoice</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Event handlers
  document.getElementById('cvi-modal-cancel').addEventListener('click', () => modal.remove());
  document.getElementById('cvi-modal-back').addEventListener('click', () => modal.remove());

  document.getElementById('cvi-modal-confirm').addEventListener('click', async () => {
    const serial = document.getElementById('cvi-serial').value.trim();
    const temperature = document.getElementById('cvi-temperature').value.trim();
    const seal = document.getElementById('cvi-seal').value.trim();
    const brokenSeal = document.getElementById('cvi-broken-seal').value.trim();

    if (!serial) { alert('Invoice Serial Number is mandatory.'); return; }
    if (!temperature) { alert('Temperature is mandatory.'); return; }
    if (!seal) { alert('Seal Number is mandatory.'); return; }
    if (!brokenSeal) { alert('Broken Seal Number is mandatory.'); return; }

    const confirmBtn = document.getElementById('cvi-modal-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⌛ Saving...';

    try {
      const updateRes = await apiUpdateVisitWeight(visitId, {
        status: 'completed',
        visit_end_time: new Date().toISOString(),
        invoice_serial_no: serial,
        temperature: parseFloat(temperature),
        seal_number: seal,
        broken_seal_number: brokenSeal
      });
      if (updateRes && updateRes.visit) {
        currentVisitData = updateRes.visit;
      }

      modal.remove();
      // Redirect to trip dashboard
      window.location.href = tripId ? `dashboard.html?tripId=${tripId}` : 'dashboard.html';
    } catch (e) {
      console.error('Error closing BMC visit with invoice:', e);
      alert(e.message || 'Failed to close BMC visit. Please try again.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = '🔒 Close & Save Invoice';
    }
  });

  // Focus first input
  setTimeout(() => document.getElementById('cvi-serial')?.focus(), 100);
}

