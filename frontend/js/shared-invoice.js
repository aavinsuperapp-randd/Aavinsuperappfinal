// shared-invoice.js — PDF generation logic for Tanker Milk Despatch Advice

async function downloadInvoicePdf(visitId) {
  try {
    const isWorker = window.location.pathname.includes('/worker/');
    const fetchFunc = isWorker 
      ? (typeof workerFetch === 'function' ? workerFetch : null) 
      : (typeof gmFetch === 'function' 
          ? gmFetch 
          : (typeof qcAgmFetch === 'function' 
              ? qcAgmFetch 
              : (typeof eoFetch === 'function' 
                  ? eoFetch 
                  : (typeof piAgmFetch === 'function' ? piAgmFetch : null))));
    
    let endpoint = `/api/gm/invoices/${visitId}`;
    if (isWorker) {
      endpoint = `/api/worker/invoices/${visitId}`;
    }

    if (!fetchFunc) {
      throw new Error("API client not found. Please reload the page.");
    }

    const data = await fetchFunc(endpoint);
    if (!data || !data.visit) {
      throw new Error("No visit data returned from server.");
    }
    generateInvoicePdf(data.visit);
  } catch (err) {
    console.error('PDF download error:', err);
    alert('Failed to load invoice data for PDF: ' + err.message);
  }
}
window.downloadInvoicePdf = downloadInvoicePdf;

function generateInvoicePdf(v) {
  if (!v) { alert('No invoice data available.'); return; }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { alert('jsPDF library not loaded.'); return; }
  
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  const trip = v.trip || {};
  const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || '—');
  const bmcCode = v.bmc ? (v.bmc.bmc_code || '') : (v.bmc_code || '');

  // Extract test results
  const ftir = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : v.ftir_tests;
  const gerber = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : v.gerber_tests;
  const qcList = Array.isArray(v.qc_lab_tests) ? v.qc_lab_tests : (v.qc_lab_tests ? [v.qc_lab_tests] : []);
  const qc = qcList.length > 0 ? qcList[0] : {};

  // Compartment display
  const compRaw = String(v.compartment || trip.compartment || 'front').toLowerCase();
  const compDisplay = compRaw === 'back' || compRaw === 'rear' ? 'Rear' : (compRaw === 'mid' || compRaw === 'middle' ? 'Mid' : 'Front');

  // Milk weight calculation (in KG)
  let milkKg = '—';
  if (v.milk_quantity_kg !== null && v.milk_quantity_kg !== undefined && v.milk_quantity_kg !== '') {
    milkKg = Number(v.milk_quantity_kg).toFixed(1);
  } else if (v.milk_quantity_liters !== null && v.milk_quantity_liters !== undefined && v.milk_quantity_liters !== '') {
    milkKg = (Number(v.milk_quantity_liters) * 1.03).toFixed(1);
  }

  // Values for table 1 milk details
  const fatVal = ftir?.fat ?? gerber?.fat_percentage ?? qc?.fat ?? '—';
  const snfVal = ftir?.snf ?? gerber?.snf ?? qc?.snf ?? '—';
  const cobVal = gerber?.clr ?? qc?.clr ?? '—';

  // Helper date formatters
  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return '—'; }
  };
  const formatTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch(e) { return '—'; }
  };
  const formatDateTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) { return '—'; }
  };

  // ── HEADER ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // Clean dark charcoal
  doc.text('Aavin Madurai', pageW / 2, y + 4, { align: 'center' });

  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Tamil Nadu Co-operative Milk Producers\' Federation Ltd', pageW / 2, y, { align: 'center' });

  y += 8;
  doc.setFillColor(241, 245, 249); // Light background header banner
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, contentW, 10, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(2, 48, 120); // Aavin Deep Blue accent
  doc.text('TANKER MILK DESPATCH INVOICE', pageW / 2, y + 6.8, { align: 'center' });

  y += 15;

  // ── TABLE 1 — BMC / VEHICLE / SPOT ANALYZER DETAILS ──
  const spotAnalyzerName = trip.spot_analyzer_name || v.spot_analyzer_name || v.worker_name || '—';
  const driverName = trip.driver_name || '—';
  const tankerNo = trip.tanker_number || '—';

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Field', 'Details', 'Field', 'Details']],
    body: [
      ['BMC', bmcName, 'Tanker Number', tankerNo],
      ['Serial Number', v.invoice_serial_no || '—', 'Transport Contractor', 'UNION'],
      ['BMC Code', bmcCode || '—', 'Compartment', compDisplay],
      ['Date & Time of Tanker Arrival', v.visit_start_time ? formatDateTime(v.visit_start_time) : '—', 'Approved / Alternate', 'Approved'],
      ['Date & Time of Tanker Despatch', v.visit_end_time ? formatDateTime(v.visit_end_time) : '—', 'Name of the Driver', driverName],
      ['Spot Analyzer', spotAnalyzerName, 'Destination', 'MADURAI AAVIN']
    ],
    theme: 'grid',
    styles: { 
      fontSize: 8.5, 
      cellPadding: 3.5, 
      lineColor: [203, 213, 225], 
      lineWidth: 0.3,
      textColor: [30, 41, 59]
    },
    headStyles: { 
      fillColor: [226, 232, 240], 
      textColor: [15, 23, 42], 
      fontStyle: 'bold', 
      fontSize: 8.5,
      halign: 'left'
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 46 },
      1: { cellWidth: 44 },
      2: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 46 },
      3: { cellWidth: 44 }
    }
  });

  y = doc.lastAutoTable.finalY + 8;

  // ── MILK LOADED BY THE BMC WITH SEAL DETAILS ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('MILK LOADED BY THE BMC WITH SEAL DETAILS', margin, y);
  y += 3;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Compartment', 'Milk (KG)', 'Temperature °C', 'Seal No.', 'Broken Seal No.']],
    body: [
      [
        compDisplay,
        String(milkKg),
        v.temperature ? `${v.temperature}°C` : '—',
        v.seal_number || '—',
        v.broken_seal_number || '—'
      ]
    ],
    theme: 'grid',
    styles: { 
      fontSize: 8.5, 
      cellPadding: 4.5, 
      halign: 'center', 
      lineColor: [203, 213, 225], 
      lineWidth: 0.3,
      textColor: [30, 41, 59]
    },
    headStyles: { 
      fillColor: [241, 245, 249], 
      textColor: [15, 23, 42], 
      fontStyle: 'bold', 
      fontSize: 8 
    }
  });

  y = doc.lastAutoTable.finalY + 8;

  // ── TABLE 2 — TEST VALUES ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('TEST VALUES', margin, y);
  y += 3;

  const ftirFat = ftir?.fat ?? null;
  const ftirSnf = ftir?.snf ?? null;
  const ftirLacto = ftir?.clr ?? ftir?.lacto ?? null;

  const gerberFat = gerber?.fat_percentage ?? null;
  const gerberSnf = gerber?.snf ?? null;
  const gerberLacto = gerber?.clr ?? null;

  const getDiff = (a, b) => {
    if (a !== null && a !== undefined && a !== '' && !isNaN(a) && b !== null && b !== undefined && b !== '' && !isNaN(b)) {
      return Math.abs(parseFloat(a) - parseFloat(b)).toFixed(1);
    }
    return '—';
  };

  const diffFat = getDiff(ftirFat, gerberFat);
  const diffSnf = getDiff(ftirSnf, gerberSnf);
  const diffLacto = getDiff(ftirLacto, gerberLacto);

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Test', 'FAT', 'SNF', 'Lacto']],
    body: [
      ['FTIR', ftirFat ?? '—', ftirSnf ?? '—', ftirLacto ?? '—'],
      ['Gerber', gerberFat ?? '—', gerberSnf ?? '—', gerberLacto ?? '—'],
      ['Difference', diffFat, diffSnf, diffLacto]
    ],
    theme: 'grid',
    styles: { 
      fontSize: 8, 
      cellPadding: 3.5, 
      halign: 'center', 
      lineColor: [203, 213, 225], 
      lineWidth: 0.3,
      textColor: [30, 41, 59]
    },
    headStyles: { 
      fillColor: [241, 245, 249], 
      textColor: [15, 23, 42], 
      fontStyle: 'bold', 
      fontSize: 8 
    },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'left', fillColor: [248, 250, 252], cellWidth: 50 }
    }
  });

  y = doc.lastAutoTable.finalY + 6;

  // ── ADDITIONAL TEST VALUES ──
  const mprtVal = qc?.mprt ?? gerber?.mprt ?? '—';
  const acidityVal = qc?.acidity ?? gerber?.acidity ?? '—';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text('ADDITIONAL TEST VALUES:', margin, y);
  
  doc.setFont('helvetica', 'normal');
  doc.text(`MPRT: ${mprtVal}     |     Acidity: ${acidityVal}`, margin + 45, y);

  y += 10;

  // ── DECLARATION ──
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentW, 20, 1, 1, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Spot Analyzer: ${spotAnalyzerName}`, margin + 4, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const declText = 'I hereby declare that the above details are true and correct to the best of my knowledge. The milk has been loaded as per the standard operating procedures.';
  const declLines = doc.splitTextToSize(declText, contentW - 8);
  doc.text(declLines, margin + 4, y + 12);

  y += 28;

  // ── SIGNATURE SECTION ──
  const sigY = Math.max(y, pageH - 35);
  const colW = contentW / 3;

  // Horizontal signature line guides
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);

  // Col 1: Secretary of BMC
  doc.line(margin + 5, sigY, margin + colW - 10, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Secretary of BMC', margin + (colW / 2), sigY + 5, { align: 'center' });

  // Col 2: Spot Analyzer
  doc.line(margin + colW + 5, sigY, margin + (colW * 2) - 10, sigY);
  doc.text('Spot Analyzer', margin + colW + (colW / 2), sigY + 5, { align: 'center' });

  // Col 3: Driver of the Tanker
  doc.line(margin + (colW * 2) + 5, sigY, margin + contentW - 5, sigY);
  doc.text('Driver of the Tanker', margin + (colW * 2) + (colW / 2), sigY + 5, { align: 'center' });

  // ── FOOTER ──
  const footerY = pageH - 8;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated by AAVIN BMC Monitoring System — ${new Date().toLocaleString('en-IN')}`, margin, footerY);
  doc.text('Page 1 of 1', pageW - margin, footerY, { align: 'right' });

  // Save PDF
  const cleanSerial = (v.invoice_serial_no || 'BMC').replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanBmc = (bmcName || '').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `Despatch_Advice_${cleanSerial}_${cleanBmc}.pdf`;
  doc.save(fileName);
}
window.generateInvoicePdf = generateInvoicePdf;
