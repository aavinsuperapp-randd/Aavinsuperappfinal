const XLSX = require('./backend/node_modules/xlsx');
const path = 'C:\\Users\\user\\Downloads\\bmc_report_24-08-2026_to_24-08-2026.xlsx';

function parseDateToIso(str) {
  if (!str) return null;
  const s = String(str).trim();
  
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const d = m1[1].padStart(2, '0');
    const m = m1[2].padStart(2, '0');
    const y = m1[3];
    return `${y}-${m}-${d}`;
  }

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

  return { detectedDates, dateGroups, parsedReadings };
}

const workbook = XLSX.readFile(path);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const result = parseMacsExcel(rows);

module.exports = { parseMacsExcel, result };
