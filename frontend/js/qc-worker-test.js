// qc-worker-test.js — QC Laboratory Testing Form Logic

let currentVisitId = null;
let currentSample = null;
let currentQcTestId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  const params = new URLSearchParams(window.location.search);
  currentVisitId = params.get('visit_id');

  if (!currentVisitId) {
    showToast('No sample visit specified.', 'error');
    setTimeout(() => window.location.href = 'samples.html', 1200);
    return;
  }

  await loadSampleDetails();

  // Form submit (save draft)
  document.getElementById('qc-test-form').addEventListener('submit', handleSaveDraft);
  // Submit final report button
  document.getElementById('btn-submit-report').addEventListener('click', handleOpenConfirmModal);
  // Confirm submission inside modal
  document.getElementById('btn-confirm-submit').addEventListener('click', handleFinalSubmit);
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
  document.getElementById('info-sample-id').textContent = sampleId;
  document.getElementById('info-bmc-name').textContent = s.bmc ? s.bmc.name : 'N/A';
  document.getElementById('info-bmc-loc').textContent = s.bmc ? `${s.bmc.location}, ${s.bmc.district}` : 'N/A';
  document.getElementById('info-worker-name').textContent = s.trip && s.trip.worker ? s.trip.worker.name : 'Field Worker';
  document.getElementById('info-trip-no').textContent = s.trip ? (s.trip.trip_number || s.trip.trip_name) : 'N/A';
  document.getElementById('info-coll-time').textContent = s.visit_end_time ? new Date(s.visit_end_time).toLocaleString() : 'N/A';
  document.getElementById('info-compartment').textContent = s.compartment ? s.compartment.toUpperCase() : 'N/A';
  document.getElementById('info-tanker').textContent = s.trip ? (s.trip.tanker_number || 'N/A') : 'N/A';
}

function renderBmcTestResult() {
  const s = currentSample;
  if (!s) return;

  const ftir = Array.isArray(s.ftir_tests) ? s.ftir_tests[0] : s.ftir_tests;
  const gerber = Array.isArray(s.gerber_tests) ? s.gerber_tests[0] : s.gerber_tests;

  const container = document.getElementById('bmc-test-result-display');
  if (!ftir && !gerber) {
    container.innerHTML = `<div class="text-sm text-muted">No Field Worker BMC test record recorded for this visit.</div>`;
    return;
  }

  let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:12px; font-size:0.83rem;">`;

  const fatVal = (ftir && ftir.fat) ?? (gerber && gerber.fat_percentage) ?? 'N/A';
  const snfVal = (ftir && ftir.snf) ?? (gerber && gerber.snf) ?? 'N/A';
  const clrVal = (gerber && gerber.clr) ?? 'N/A';
  const tempVal = (ftir && ftir.temperature) ?? (gerber && gerber.sample_temp) ?? 'N/A';
  const proteinVal = (ftir && ftir.protein) ?? 'N/A';
  const lactoseVal = (ftir && ftir.lactose) ?? 'N/A';
  const waterVal = (ftir && ftir.water_percentage) ?? 'N/A';

  html += `
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Fat %</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${fatVal}%</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">SNF %</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${snfVal}%</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">CLR</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${clrVal}</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Temp (°C)</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${tempVal}°C</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Protein %</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${proteinVal}%</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Lactose %</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${lactoseVal}%</div>
    </div>
    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
      <div style="font-size:0.7rem; color:#64748B; font-weight:700; text-transform:uppercase;">Water %</div>
      <div style="font-size:1.1rem; font-weight:800; color:#1D4ED8;">${waterVal}%</div>
    </div>
  `;
  html += `</div>`;
  container.innerHTML = html;
}

function populateQcForm() {
  const s = currentSample;
  if (!s) return;

  const qcTest = Array.isArray(s.qc_test) ? s.qc_test[0] : s.qc_test;
  if (qcTest) {
    currentQcTestId = qcTest.id;
    document.getElementById('qc-fat').value = qcTest.fat ?? '';
    document.getElementById('qc-snf').value = qcTest.snf ?? '';
    document.getElementById('qc-clr').value = qcTest.clr ?? '';
    document.getElementById('qc-temp').value = qcTest.temperature ?? '';
    document.getElementById('qc-acidity').value = qcTest.acidity ?? '';
    document.getElementById('qc-protein').value = qcTest.protein ?? '';
    document.getElementById('qc-lactose').value = qcTest.lactose ?? '';
    document.getElementById('qc-density').value = qcTest.density ?? '';
    document.getElementById('qc-water').value = qcTest.water_percentage ?? '';
    document.getElementById('qc-condition').value = qcTest.sample_condition || 'good';
    document.getElementById('qc-equipment').value = qcTest.equipment_used || '';
    document.getElementById('qc-instrument-id').value = qcTest.instrument_id || '';
    document.getElementById('qc-overall-result').value = qcTest.overall_result || 'pass';
    document.getElementById('qc-remarks').value = qcTest.remarks || '';
    document.getElementById('qc-observations').value = qcTest.additional_observations || '';

    // Show status indicator
    const statusBox = document.getElementById('qc-test-status-banner');
    if (statusBox) {
      if (qcTest.status === 'submitted' || qcTest.status === 'approved') {
        statusBox.className = 'status-box status-approved mt-2 mb-3';
        statusBox.innerHTML = `<strong>Status: ${qcTest.status.toUpperCase()}</strong> — Report has been finalized and submitted to QC AGM.`;
        // Disable form editing if already approved
        if (qcTest.status === 'approved') {
          disableFormInputs();
        }
      } else if (qcTest.status === 'returned') {
        statusBox.className = 'status-box status-rejected mt-2 mb-3';
        statusBox.innerHTML = `<strong>Returned for Correction by QC AGM</strong> — Reason: "${qcTest.remarks || 'Verification requested.'}"`;
      }
    }
  } else {
    // Auto fill sample received time to current time
    const nowIso = new Date().toISOString().slice(0, 16);
    document.getElementById('qc-received-time').value = nowIso;
  }
}

function disableFormInputs() {
  document.querySelectorAll('#qc-test-form input, #qc-test-form select, #qc-test-form textarea').forEach(el => {
    el.disabled = true;
  });
  document.getElementById('btn-save-draft').style.display = 'none';
  document.getElementById('btn-submit-report').style.display = 'none';
}

async function handleSaveDraft(e) {
  if (e) e.preventDefault();

  const fat = document.getElementById('qc-fat').value;
  const snf = document.getElementById('qc-snf').value;
  const clr = document.getElementById('qc-clr').value;
  const temp = document.getElementById('qc-temp').value;

  if (!fat || !snf) {
    showToast('Fat % and SNF % are required parameters.', 'error');
    return;
  }

  const payload = {
    visit_id: currentVisitId,
    sample_condition: document.getElementById('qc-condition').value,
    fat,
    snf,
    clr,
    temperature: temp,
    acidity: document.getElementById('qc-acidity').value,
    protein: document.getElementById('qc-protein').value,
    lactose: document.getElementById('qc-lactose').value,
    density: document.getElementById('qc-density').value,
    water_percentage: document.getElementById('qc-water').value,
    equipment_used: document.getElementById('qc-equipment').value,
    instrument_id: document.getElementById('qc-instrument-id').value,
    overall_result: document.getElementById('qc-overall-result').value,
    remarks: document.getElementById('qc-remarks').value,
    additional_observations: document.getElementById('qc-observations').value
  };

  try {
    showToast('Saving draft...', 'info');
    const res = await apiQcSaveTest(payload);
    currentQcTestId = res.test.id;
    showToast('Draft test results saved successfully!', 'success');
  } catch (err) {
    console.error('Error saving QC test draft:', err);
    showToast(err.message || 'Failed to save test results.', 'error');
  }
}

async function handleOpenConfirmModal() {
  // First save draft
  const fat = document.getElementById('qc-fat').value;
  const snf = document.getElementById('qc-snf').value;

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

  const qcFat = document.getElementById('qc-fat').value;
  const qcSnf = document.getElementById('qc-snf').value;

  let diffFat = 'N/A';
  let diffSnf = 'N/A';
  if (bmcFat !== 'N/A' && qcFat) diffFat = (parseFloat(qcFat) - parseFloat(bmcFat)).toFixed(2);
  if (bmcSnf !== 'N/A' && qcSnf) diffSnf = (parseFloat(qcSnf) - parseFloat(bmcSnf)).toFixed(2);

  document.getElementById('sum-sample-id').textContent = `SMP-${s.id.slice(0, 6).toUpperCase()}`;
  document.getElementById('sum-bmc-name').textContent = s.bmc ? s.bmc.name : 'N/A';
  document.getElementById('sum-bmc-fat').textContent = `${bmcFat}%`;
  document.getElementById('sum-qc-fat').textContent = `${qcFat}%`;
  document.getElementById('sum-diff-fat').textContent = `${diffFat > 0 ? '+' : ''}${diffFat}%`;

  document.getElementById('sum-bmc-snf').textContent = `${bmcSnf}%`;
  document.getElementById('sum-qc-snf').textContent = `${qcSnf}%`;
  document.getElementById('sum-diff-snf').textContent = `${diffSnf > 0 ? '+' : ''}${diffSnf}%`;

  // Open modal
  document.getElementById('confirm-modal').classList.remove('hidden');
}

async function handleFinalSubmit() {
  if (!currentQcTestId) return;
  try {
    showToast('Submitting final report to QC AGM...', 'info');
    await apiQcSubmitTest(currentQcTestId);
    showToast('QC Test Report submitted successfully!', 'success');
    document.getElementById('confirm-modal').classList.add('hidden');
    setTimeout(() => window.location.href = 'samples.html', 1000);
  } catch (err) {
    console.error('Error submitting report:', err);
    showToast(err.message || 'Failed to submit report.', 'error');
  }
}
