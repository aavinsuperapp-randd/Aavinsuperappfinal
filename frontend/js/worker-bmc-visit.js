// worker-bmc-visit.js — Dedicated BMC Visit Page Controller

let currentVisitData = null;
let currentTripId = null;
let currentVisitId = null;
let currentBmcId = null;
let currentBmcCode = null;
let selectedStarRating = 5;

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
  setupStarRating();
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
  const reviewTextInput = document.getElementById('bv-review-text');

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

    // Populate saved Review/Ratings
    const ratingData = Array.isArray(visitData.bmc_ratings) ? visitData.bmc_ratings[0] : visitData.bmc_ratings;
    if (ratingData) {
      if (reviewTextInput) reviewTextInput.value = ratingData.remarks || '';
      const score = Math.round(ratingData.overall_rating || ratingData.behaviour || 5);
      setStarRatingUI(score);
      markSectionSaved('review');
    }

  } catch (err) {
    console.error('Error loading visit details page:', err);
    alert(err.message || 'Failed to load BMC visit data.');
  }
}

function setupStarRating() {
  const container = document.getElementById('star-rating-container');
  if (!container) return;
  const stars = container.querySelectorAll('span');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.getAttribute('data-star') || '5', 10);
      setStarRatingUI(val);
    });
  });
}

function setStarRatingUI(rating) {
  selectedStarRating = rating;
  const container = document.getElementById('star-rating-container');
  if (!container) return;
  const stars = container.querySelectorAll('span');
  stars.forEach(star => {
    const val = parseInt(star.getAttribute('data-star') || '0', 10);
    if (val <= rating) {
      star.style.color = '#F59E0B';
    } else {
      star.style.color = '#CBD5E1';
    }
  });
  markSectionEdit('review');
}

function markSectionSaved(section) {
  const btnMap = {
    weight: { id: 'bv-btn-save-weight' },
    ftir: { id: 'bv-btn-save-ftir' },
    gerber: { id: 'bv-btn-save-gerber' },
    report: { id: 'bv-btn-save-report' },
    review: { id: 'bv-btn-save-review' }
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
    report: { id: 'bv-btn-save-report', label: '💾 UPDATE REPORT' },
    review: { id: 'bv-btn-save-review', label: '💾 UPDATE REVIEW' }
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
  setupEditListener(['bv-review-text'], 'review');

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

  // 5. Save Review
  const btnSaveReview = document.getElementById('bv-btn-save-review');
  if (btnSaveReview) {
    btnSaveReview.addEventListener('click', async () => {
      if (btnSaveReview.dataset.saved === 'true') {
        markSectionEdit('review');
        document.getElementById('bv-review-text')?.focus();
        return;
      }

      if (!currentVisitData || !currentVisitData.id) {
        alert('No active visit loaded.');
        return;
      }
      const text = document.getElementById('bv-review-text')?.value.trim() || '';
      const rating = selectedStarRating || 5;

      try {
        const res = await apiSaveReviewRating(currentVisitData.id, {
          behaviour: rating,
          cooperation: rating,
          cleanliness: rating,
          infrastructure: rating,
          remarks: text
        });
        if (res && res.rating) {
          currentVisitData.bmc_ratings = [res.rating];
        }
        markSectionSaved('review');
      } catch (err) {
        alert(err.message || 'Failed to save review.');
      }
    });
  }
}

window.handleCloseBmcVisit = async function() {
  const closeBtns = document.querySelectorAll('#btn-header-back, .btn-close-visit, button[onclick="handleCloseBmcVisit()"]');
  closeBtns.forEach(btn => {
    btn.disabled = true;
    if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = '⌛ Closing BMC Visit...';
  });

  const tripId = getUrlParam('tripId') || currentTripId;
  const bmcId = getUrlParam('bmcId') || currentBmcId;
  const bmcCode = getUrlParam('bmcCode') || currentBmcCode;

  try {
    let targetVisitId = (currentVisitData && currentVisitData.id) ? currentVisitData.id : (currentVisitId && !currentVisitId.startsWith('virtual-') ? currentVisitId : null);

    if (!targetVisitId || targetVisitId.startsWith('virtual-')) {
      if (tripId) {
        const createRes = await workerFetch(`/api/trips/${tripId}/visits`, {
          method: 'POST',
          body: JSON.stringify({ bmc_id: bmcId || bmcCode || null, bmc_code: bmcCode || null })
        });
        if (createRes && createRes.visit) {
          targetVisitId = createRes.visit.id;
          currentVisitData = createRes.visit;
        }
      }
    }

    if (targetVisitId && !targetVisitId.startsWith('virtual-')) {
      const updateRes = await apiUpdateVisitWeight(targetVisitId, {
        status: 'completed',
        visit_end_time: new Date().toISOString()
      });
      if (updateRes && updateRes.visit) {
        currentVisitData = updateRes.visit;
      }
    } else {
      throw new Error('Could not resolve a valid BMC visit record to close.');
    }

    // Redirect to trip dashboard only AFTER database update succeeds
    window.location.href = tripId ? `dashboard.html?tripId=${tripId}` : 'dashboard.html';
  } catch (e) {
    console.error('Error closing BMC visit:', e);
    alert(e.message || 'Failed to close BMC visit. Please try again.');
    closeBtns.forEach(btn => {
      btn.disabled = false;
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    });
  }
};
