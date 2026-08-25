// qc-agm-excel.js — MACS Reading Excel Data Import & Preview logic

let parsedMacsReadings = [];
let bmcMasterList = [];
let fileInfo = { name: '', size: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadBmcMaster();
  setupDropZone();
  await loadImportHistory();
});

async function loadBmcMaster() {
  try {
    const res = await apiQcAgmGetBmcs();
    bmcMasterList = res.bmcs || [];
  } catch (err) {
    console.error('Error loading BMC master list:', err);
  }
}

function setupDropZone() {
  const dropZone = document.getElementById('excel-drop-zone');
  const fileInput = document.getElementById('excel-file-input');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFileSelected(e.target.files[0]);
    }
  });

  document.getElementById('btn-confirm-import').addEventListener('click', handleExecuteImport);
  document.getElementById('btn-reset-import').addEventListener('click', resetImportState);
}

function handleFileSelected(file) {
  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    showToast('Invalid file format. Please upload an Excel file (.xlsx or .xls).', 'error');
    return;
  }

  fileInfo.name = file.name;
  fileInfo.size = file.size;

  showToast('Reading MACS Excel spreadsheet...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (rawRows.length === 0) {
        showToast('The uploaded Excel file contains no data rows.', 'error');
        return;
      }

      const { detectedDates, parsedReadings } = parseMacsExcel(rawRows);
      parsedMacsReadings = parsedReadings;

      if (parsedMacsReadings.length === 0) {
        showToast('No valid MACS readings could be extracted from this spreadsheet.', 'error');
        return;
      }

      showToast(`MACS Report parsed successfully (${parsedMacsReadings.length} readings across ${detectedDates.length} date(s)).`, 'success');

      generatePreviewTable(detectedDates);
      document.getElementById('import-step-preview').classList.remove('hidden');
      document.getElementById('excel-drop-zone-card').classList.add('hidden');
    } catch (err) {
      console.error('Error parsing MACS Excel file:', err);
      showToast(err.message || 'Failed to parse MACS Excel file.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseDateToIso(str) {
  if (!str) return null;
  const s = String(str).trim();
  
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const d = m1[1].padStart(2, '0');
    const m = m1[2].padStart(2, '0');
    const y = m1[3];
    return `${y}-${m}-${d}`;
  }

  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m2) {
    const y = m2[1];
    const m = m2[2].padStart(2, '0');
    const d = m2[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function parseNumericCell(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseMacsExcel(rows) {
  let codeColIdx = -1;
  let nameColIdx = -1;
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim().toLowerCase();
      if (cellVal === 'code' || cellVal === 'bmc code' || cellVal === 'bmc_code') {
        codeColIdx = c;
        headerRowIdx = r;
      }
      if (cellVal.includes('bmc') && (cellVal.includes('name') || cellVal.includes('cc'))) {
        nameColIdx = c;
      }
    }
    if (codeColIdx !== -1 && nameColIdx !== -1) break;
  }

  if (codeColIdx === -1 || nameColIdx === -1) {
    throw new Error("Could not locate 'Code' and 'BMC/CC Name' header columns in Excel spreadsheet.");
  }

  const headerRow = rows[headerRowIdx];
  const subHeaderRow = rows[headerRowIdx + 1] || [];

  const dateGroups = {};

  for (let c = 0; c < headerRow.length; c++) {
    const rawVal = String(headerRow[c] || '').trim();
    if (!rawVal) continue;

    const parsedDate = parseDateToIso(rawVal);
    if (parsedDate) {
      if (!dateGroups[parsedDate]) {
        dateGroups[parsedDate] = [];
      }
      
      let fatCol = -1;
      let snfCol = -1;

      for (let sc = c; sc < Math.min(c + 8, headerRow.length); sc++) {
        const subHeaderVal = String(subHeaderRow[sc] || '').trim().toUpperCase();
        if (subHeaderVal === 'FAT' || subHeaderVal === 'FAT %') fatCol = sc;
        if (subHeaderVal === 'SNF' || subHeaderVal === 'SNF %') snfCol = sc;
      }

      dateGroups[parsedDate].push({
        startCol: c,
        fatCol: fatCol !== -1 ? fatCol : c + 3,
        snfCol: snfCol !== -1 ? snfCol : c + 4
      });
    }
  }

  const detectedDates = Object.keys(dateGroups);
  if (detectedDates.length === 0) {
    throw new Error("No valid Date headers (e.g. 24/08/2026) found in the Excel spreadsheet.");
  }

  const parsedReadings = [];
  const startDataRowIdx = headerRowIdx + 2;

  for (let r = startDataRowIdx; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const rawCode = String(row[codeColIdx] || '').trim();
    const rawName = String(row[nameColIdx] || '').trim();

    if (!rawCode || rawCode.toLowerCase().includes('total') || rawCode.toLowerCase().includes('s.no')) {
      continue;
    }

    detectedDates.forEach(dateIso => {
      const blocks = dateGroups[dateIso];
      
      // Block 0 = Worker MACS Reading
      if (blocks[0]) {
        parsedReadings.push({
          bmc_code: rawCode,
          bmc_name: rawName,
          reading_date: dateIso,
          source: 'worker',
          fat: parseNumericCell(row[blocks[0].fatCol]),
          snf: parseNumericCell(row[blocks[0].snfCol])
        });
      }

      // Block 1 = QC MACS Reading
      if (blocks[1]) {
        parsedReadings.push({
          bmc_code: rawCode,
          bmc_name: rawName,
          reading_date: dateIso,
          source: 'qc',
          fat: parseNumericCell(row[blocks[1].fatCol]),
          snf: parseNumericCell(row[blocks[1].snfCol])
        });
      }
    });
  }

  return { detectedDates, parsedReadings };
}

function generatePreviewTable(detectedDates) {
  // Map BMC Code to master check
  const validBmcCodes = new Set(bmcMasterList.map(b => String(b.bmc_code || '').trim()));
  const validBmcNames = new Set(bmcMasterList.map(b => String(b.name || '').toLowerCase().trim()));

  // Pair by BMC Code + Date
  const pairedMap = {};
  let validCount = 0;
  let invalidCount = 0;

  parsedMacsReadings.forEach(r => {
    const key = `${r.bmc_code}_${r.reading_date}`;
    if (!pairedMap[key]) {
      pairedMap[key] = {
        bmc_code: r.bmc_code,
        bmc_name: r.bmc_name,
        reading_date: r.reading_date,
        worker: null,
        qc: null
      };
    }
    if (r.source === 'worker') pairedMap[key].worker = r;
    if (r.source === 'qc') pairedMap[key].qc = r;
  });

  const pairs = Object.values(pairedMap);

  pairs.forEach(p => {
    const isCodeValid = validBmcCodes.has(p.bmc_code) || validBmcNames.has(p.bmc_name.toLowerCase());
    if (isCodeValid) validCount++; else invalidCount++;
  });

  document.getElementById('stat-preview-total').textContent = parsedMacsReadings.length;
  document.getElementById('stat-preview-bmcs').textContent = pairs.length;
  document.getElementById('stat-preview-valid').textContent = validCount;
  document.getElementById('stat-preview-invalid').textContent = invalidCount;

  const tbody = document.getElementById('preview-tbody');
  tbody.innerHTML = pairs.map(p => {
    const isCodeValid = validBmcCodes.has(p.bmc_code) || validBmcNames.has(p.bmc_name.toLowerCase());
    const w = p.worker || {};
    const q = p.qc || {};

    const wFatStr = w.fat !== null && w.fat !== undefined ? `${w.fat}%` : '--';
    const wSnfStr = w.snf !== null && w.snf !== undefined ? `${w.snf}%` : '--';
    const qFatStr = q.fat !== null && q.fat !== undefined ? `${q.fat}%` : '--';
    const qSnfStr = q.snf !== null && q.snf !== undefined ? `${q.snf}%` : '--';

    let statusPill = `<span class="qc-pill pill-approved">VALID</span>`;
    if (!isCodeValid) {
      statusPill = `<span class="qc-pill pill-returned" style="background:#FEE2E2; color:#991B1B;">UNKNOWN BMC CODE</span>`;
    } else if (w.fat === q.fat && w.snf === q.snf) {
      statusPill = `<span class="qc-pill pill-approved">MATCHED</span>`;
    } else {
      statusPill = `<span class="qc-pill" style="background:#FEF3C7; color:#92400E;">MISMATCH</span>`;
    }

    const dateFormatted = new Date(p.reading_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    return `
      <tr>
        <td><strong>${esc(p.bmc_code)}</strong></td>
        <td>${esc(p.bmc_name || 'N/A')}</td>
        <td>${esc(dateFormatted)}</td>
        <td><strong style="color:#2563EB;">${esc(wFatStr)}</strong></td>
        <td><strong style="color:#2563EB;">${esc(wSnfStr)}</strong></td>
        <td><strong style="color:#059669;">${esc(qFatStr)}</strong></td>
        <td><strong style="color:#059669;">${esc(qSnfStr)}</strong></td>
        <td>${statusPill}</td>
      </tr>
    `;
  }).join('');
}

async function handleExecuteImport() {
  if (parsedMacsReadings.length === 0) return;

  try {
    showToast('Saving MACS Readings into Supabase database...', 'info');
    const res = await apiQcAgmImportMacsReadings(fileInfo.name, parsedMacsReadings, 'Uploaded via MACS Import Manager');
    showToast(res.message, 'success');

    resetImportState();
    await loadImportHistory();
  } catch (err) {
    console.error('Error executing MACS import:', err);
    showToast(err.message || 'Failed to import MACS Readings.', 'error');
  }
}

function resetImportState() {
  parsedMacsReadings = [];
  fileInfo = { name: '', size: 0 };

  document.getElementById('import-step-preview').classList.add('hidden');
  document.getElementById('excel-drop-zone-card').classList.remove('hidden');
}

async function loadImportHistory() {
  try {
    const res = await apiQcAgmGetImports();
    const imports = res.imports || [];
    renderImportHistoryTable(imports);
  } catch (err) {
    console.error('Error loading import history:', err);
  }
}

function renderImportHistoryTable(imports) {
  const tbody = document.getElementById('import-history-tbody');
  if (!tbody) return;

  if (imports.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="qc-empty">
            <div class="qc-empty-icon">📁</div>
            <div class="qc-empty-title">No MACS Excel Imports Yet</div>
            <div class="qc-empty-desc">Upload your first MACS milk laboratory report above.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = imports.map(imp => {
    const impDate = new Date(imp.created_at).toLocaleString();
    const importerName = imp.importer ? imp.importer.name : 'QC AGM';

    return `
      <tr>
        <td><strong>📄 ${esc(imp.file_name)}</strong></td>
        <td>${esc(impDate)}</td>
        <td>${esc(importerName)}</td>
        <td><strong style="color:var(--qc-700);">${imp.total_rows}</strong></td>
        <td><span style="color:#16A34A; font-weight:700;">${imp.successful_rows}</span></td>
        <td><span style="color:#DC2626; font-weight:700;">${imp.failed_rows}</span></td>
        <td><span class="qc-pill pill-approved">${esc(imp.status)}</span></td>
      </tr>
    `;
  }).join('');
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
