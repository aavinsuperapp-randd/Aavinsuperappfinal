// qc-worker-test.js — QC Laboratory Testing Form Logic

let currentVisitId = null;
let currentSample = null;
let currentQcTestId = null;

// Safe DOM Helper Functions
function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setElValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}

function getElValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  const mainContent = document.getElementById('main-qc-content');
  if (mainContent) mainContent.classList.remove('hidden');

  setElText('qc-header-name', profile.name);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const params = new URLSearchParams(window.location.search);
  currentVisitId = params.get('visit_id');

  if (!currentVisitId) {
    showToast('No sample visit specified.', 'error');
    setTimeout(() => window.location.href = 'samples.html', 1200);
    return;
  }

  await loadSampleDetails();

  // Form submit (save & submit test)
  const testForm = document.getElementById('qc-test-form');
  if (testForm) testForm.addEventListener('submit', handleSubmitTest);
});

async function loadSampleDetails() {
  try {
    const res = await apiQcGetSampleDetail(currentVisitId);
    currentSample = res.sample;

    renderSampleInfo();
    renderBmcTestResult();
    populateQcForm();
  } catch (err) {
    console.error('Error loading sample detail:', err);
    showToast(err.message || 'Failed to load sample details.', 'error');
  }
}

function renderSampleInfo() {
  const s = currentSample;
  if (!s) return;

  const sampleId = `SMP-${s.id.slice(0, 6).toUpperCase()}`;
  setElText('info-sample-id', sampleId);
  setElText('info-bmc-name', s.bmc ? s.bmc.name : 'N/A');
  setElText('info-bmc-loc', s.bmc ? `${s.bmc.location}, ${s.bmc.district}` : 'N/A');
  setElText('info-worker-name', s.trip && s.trip.worker ? s.trip.worker.name : '-');
  setElText('info-trip-no', s.trip ? (s.trip.trip_number || s.trip.trip_name) : 'N/A');
  setElText('info-coll-time', s.visit_end_time ? new Date(s.visit_end_time).toLocaleString() : 'N/A');
  setElText('info-compartment', s.compartment ? s.compartment.toUpperCase() : 'N/A');
  setElText('info-tanker', s.trip ? (s.trip.tanker_number || '-') : '-');

  const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
  let qtyVal = s.milk_quantity_kg || s.in_weight || (s.milk_quantity_liters ? `${s.milk_quantity_liters} L` : null);
  if (qcTest) {
    let savedQty = qcTest.quantity || qcTest.quantity_kg || qcTest.sample_kg || qcTest.sample_liters;
    if (!savedQty && qcTest.additional_observations) {
      const match = qcTest.additional_observations.match(/\[QTY_KG:\s*([\d.]+)]/);
      if (match) savedQty = match[1];
    }
    if (savedQty) qtyVal = savedQty;
  }
  setElText('info-quantity', qtyVal ? `${qtyVal} KG` : 'Not Specified');
}

function renderBmcTestResult() {
  const s = currentSample;
  if (!s) return;

  const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
  const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;

  const container = document.getElementById('bmc-test-result-display');
  if (!container) return;

  if (!ftir && !gerber) {
    container.innerHTML = `<div class="text-sm text-muted" style="font-weight:600; color:#64748B;">No Spot Analyzer values recorded for this visit.</div>`;
    return;
  }

  let html = '';

  if (gerber) {
    html += `
      <div style="margin-bottom: 16px;">
        <h4 style="font-size: 0.9rem; color: #1E40AF; margin-bottom: 8px;">Gerber Test Results</h4>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:12px; font-size:0.83rem;">
          <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Fat %</div>
            <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${gerber.fat_percentage ?? 'N/A'}%</div>
          </div>
          <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">SNF %</div>
            <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${gerber.snf ?? 'N/A'}%</div>
          </div>
          <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">CLR</div>
            <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${gerber.clr ?? 'N/A'}</div>
          </div>
        </div>
      </div>
    `;
  }

  if (ftir) {
    html += `
      <div>
        <h4 style="font-size: 0.9rem; color: #1E40AF; margin-bottom: 8px;">FTIR Test Results</h4>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:12px; font-size:0.83rem;">
          <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Fat %</div>
            <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${ftir.fat ?? 'N/A'}%</div>
          </div>
          <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">SNF %</div>
            <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${ftir.snf ?? 'N/A'}%</div>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function populateQcForm() {
  const s = currentSample;
  if (!s) return;

  const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
  if (qcTest) {
    currentQcTestId = qcTest.id;
    setElValue('qc-fat', qcTest.fat);
    setElValue('qc-snf', qcTest.snf);
    setElValue('qc-temp', qcTest.temperature);
    setElValue('qc-condition', qcTest.sample_condition || 'good');
    setElValue('qc-remarks', qcTest.remarks);

    let savedQty = qcTest.quantity || qcTest.quantity_kg || qcTest.sample_kg || qcTest.sample_liters || '';
    if (!savedQty && qcTest.additional_observations) {
      const match = qcTest.additional_observations.match(/\[QTY_KG:\s*([\d.]+)]/);
      if (match) savedQty = match[1];
    }
    if (!savedQty && s.milk_quantity_kg) savedQty = s.milk_quantity_kg;
    setElValue('qc-quantity', savedQty);

    if (qcTest.created_at || qcTest.received_at) {
      const recTime = qcTest.received_at || qcTest.created_at;
      setElValue('qc-received-time', new Date(recTime).toISOString().slice(0, 16));
    }

    // Show status indicator
    const statusBox = document.getElementById('qc-test-status-banner');
    if (statusBox) {
      if (qcTest.status === 'submitted' || qcTest.status === 'approved') {
        statusBox.className = 'status-box status-approved mt-2 mb-3';
        statusBox.innerHTML = `<strong>Status: ${qcTest.status.toUpperCase()}</strong> — Report has been finalized and submitted to QC AGM.`;
        if (qcTest.status === 'approved') {
          disableFormInputs();
        }
      } else if (qcTest.status === 'returned') {
        statusBox.className = 'status-box status-rejected mt-2 mb-3';
        statusBox.innerHTML = `<strong>Returned for Correction by QC AGM</strong> — Reason: "${qcTest.remarks || 'Verification requested.'}"`;
      }
    }
  } else {
    // Auto fill sample received time to current time and milk quantity if present
    const nowIso = new Date().toISOString().slice(0, 16);
    setElValue('qc-received-time', nowIso);
    setElValue('qc-quantity', s.milk_quantity_kg || s.in_weight || '');
  }
}

function disableFormInputs() {
  document.querySelectorAll('#qc-test-form input, #qc-test-form select, #qc-test-form textarea').forEach(el => {
    el.disabled = true;
  });
  const saveBtn = document.getElementById('btn-save-draft');
  if (saveBtn) saveBtn.style.display = 'none';
  const submitBtn = document.getElementById('btn-submit-report');
  if (submitBtn) submitBtn.style.display = 'none';
}

async function handleSubmitTest(e) {
  if (e) e.preventDefault();

  const fat = getElValue('qc-fat');
  const snf = getElValue('qc-snf');
  const temp = getElValue('qc-temp');
  const qtyInput = getElValue('qc-quantity');

  if (!fat || !snf) {
    showToast('Fat % and SNF % are required parameters.', 'error');
    return;
  }

  const payload = {
    visit_id: currentVisitId,
    sample_condition: getElValue('qc-condition') || 'good',
    fat,
    snf,
    temperature: temp,
    quantity: qtyInput !== '' && qtyInput !== null ? parseFloat(qtyInput) : null,
    quantity_kg: qtyInput !== '' && qtyInput !== null ? parseFloat(qtyInput) : null,
    sample_kg: qtyInput !== '' && qtyInput !== null ? parseFloat(qtyInput) : null,
    sample_liters: qtyInput !== '' && qtyInput !== null ? parseFloat(qtyInput) : null,
    milk_quantity_kg: qtyInput !== '' && qtyInput !== null ? parseFloat(qtyInput) : null,
    remarks: getElValue('qc-remarks'),
    status: 'submitted'
  };

  try {
    showToast('Submitting test values...', 'info');
    const res = await apiQcSaveTest(payload);
    if (res.test && res.test.id) {
      currentQcTestId = res.test.id;
      try {
        await apiQcSubmitTest(currentQcTestId);
      } catch (subErr) {
        console.warn('Notice on submit test call:', subErr);
      }
    }
    showToast('QC test values submitted successfully!', 'success');
    setTimeout(() => window.location.href = 'samples.html', 1000);
  } catch (err) {
    console.error('Error submitting QC test values:', err);
    showToast(err.message || 'Failed to submit test values.', 'error');
  }
}

async function handleOpenConfirmModal() {
  // First save draft
  const fat = getElValue('qc-fat');
  const snf = getElValue('qc-snf');

  if (!fat || !snf) {
    showToast('Please enter required parameters (Fat % and SNF %) before submitting.', 'error');
    return;
  }

  await handleSaveDraft();

  if (!currentQcTestId) {
    showToast('Failed to prepare test report.', 'error');
    return;
  }

  // Populate Summary Modal
  const s = currentSample;
  const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
  const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;
  const bmcFat = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
  const bmcSnf = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';

  const qcFat = getElValue('qc-fat');
  const qcSnf = getElValue('qc-snf');

  let diffFat = 'N/A';
  let diffSnf = 'N/A';
  if (bmcFat !== 'N/A' && qcFat) diffFat = (parseFloat(qcFat) - parseFloat(bmcFat)).toFixed(2);
  if (bmcSnf !== 'N/A' && qcSnf) diffSnf = (parseFloat(qcSnf) - parseFloat(bmcSnf)).toFixed(2);

  setElText('sum-sample-id', `SMP-${s.id.slice(0, 6).toUpperCase()}`);
  setElText('sum-bmc-name', s.bmc ? s.bmc.name : 'N/A');
  setElText('sum-bmc-fat', `${bmcFat}%`);
  setElText('sum-qc-fat', `${qcFat}%`);
  setElText('sum-diff-fat', `${diffFat > 0 ? '+' : ''}${diffFat}%`);

  setElText('sum-bmc-snf', `${bmcSnf}%`);
  setElText('sum-qc-snf', `${qcSnf}%`);
  setElText('sum-diff-snf', `${diffSnf > 0 ? '+' : ''}${diffSnf}%`);

  // Open modal
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('hidden');
}

async function handleFinalSubmit() {
  if (!currentQcTestId) return;
  try {
    showToast('Submitting final report to QC AGM...', 'info');
    await apiQcSubmitTest(currentQcTestId);
    showToast('QC Test Report submitted successfully!', 'success');
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    setTimeout(() => window.location.href = 'samples.html', 1000);
  } catch (err) {
    console.error('Error submitting report:', err);
    showToast(err.message || 'Failed to submit report.', 'error');
  }
}

