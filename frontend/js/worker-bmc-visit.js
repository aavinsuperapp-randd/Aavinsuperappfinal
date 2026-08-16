// worker-bmc-visit.js — BMC Visit & Quality Testing Logic

let visitId = null;
let currentVisit = null;

// Rating state (Single 1 to 5 overall rating)
let overallRating = 5;

// Requirements state (4 items with Available / Not Available)
const reqState = {
  acids: true,
  ftir_machine: true,
  seal_cutter: true,
  thermometer: true
};

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;

  setupMobileMenu();
  // NOTE: setupTabs() is called AFTER loadVisitData() so we know the visit type
  initStars();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  const params = new URLSearchParams(window.location.search);
  visitId = params.get('visit_id');

  if (!visitId) {
    showToast('No Visit ID specified.', 'error');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
    return;
  }

  await loadVisitData();

  document.getElementById('complete-visit-btn').addEventListener('click', completeBmcVisit);
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}

// All possible tab definitions in order
const ALL_TABS = [
  { navId: 'tab-nav-compartment', panelId: 'tab-compartment', label: 'Tanker Compartment' },
  { navId: 'tab-nav-ftir',        panelId: 'tab-ftir',        label: 'FTIR Test (Digital)' },
  { navId: 'tab-nav-gerber',      panelId: 'tab-gerber',      label: 'Gerber Test (Physical)' },
  { navId: 'tab-nav-requirements',panelId: 'tab-requirements',label: 'Requirements' },
  { navId: 'tab-nav-issues',      panelId: 'tab-issues',      label: 'Record Issues' },
  { navId: 'tab-nav-rating',      panelId: 'tab-rating',      label: 'Rate BMC' },
];

// Tabs shown for After Mixing visits (steps 1-3 only)
const AFTER_MIXING_TAB_IDS = ['tab-nav-compartment', 'tab-nav-ftir', 'tab-nav-gerber'];

let activeTabs = []; // the filtered list used by current visit

function setupTabs(isAfterMixing) {
  // Determine which tabs apply to this visit
  activeTabs = isAfterMixing
    ? ALL_TABS.filter(t => AFTER_MIXING_TAB_IDS.includes(t.navId))
    : ALL_TABS;

  // Show/hide nav buttons and panels, update step numbers
  ALL_TABS.forEach(tab => {
    const navBtn   = document.getElementById(tab.navId);
    const panel    = document.getElementById(tab.panelId);
    const isActive = activeTabs.some(t => t.navId === tab.navId);

    if (navBtn) navBtn.style.display = isActive ? '' : 'none';
    if (panel)  panel.style.display  = isActive ? '' : 'none';
  });

  // Re-number labels and wire click handlers on visible buttons only
  activeTabs.forEach((tab, idx) => {
    const navBtn = document.getElementById(tab.navId);
    if (!navBtn) return;
    navBtn.textContent = `${idx + 1}. ${tab.label}`;
    // Remove old listeners by cloning
    const fresh = navBtn.cloneNode(true);
    navBtn.parentNode.replaceChild(fresh, navBtn);
    fresh.addEventListener('click', () => switchTab(tab.panelId));
  });

  // Activate the first applicable tab
  switchTab(activeTabs[0].panelId);
}

function switchTab(targetPanelId) {
  // Deactivate all
  activeTabs.forEach(tab => {
    const btn   = document.getElementById(tab.navId);
    const panel = document.getElementById(tab.panelId);
    if (btn)   btn.classList.remove('active');
    if (panel) panel.classList.remove('active');
  });
  // Activate target
  const targetTab = activeTabs.find(t => t.panelId === targetPanelId);
  if (targetTab) {
    const btn   = document.getElementById(targetTab.navId);
    const panel = document.getElementById(targetTab.panelId);
    if (btn)   btn.classList.add('active');
    if (panel) panel.classList.add('active');
  }
}

async function loadVisitData() {
  toggleLoading(true);
  try {
    const res = await apiGetVisit(visitId);
    const visit = res ? res.visit : null;

    if (!visit) {
      showToast('Visit record not found.', 'error');
      return;
    }

    currentVisit = visit;
    document.getElementById('back-to-trip-link').href = `trip.html?id=${visit.trip_id}`;

    renderVisitHeader();
    populateData();

  } catch (err) {
    console.error('Error loading visit data:', err);
    showToast('Error loading visit data: ' + (err.message || 'Failed to fetch'), 'error');
  } finally {
    toggleLoading(false);
  }
}


let ftirImageBase64 = null;
let existingFtirImageUrl = null;

function renderVisitHeader() {
  const bmc = currentVisit.bmc || {};
  const isAfterMixing = currentVisit.is_after_mixing || (currentVisit.remarks && currentVisit.remarks.includes('[AFTER MIXING]'));
  const displayName = (bmc.name || 'BMC Unit') + (isAfterMixing ? ' (After Mixing)' : '');

  document.getElementById('bmc-display-name').textContent = displayName;
  document.getElementById('bmc-display-meta').textContent = `📍 ${bmc.location || ''}, ${bmc.district || ''} | Sequence #${currentVisit.visit_sequence}`;

  const badge = document.getElementById('visit-status-badge');
  if (currentVisit.status === 'completed') {
    badge.textContent = '✓ Completed';
    badge.className = 'status-pill pill-completed';
  } else if (currentVisit.status === 'in_progress') {
    badge.textContent = '● In Progress';
    badge.className = 'status-pill pill-active';
  } else {
    badge.textContent = '○ Pending';
    badge.className = 'status-pill pill-pending';
  }

  // Build the tab navigation dynamically based on visit type
  setupTabs(isAfterMixing);
}

function populateData() {
  // Compartment & Quantity (Kg)
  if (currentVisit.compartment) {
    selectCompartment(currentVisit.compartment);
  }
  if (currentVisit.milk_quantity_liters) {
    document.getElementById('milk-quantity').value = currentVisit.milk_quantity_liters;
  }

  // FTIR Test (Fat, SNF, Added Water, Temp, Remarks, Image)
  const ftir = Array.isArray(currentVisit.ftir_tests) ? currentVisit.ftir_tests[0] : currentVisit.ftir_tests;
  if (ftir) {
    if (ftir.fat !== undefined && ftir.fat !== null) document.getElementById('ftir-fat').value = ftir.fat;
    if (ftir.snf !== undefined && ftir.snf !== null) document.getElementById('ftir-snf').value = ftir.snf;
    if (ftir.water_percentage !== undefined && ftir.water_percentage !== null) document.getElementById('ftir-water').value = ftir.water_percentage;
    if (ftir.temperature !== undefined && ftir.temperature !== null) document.getElementById('ftir-temp').value = ftir.temperature;
    
    let cleanRemarks = ftir.remarks || '';
    let extractedImg = ftir.image_url;

    if (cleanRemarks.includes('[FTIR_IMAGE:')) {
      const match = cleanRemarks.match(/\[FTIR_IMAGE:\s*(.*?)\]/);
      if (match && match[1]) {
        extractedImg = extractedImg || match[1].trim();
        cleanRemarks = cleanRemarks.replace(/\[FTIR_IMAGE:\s*.*?\]/, '').trim();
      }
    }
    if (cleanRemarks) document.getElementById('ftir-remarks').value = cleanRemarks;

    if (extractedImg) {
      existingFtirImageUrl = extractedImg;
      const previewImg = document.getElementById('ftir-image-preview');
      const previewContainer = document.getElementById('ftir-image-preview-container');
      if (previewImg && previewContainer) {
        previewImg.src = extractedImg;
        previewContainer.classList.remove('hidden');
      }
    }

    if (ftir.overall_result) renderTestResultBadge('ftir-badge-container', ftir.overall_result);
  }

  // Gerber Test (Fat, CLR, SNF, Temp, Remarks)
  const gerber = Array.isArray(currentVisit.gerber_tests) ? currentVisit.gerber_tests[0] : currentVisit.gerber_tests;
  if (gerber) {
    if (gerber.fat_percentage !== undefined && gerber.fat_percentage !== null) document.getElementById('gerber-fat').value = gerber.fat_percentage;
    if (gerber.clr !== undefined && gerber.clr !== null) document.getElementById('gerber-clr').value = gerber.clr;
    if (gerber.snf !== undefined && gerber.snf !== null) document.getElementById('gerber-snf').value = gerber.snf;
    if (gerber.sample_temp !== undefined && gerber.sample_temp !== null) document.getElementById('gerber-temp').value = gerber.sample_temp;
    if (gerber.remarks) document.getElementById('gerber-remarks').value = gerber.remarks;
    if (gerber.overall_result) renderTestResultBadge('gerber-badge-container', gerber.overall_result);
  }

  // Requirements
  const req = Array.isArray(currentVisit.requirement_checks) ? currentVisit.requirement_checks[0] : currentVisit.requirement_checks;
  if (req) {
    reqState.acids = req.acid_available !== false;
    reqState.ftir_machine = req.ftir_machine_available !== false;
    reqState.seal_cutter = req.seal_cutter_available !== false;
    reqState.thermometer = req.power_backup_available !== false;
    if (req.remarks) document.getElementById('custom-requirements').value = req.remarks;
  }
  updateReqButtonsUI();

  // Issues
  renderIssuesList(currentVisit.bmc_issues || []);

  // Rating
  const r = Array.isArray(currentVisit.bmc_ratings) ? currentVisit.bmc_ratings[0] : currentVisit.bmc_ratings;
  if (r) {
    overallRating = r.behaviour || r.overall_rating || 5;
    if (r.remarks) document.getElementById('rating-remarks').value = r.remarks;
    updateStarDisplays();
  }
}

// ── Compartment Selection & Saving ──────────────────────────────────────
window.selectCompartment = function(comp) {
  const frontBtn = document.getElementById('comp-btn-front');
  const backBtn = document.getElementById('comp-btn-back');
  if (frontBtn) frontBtn.classList.remove('selected', 'active');
  if (backBtn) backBtn.classList.remove('selected', 'active');

  if (comp === 'front' && frontBtn) {
    frontBtn.classList.add('selected', 'active');
  } else if (comp === 'back' && backBtn) {
    backBtn.classList.add('selected', 'active');
  }
};

window.saveCompartment = async function() {
  const frontBtn = document.getElementById('comp-btn-front');
  const backBtn = document.getElementById('comp-btn-back');
  const isFront = frontBtn && frontBtn.classList.contains('selected');
  const isBack = backBtn && backBtn.classList.contains('selected');
  const qty = document.getElementById('milk-quantity').value;

  if (!isFront && !isBack) {
    showToast('Please select FRONT or BACK compartment.', 'error');
    return;
  }

  const compartment = isFront ? 'front' : 'back';

  try {
    await apiUpdateVisit(visitId, {
      compartment,
      milk_quantity_liters: qty ? parseFloat(qty) : null,
      status: 'in_progress'
    });
    showToast('Compartment & Quantity saved', 'success');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to update compartment', 'error');
  }
};

// ── FTIR Photo & Camera Stream Handlers ────────────────────────────────────
let cameraStream = null;

window.openGalleryPicker = function() {
  const galleryInput = document.getElementById('ftir-file-gallery');
  if (galleryInput) galleryInput.click();
};

window.openCameraCapture = async function() {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      const video = document.getElementById('camera-video');
      const modal = document.getElementById('camera-modal');
      if (video && modal) {
        video.srcObject = cameraStream;
        modal.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('Camera stream error, falling back to input capture:', err);
      showToast('Camera access permission denied or camera not available.', 'error');
      const cameraInput = document.getElementById('ftir-file-camera');
      if (cameraInput) cameraInput.click();
    }
  } else {
    const cameraInput = document.getElementById('ftir-file-camera');
    if (cameraInput) cameraInput.click();
  }
};

window.captureCameraPhoto = function() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  ftirImageBase64 = canvas.toDataURL('image/jpeg', 0.9);
  const previewImg = document.getElementById('ftir-image-preview');
  const previewContainer = document.getElementById('ftir-image-preview-container');
  if (previewImg && previewContainer) {
    previewImg.src = ftirImageBase64;
    previewContainer.classList.remove('hidden');
  }

  closeCameraModal();
};

window.closeCameraModal = function() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const modal = document.getElementById('camera-modal');
  if (modal) modal.classList.add('hidden');
};

window.handleFtirImageSelect = function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    ftirImageBase64 = e.target.result;
    const previewImg = document.getElementById('ftir-image-preview');
    const previewContainer = document.getElementById('ftir-image-preview-container');
    if (previewImg && previewContainer) {
      previewImg.src = ftirImageBase64;
      previewContainer.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
};

window.removeFtirImagePreview = function() {
  ftirImageBase64 = null;
  existingFtirImageUrl = null;
  const previewImg = document.getElementById('ftir-image-preview');
  const previewContainer = document.getElementById('ftir-image-preview-container');
  if (previewImg) previewImg.src = '';
  if (previewContainer) previewContainer.classList.add('hidden');

  const galleryInput = document.getElementById('ftir-file-gallery');
  const cameraInput = document.getElementById('ftir-file-camera');
  if (galleryInput) galleryInput.value = '';
  if (cameraInput) cameraInput.value = '';
};


// ── FTIR Test Save ────────────────────────────────────────────────────────
window.saveFtirTest = async function() {
  const fat = parseFloat(document.getElementById('ftir-fat').value) || null;
  const snf = parseFloat(document.getElementById('ftir-snf').value) || null;
  const water_percentage = parseFloat(document.getElementById('ftir-water').value) || 0;
  const temperature = parseFloat(document.getElementById('ftir-temp').value) || null;
  const remarks = document.getElementById('ftir-remarks').value;

  if (!fat || !snf) {
    showToast('Fat % and SNF % are required for FTIR Test.', 'error');
    return;
  }

  if (!ftirImageBase64 && !existingFtirImageUrl) {
    showToast('FTIR test photo/image is mandatory. Please capture or upload an image.', 'error');
    return;
  }

  let finalImageUrl = existingFtirImageUrl;

  try {
    toggleLoading(true);

    if (ftirImageBase64) {
      try {
        const uploadRes = await workerFetch('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ imageBase64: ftirImageBase64, filename: `ftir-${visitId}.jpg` })
        });
        if (uploadRes && uploadRes.publicUrl) {
          finalImageUrl = uploadRes.publicUrl;
        } else {
          finalImageUrl = ftirImageBase64;
        }
      } catch (uploadErr) {
        console.warn('Image upload endpoint fallback to base64:', uploadErr);
        finalImageUrl = ftirImageBase64;
      }
    }

    const res = await apiSaveFtir(visitId, {
      fat, snf, water_percentage, temperature, remarks, image_url: finalImageUrl
    });

    renderTestResultBadge('ftir-badge-container', res.ftir ? res.ftir.overall_result : 'pass');
    showToast('FTIR test saved successfully!', 'success');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to save FTIR test', 'error');
  } finally {
    toggleLoading(false);
  }
};

// ── Gerber Test Save ──────────────────────────────────────────────────────
window.saveGerberTest = async function() {
  const fat_percentage = parseFloat(document.getElementById('gerber-fat').value) || null;
  const clr = parseFloat(document.getElementById('gerber-clr').value) || null;
  const snf = parseFloat(document.getElementById('gerber-snf').value) || null;
  const sample_temp = parseFloat(document.getElementById('gerber-temp').value) || null;
  const remarks = document.getElementById('gerber-remarks').value;

  if (!fat_percentage) {
    showToast('Fat % is required for Gerber Test.', 'error');
    return;
  }

  try {
    const res = await apiSaveGerber(visitId, {
      fat_percentage, clr, snf, sample_temp, remarks
    });
    renderTestResultBadge('gerber-badge-container', res.gerber.overall_result);
    showToast('Saved', 'success');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to save Gerber test', 'error');
  }
};

function renderTestResultBadge(containerId, result) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (result === 'pass') {
    c.innerHTML = '<span class="result-badge result-pass">✓ PASS</span>';
  } else if (result === 'warning') {
    c.innerHTML = '<span class="result-badge result-warning">⚠️ WARNING</span>';
  } else if (result === 'fail') {
    c.innerHTML = '<span class="result-badge result-fail">❌ FAIL</span>';
  }
}

// ── Requirements Checklist ────────────────────────────────────────────────
window.setRequirementItem = function(key, boolVal) {
  reqState[key] = boolVal;
  updateReqButtonsUI();
};

function updateReqButtonsUI() {
  const map = [
    { key: 'acids', yes: 'acids-yes', no: 'acids-no' },
    { key: 'ftir_machine', yes: 'ftir-yes', no: 'ftir-no' },
    { key: 'seal_cutter', yes: 'seal-yes', no: 'seal-no' },
    { key: 'thermometer', yes: 'thermo-yes', no: 'thermo-no' }
  ];

  map.forEach(m => {
    const yBtn = document.getElementById(m.yes);
    const nBtn = document.getElementById(m.no);
    if (!yBtn || !nBtn) return;
    if (reqState[m.key]) {
      yBtn.className = 'check-toggle-btn selected-yes';
      nBtn.className = 'check-toggle-btn';
    } else {
      yBtn.className = 'check-toggle-btn';
      nBtn.className = 'check-toggle-btn selected-no';
    }
  });
}

window.saveRequirements = async function() {
  const customItems = document.getElementById('custom-requirements').value.trim();
  try {
    await apiSaveRequirements(visitId, {
      acid_available: reqState.acids,
      ftir_machine_available: reqState.ftir_machine,
      seal_cutter_available: reqState.seal_cutter,
      power_backup_available: reqState.thermometer,
      remarks: customItems || null
    });
    showToast('Requirements saved successfully', 'success');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to save requirements', 'error');
  }
};

// ── Issues ────────────────────────────────────────────────────────────────
window.addBmcIssue = async function() {
  const category = document.getElementById('issue-category').value;
  const severity = document.getElementById('issue-severity').value;
  const description = document.getElementById('issue-description').value.trim();
  const image_url = document.getElementById('issue-image').value.trim();

  if (!description) {
    showToast('Please enter an issue description.', 'error');
    return;
  }

  try {
    await apiAddIssue(visitId, {
      category,
      severity,
      description,
      image_url: image_url || null
    });
    showToast('Issue saved successfully', 'success');
    document.getElementById('issue-description').value = '';
    document.getElementById('issue-image').value = '';
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to add issue', 'error');
  }
};

function renderIssuesList(issues = []) {
  const container = document.getElementById('issues-list-container');
  if (issues.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No issues recorded for this visit.</div></div>';
    return;
  }

  container.innerHTML = issues.map(iss => `
    <div class="issue-card">
      <div class="issue-card-body">
        <div class="issue-card-category">${esc(iss.category).toUpperCase()} — <span class="severity-${iss.severity}">${esc(iss.severity.toUpperCase())}</span></div>
        <div class="issue-card-desc">${esc(iss.description)}</div>
        ${iss.image_url ? `<div class="mt-1"><a href="${esc(iss.image_url)}" target="_blank" class="text-sm">📷 View Attachment</a></div>` : ''}
      </div>
      <button class="btn btn-outline btn-sm" onclick="removeIssue('${iss.id}')">🗑️</button>
    </div>
  `).join('');
}

window.removeIssue = async function(issueId) {
  if (!confirm('Are you sure you want to delete this issue record?')) return;
  try {
    await apiDeleteIssue(issueId);
    showToast('Issue deleted', 'info');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to delete issue', 'error');
  }
};

// ── Rating Stars (Single 1 to 5 Rating) ──────────────────────────────────
function initStars() {
  const container = document.getElementById('stars-overall');
  if (!container) return;
  container.innerHTML = [1, 2, 3, 4, 5].map(star => `
    <button type="button" class="star-btn ${star <= overallRating ? 'active' : ''}" onclick="setRatingStar(${star})">⭐</button>
  `).join('');
}

window.setRatingStar = function(val) {
  overallRating = val;
  updateStarDisplays();
};

function updateStarDisplays() {
  const container = document.getElementById('stars-overall');
  if (!container) return;
  const btns = container.querySelectorAll('.star-btn');
  btns.forEach((b, idx) => {
    if (idx + 1 <= overallRating) {
      b.classList.add('active');
      b.style.opacity = '1';
    } else {
      b.classList.remove('active');
      b.style.opacity = '0.3';
    }
  });
}

window.saveBmcRating = async function() {
  const remarks = document.getElementById('rating-remarks').value;
  try {
    await apiSaveRating(visitId, {
      behaviour: overallRating,
      cooperation: overallRating,
      cleanliness: overallRating,
      infrastructure: overallRating,
      remarks
    });
    showToast('BMC rating saved successfully!', 'success');
    await loadVisitData();
  } catch (err) {
    showToast(err.message || 'Failed to save rating', 'error');
  }
};


// ── Complete Visit ────────────────────────────────────────────────────────
async function completeBmcVisit() {
  try {
    showToast('Finalizing visit...', 'info');
    await apiUpdateVisit(visitId, {
      status: 'completed',
      visit_end_time: new Date().toISOString()
    });
    showToast('BMC Visit Completed & Saved!', 'success');
    setTimeout(() => {
      window.location.href = `trip.html?id=${currentVisit.trip_id}`;
    }, 600);
  } catch (err) {
    showToast(err.message || 'Failed to complete visit.', 'error');
  }
}

window.deleteThisVisit = async function() {
  const bmcName = currentVisit && currentVisit.bmc ? currentVisit.bmc.name : 'this BMC';
  if (!confirm(`Are you sure you want to delete the visit record for "${bmcName}"?`)) return;
  try {
    showToast('Deleting BMC visit record...', 'info');
    await apiDeleteVisit(visitId);
    showToast('BMC visit deleted successfully!', 'success');
    setTimeout(() => {
      window.location.href = `trip.html?id=${currentVisit.trip_id}`;
    }, 600);
  } catch (err) {
    showToast(err.message || 'Failed to delete BMC visit.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


