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

  const dateInput = document.getElementById('macs-import-date');
  if (dateInput) dateInput.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

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
      let litreCol = -1;
      let generalQtyCol = -1;

      for (let sc = c; sc < Math.min(c + 10, headerRow.length); sc++) {
        const subHeaderVal = String(subHeaderRow[sc] || '').trim().toUpperCase();
        const mainHeaderVal = String(headerRow[sc] || '').trim().toUpperCase();

        // STRICT REQUIREMENT: Do NOT fetch from SOC, SOCIETY, or SHARE columns!
        if (subHeaderVal.includes('SHARE') || mainHeaderVal.includes('SHARE') || 
            subHeaderVal.startsWith('SOC') || mainHeaderVal.startsWith('SOC') ||
            subHeaderVal.includes('SOCIETY') || mainHeaderVal.includes('SOCIETY')) {
          continue;
        }

        if (subHeaderVal === 'FAT' || subHeaderVal === 'FAT %' || subHeaderVal.includes('FAT')) fatCol = sc;
        if (subHeaderVal === 'SNF' || subHeaderVal === 'SNF %' || subHeaderVal.includes('SNF')) snfCol = sc;

        // Match Column F / LIT / LIT. / LITRE / LITRES / LTR / QUANTITY
        if (subHeaderVal === 'LIT' || subHeaderVal === 'LIT.' || subHeaderVal.startsWith('LIT') || 
            subHeaderVal.includes('LITRE') || subHeaderVal.includes('LITER') || subHeaderVal.includes('LTR')) {
          litreCol = sc;
        } else if (subHeaderVal.includes('QTY') || subHeaderVal.includes('QUANTITY') || subHeaderVal.includes('VOL')) {
          generalQtyCol = sc;
        }
      }

      // If no explicit Litre/Qty column subheader was found, pick Column F (index 5) or first valid non-SOC/SHARE, non-FAT/SNF column
      let chosenQtyCol = -1;
      if (litreCol !== -1) {
        chosenQtyCol = litreCol;
      } else if (generalQtyCol !== -1) {
        chosenQtyCol = generalQtyCol;
      } else {
        // Check Column F (index 5) directly if available and valid
        if (headerRow.length > 5) {
          const colFSub = String(subHeaderRow[5] || '').trim().toUpperCase();
          const colFMain = String(headerRow[5] || '').trim().toUpperCase();
          if (!colFSub.includes('SHARE') && !colFSub.startsWith('SOC') && !colFSub.includes('FAT') && !colFSub.includes('SNF')) {
            chosenQtyCol = 5;
          }
        }

        if (chosenQtyCol === -1) {
          for (let sc = c; sc < Math.min(c + 8, headerRow.length); sc++) {
            const subHeaderVal = String(subHeaderRow[sc] || '').trim().toUpperCase();
            const mainHeaderVal = String(headerRow[sc] || '').trim().toUpperCase();
            if (subHeaderVal.includes('SHARE') || mainHeaderVal.includes('SHARE')) continue;
            if (subHeaderVal.startsWith('SOC') || mainHeaderVal.startsWith('SOC')) continue;
            if (sc === fatCol || sc === snfCol) continue;
            if (subHeaderVal.includes('FAT') || subHeaderVal.includes('SNF')) continue;
            
            chosenQtyCol = sc;
            break;
          }
        }
      }

      if (chosenQtyCol === -1) chosenQtyCol = 5; // Default to Column F (Col index 5)

      dateGroups[parsedDate].push({
        startCol: c,
        fatCol: fatCol !== -1 ? fatCol : c + 3,
        snfCol: snfCol !== -1 ? snfCol : c + 4,
        qtyCol: chosenQtyCol
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
      
      // Explicitly target Column F (row[5]) for Litres as requested by user
      const colFLit = parseNumericCell(row[5]);
      
      // Block 0 = Worker MACS Reading
      if (blocks[0]) {
        const detectedLit = parseNumericCell(row[blocks[0].qtyCol]);
        const finalLit = colFLit !== null ? colFLit : detectedLit;

        parsedReadings.push({
          bmc_code: rawCode,
          bmc_name: rawName,
          reading_date: dateIso,
          source: 'worker',
          fat: parseNumericCell(row[blocks[0].fatCol]),
          snf: parseNumericCell(row[blocks[0].snfCol]),
          quantity_liters: finalLit
        });
      }

      // Block 1 = QC MACS Reading
      if (blocks[1]) {
        const detectedQcLit = parseNumericCell(row[blocks[1].qtyCol]);
        const finalQcLit = detectedQcLit !== null ? detectedQcLit : colFLit;

        parsedReadings.push({
          bmc_code: rawCode,
          bmc_name: rawName,
          reading_date: dateIso,
          source: 'qc',
          fat: parseNumericCell(row[blocks[1].fatCol]),
          snf: parseNumericCell(row[blocks[1].snfCol]),
          quantity_liters: finalQcLit
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
    const q = p.qc || p.worker || {};

    const qFatStr = q.fat !== null && q.fat !== undefined ? `${q.fat}%` : '--';
    const qSnfStr = q.snf !== null && q.snf !== undefined ? `${q.snf}%` : '--';

    let statusPill = `<span class="qc-pill pill-approved">VALID</span>`;
    if (!isCodeValid) {
      statusPill = `<span class="qc-pill pill-returned" style="background:#FEE2E2; color:#991B1B;">UNKNOWN BMC CODE</span>`;
    }

    const dateFormatted = new Date(p.reading_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    return `
      <tr>
        <td><strong>${esc(p.bmc_code)}</strong></td>
        <td>${esc(p.bmc_name || 'N/A')}</td>
        <td>${esc(dateFormatted)}</td>
        <td><strong style="color:#059669;">${esc(qFatStr)}</strong></td>
        <td><strong style="color:#059669;">${esc(qSnfStr)}</strong></td>
        <td>${statusPill}</td>
      </tr>
    `;
  }).join('');
}

async function handleExecuteImport() {
  if (parsedMacsReadings.length === 0) return;

  const importDate = document.getElementById('macs-import-date')?.value || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const period = document.getElementById('macs-import-period')?.value || 'both';

  try {
    showToast('Saving MACS Readings into database...', 'info');
    
    // Call API with date & period parameters
    const token = await getQcAgmAuthToken();
    const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';
    
    const res = await fetch(`${baseUrl}/api/qc-agm/macs/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        file_name: fileInfo.name,
        import_date: importDate,
        period,
        readings: parsedMacsReadings,
        notes: `MACS Excel Import (${period.toUpperCase()} - ${importDate})`
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed.');

    const stats = data.stats || {};
    const summaryMsg = `🎉 MACS Import Complete!\n\n` +
      `📊 Total Excel Rows: ${stats.total_excel_rows || parsedMacsReadings.length}\n` +
      `✅ Successfully Mapped: ${stats.successfully_mapped || 0}\n` +
      `⚠️ BMC Code Missing: ${stats.bmc_code_missing || 0}\n` +
      `❌ BMC Code Not Found: ${stats.bmc_code_not_found || 0}\n` +
      `🔄 Duplicate / Updated Rows: ${stats.duplicate_conflicting || 0}`;

    alert(summaryMsg);
    showToast(data.message, 'success');

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
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="qc-pill pill-approved">${esc(imp.status)}</span>
            <button type="button" class="btn-delete-batch" onclick="deleteImportBatch('${imp.id}')" style="background:#EF4444; color:white; border:none; padding:4px 10px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer;" title="Delete Batch & Mapped Data">
              🗑️ Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.deleteImportBatch = async function(batchId) {
  if (!confirm('Are you sure you want to delete this MACS Excel import batch?\nAll mapped daily records and BMC data from this batch will be permanently deleted.')) {
    return;
  }

  try {
    const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
    const token = await getQcAgmAuthToken();
    const res = await fetch(`${baseUrl}/api/qc-agm/macs/import-batch/${batchId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete import batch');

    if (typeof showToast === 'function') {
      showToast(data.message || 'MACS Excel batch and mapped data deleted.', 'success');
    } else {
      alert(data.message || 'MACS Excel batch and mapped data deleted.');
    }

    if (typeof loadImportHistory === 'function') {
      await loadImportHistory();
    }
  } catch (err) {
    console.error('Error deleting import batch:', err);
    alert(err.message || 'Failed to delete import batch.');
  }
};

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
