// qc-agm-excel.js — QC AGM Excel Data Import, Column Mapping & Preview logic

let parsedRawRows = [];
let detectedColumns = [];
let columnMapping = {};
let fileInfo = { name: '', size: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupDropZone();
  await loadImportHistory();
});

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

  showToast('Reading Excel spreadsheet...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (json.length === 0) {
        showToast('The uploaded Excel file contains no data rows.', 'error');
        return;
      }

      parsedRawRows = json;
      detectedColumns = Object.keys(json[0]);

      showToast(`Spreadsheet parsed successfully (${parsedRawRows.length} rows found).`, 'success');

      setupColumnMappingUI();
      document.getElementById('import-step-mapping').classList.remove('hidden');
      document.getElementById('excel-drop-zone').classList.add('hidden');
    } catch (err) {
      console.error('Error parsing Excel file:', err);
      showToast('Failed to parse Excel file. Ensure it is a valid spreadsheet.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function setupColumnMappingUI() {
  const container = document.getElementById('column-mapping-container');
  if (!container) return;

  // Expected System Fields
  const systemFields = [
    { key: 'sample_id', label: 'Sample ID / Reference', required: false },
    { key: 'bmc_name', label: 'BMC Center Name', required: true },
    { key: 'test_date', label: 'Test Date', required: false },
    { key: 'fat', label: 'Fat %', required: true },
    { key: 'snf', label: 'SNF %', required: true },
    { key: 'clr', label: 'CLR (Lactometer)', required: false },
    { key: 'temperature', label: 'Temperature (°C)', required: false },
    { key: 'acidity', label: 'Acidity %', required: false },
    { key: 'protein', label: 'Protein %', required: false },
    { key: 'lactose', label: 'Lactose %', required: false }
  ];

  let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">`;

  systemFields.forEach(sf => {
    // Auto detect matching column name
    const autoMatch = detectedColumns.find(col => {
      const c = col.toLowerCase().replace(/[^a-z0-9]/g, '');
      const k = sf.key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes(k) || k.includes(c);
    }) || '';

    html += `
      <div class="qc-form-group">
        <label class="qc-form-label">
          ${sf.label} ${sf.required ? '<span style="color:#DC2626;">*</span>' : ''}
        </label>
        <select class="qc-form-input map-select" data-syskey="${sf.key}">
          <option value="">-- Ignore Field --</option>
          ${detectedColumns.map(col => `<option value="${esc(col)}" ${col === autoMatch ? 'selected' : ''}>${esc(col)}</option>`).join('')}
        </select>
      </div>
    `;
  });

  html += `</div>`;
  html += `
    <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
      <button class="btn-qc btn-qc-primary" onclick="generatePreviewTable()">
        🔍 Generate Preview &amp; Validate
      </button>
    </div>
  `;

  container.innerHTML = html;
}

window.generatePreviewTable = function() {
  // Read mappings
  columnMapping = {};
  document.querySelectorAll('.map-select').forEach(sel => {
    const sysKey = sel.dataset.syskey;
    const excelCol = sel.value;
    if (excelCol) columnMapping[sysKey] = excelCol;
  });

  if (!columnMapping.fat && !columnMapping.snf) {
    showToast('Please map at least Fat % or SNF % column.', 'error');
    return;
  }

  // Transform rows using mapping
  let validCount = 0;
  let invalidCount = 0;

  const previewRows = parsedRawRows.map((r, idx) => {
    const mapped = {
      sample_id: r[columnMapping.sample_id] || `ROW-${idx + 1}`,
      bmc_name: r[columnMapping.bmc_name] || '',
      test_date: r[columnMapping.test_date] || new Date().toISOString().split('T')[0],
      fat: r[columnMapping.fat] !== undefined ? r[columnMapping.fat] : '',
      snf: r[columnMapping.snf] !== undefined ? r[columnMapping.snf] : '',
      clr: r[columnMapping.clr] !== undefined ? r[columnMapping.clr] : '',
      temperature: r[columnMapping.temperature] !== undefined ? r[columnMapping.temperature] : '',
      acidity: r[columnMapping.acidity] !== undefined ? r[columnMapping.acidity] : '',
      protein: r[columnMapping.protein] !== undefined ? r[columnMapping.protein] : '',
      lactose: r[columnMapping.lactose] !== undefined ? r[columnMapping.lactose] : ''
    };

    const isValid = mapped.fat !== '' || mapped.snf !== '';
    if (isValid) validCount++; else invalidCount++;

    return { mapped, isValid };
  });

  document.getElementById('stat-preview-total').textContent = parsedRawRows.length;
  document.getElementById('stat-preview-valid').textContent = validCount;
  document.getElementById('stat-preview-invalid').textContent = invalidCount;

  // Render Table
  const tbody = document.getElementById('preview-tbody');
  tbody.innerHTML = previewRows.slice(0, 15).map((rowObj, idx) => {
    const m = rowObj.mapped;
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${esc(m.sample_id)}</strong></td>
        <td>${esc(m.bmc_name || 'N/A')}</td>
        <td>${esc(m.test_date)}</td>
        <td><strong style="color:#0F766E;">${esc(m.fat)}${m.fat ? '%' : ''}</strong></td>
        <td><strong style="color:#0F766E;">${esc(m.snf)}${m.snf ? '%' : ''}</strong></td>
        <td>${esc(m.clr)}</td>
        <td>${esc(m.temperature)}</td>
        <td>
          ${rowObj.isValid ? '<span class="qc-pill pill-approved">Valid</span>' : '<span class="qc-pill pill-returned">Missing Fat/SNF</span>'}
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('import-step-preview').classList.remove('hidden');
};

async function handleExecuteImport() {
  if (parsedRawRows.length === 0) return;

  const rowsToUpload = parsedRawRows.map((r, idx) => ({
    sample_id: r[columnMapping.sample_id] || `ROW-${idx + 1}`,
    bmc_name: r[columnMapping.bmc_name] || '',
    test_date: r[columnMapping.test_date] || new Date().toISOString().split('T')[0],
    fat: r[columnMapping.fat],
    snf: r[columnMapping.snf],
    clr: r[columnMapping.clr],
    temperature: r[columnMapping.temperature],
    acidity: r[columnMapping.acidity],
    protein: r[columnMapping.protein],
    lactose: r[columnMapping.lactose]
  }));

  try {
    showToast('Importing spreadsheet records into database...', 'info');
    const res = await apiQcAgmImportExcel(fileInfo.name, rowsToUpload, 'Imported via Excel Manager');
    showToast(res.message, 'success');

    resetImportState();
    await loadImportHistory();
  } catch (err) {
    console.error('Error executing import:', err);
    showToast(err.message || 'Failed to import Excel data.', 'error');
  }
}

function resetImportState() {
  parsedRawRows = [];
  detectedColumns = [];
  columnMapping = {};
  fileInfo = { name: '', size: 0 };

  document.getElementById('import-step-mapping').classList.add('hidden');
  document.getElementById('import-step-preview').classList.add('hidden');
  document.getElementById('excel-drop-zone').classList.remove('hidden');
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
            <div class="qc-empty-title">No Excel Imports Yet</div>
            <div class="qc-empty-desc">Upload your first milk testing Excel spreadsheet above.</div>
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
