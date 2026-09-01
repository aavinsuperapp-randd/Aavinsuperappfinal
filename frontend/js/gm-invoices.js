// gm-invoices.js — GM Portal: Invoices Tab (Tanker Milk Despatch Advice)

// Helper functions for safe string escaping and date formatting
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch(e) { return '—'; }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch(e) { return '—'; }
}

let currentSelectedDate = getTodayDateStr(); // 'YYYY-MM-DD' by default
let currentSearchQuery = '';

function getTodayDateStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

function getYesterdayDateStr() {
  const d = new Date(Date.now() - 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

function formatDateLabel(dateStr) {
  if (!dateStr || dateStr === 'all') return 'All Invoices';
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();
  if (dateStr === todayStr) {
    return `Today (${formatDate(todayStr)})`;
  }
  if (dateStr === yesterdayStr) {
    return `Yesterday (${formatDate(yesterdayStr)})`;
  }
  return formatDate(dateStr);
}

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('gm');
  if (!profile) return;

  if (document.getElementById('header-gm-name')) {
    document.getElementById('header-gm-name').textContent = profile.name || 'General Manager';
  }

  // Sidebar toggle
  const sidebar = document.getElementById('gm-sidebar');
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
      if (overlay) overlay.classList.remove('active');
    });
  }

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Setup Date and Search Controls
  setupFilterControls();

  // Modal close
  document.getElementById('inv-modal-close')?.addEventListener('click', closeInvoiceModal);
  document.getElementById('inv-modal-dismiss')?.addEventListener('click', closeInvoiceModal);

  await loadInvoices();
});

function setupFilterControls() {
  const btnToday = document.getElementById('btn-date-today');
  const btnYesterday = document.getElementById('btn-date-yesterday');
  const btnAll = document.getElementById('btn-date-all');
  const datePicker = document.getElementById('invoice-date-picker');
  const searchInput = document.getElementById('invoice-search-input');
  const searchBtn = document.getElementById('invoice-search-btn');
  const resetBtn = document.getElementById('invoice-reset-btn');

  if (datePicker) {
    datePicker.value = currentSelectedDate;
    datePicker.addEventListener('change', () => {
      setFilterDate(datePicker.value);
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => setFilterDate(getTodayDateStr()));
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => setFilterDate(getYesterdayDateStr()));
  }

  if (btnAll) {
    btnAll.addEventListener('click', () => setFilterDate('all'));
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      currentSearchQuery = searchInput.value.trim();
      loadInvoices();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        currentSearchQuery = searchInput.value.trim();
        loadInvoices();
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      currentSearchQuery = '';
      setFilterDate(getTodayDateStr());
    });
  }

  updateDateButtonStyles();
}

function setFilterDate(dateStr) {
  currentSelectedDate = dateStr || 'all';
  const datePicker = document.getElementById('invoice-date-picker');
  if (datePicker) {
    datePicker.value = (dateStr === 'all' || !dateStr) ? '' : dateStr;
  }
  updateDateButtonStyles();
  loadInvoices();
}
window.setFilterDate = setFilterDate;

function updateDateButtonStyles() {
  const btnToday = document.getElementById('btn-date-today');
  const btnYesterday = document.getElementById('btn-date-yesterday');
  const btnAll = document.getElementById('btn-date-all');

  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();

  const isToday = currentSelectedDate === todayStr;
  const isYesterday = currentSelectedDate === yesterdayStr;
  const isAll = currentSelectedDate === 'all' || !currentSelectedDate;

  if (btnToday) btnToday.className = isToday ? 'btn-date-filter active' : 'btn-date-filter';
  if (btnYesterday) btnYesterday.className = isYesterday ? 'btn-date-filter active' : 'btn-date-filter';
  if (btnAll) btnAll.className = isAll ? 'btn-date-filter active' : 'btn-date-filter';

  const statusEl = document.getElementById('invoice-filter-status');
  if (statusEl) {
    statusEl.textContent = `Showing: ${formatDateLabel(currentSelectedDate)}`;
  }
}

async function loadInvoices() {
  const tbody = document.getElementById('invoices-table-body');
  const badge = document.getElementById('invoice-count-badge');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="invoice-empty">Loading invoices...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (currentSearchQuery) params.set('q', currentSearchQuery);
    if (currentSelectedDate && currentSelectedDate !== 'all') params.set('date', currentSelectedDate);

    const qs = params.toString() ? `?${params.toString()}` : (currentSelectedDate === 'all' ? '?date=all' : '');
    const res = await gmFetch(`/api/gm/invoices${qs}`);
    const invoices = res.invoices || [];

    if (badge) badge.textContent = invoices.length;

    if (invoices.length === 0) {
      const dateLabel = formatDateLabel(currentSelectedDate);
      if (currentSearchQuery) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center">
          <div class="ui-state-card ui-state-no-results" style="border:none;box-shadow:none;margin:0;padding:24px 16px;">
            <div class="ui-state-icon" style="width:36px;height:36px;margin-bottom:8px;">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>
            <div class="ui-state-title" style="font-size:0.9rem;">No Invoices Found</div>
            <div class="ui-state-desc" style="font-size:0.8rem;margin-bottom:0;">No invoices matching "${esc(currentSearchQuery)}" for ${dateLabel}</div>
          </div>
        </td></tr>`;
      } else if (currentSelectedDate && currentSelectedDate !== 'all') {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center">
          <div class="ui-state-card ui-state-empty" style="border:none;box-shadow:none;margin:0;padding:24px 16px;">
            <div class="ui-state-icon" style="width:36px;height:36px;margin-bottom:8px;">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            </div>
            <div class="ui-state-title" style="font-size:0.9rem;">No Invoices for ${dateLabel}</div>
            <div class="ui-state-desc" style="font-size:0.8rem;margin-bottom:12px;">No BMC visit invoices recorded on this date.</div>
            <button type="button" class="btn-date-filter" onclick="setFilterDate('all')" style="background:#2563EB;color:#FFF;border-color:#1D4ED8;">📅 View All Invoices</button>
          </div>
        </td></tr>`;
      } else {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center">
          <div class="ui-state-card ui-state-empty" style="border:none;box-shadow:none;margin:0;padding:24px 16px;">
            <div class="ui-state-icon" style="width:36px;height:36px;margin-bottom:8px;">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            </div>
            <div class="ui-state-title" style="font-size:0.9rem;">No Invoices Available</div>
            <div class="ui-state-desc" style="font-size:0.8rem;margin-bottom:0;">Invoices are automatically generated when Spot Analyzers close BMC visits.</div>
          </div>
        </td></tr>`;
      }
      return;
    }

    tbody.innerHTML = invoices.map((inv, idx) => {
      const dateStr = inv.visit_end_time ? formatDate(inv.visit_end_time) : '—';
      return `
        <tr style="cursor:pointer;" onclick="openInvoicePreview('${inv.visit_id}')">
          <td style="text-align:center;font-weight:600;color:#64748B;">${idx + 1}</td>
          <td><strong style="color:#1D4ED8;">${esc(inv.bmc_code || '—')}</strong></td>
          <td><strong>${esc(inv.bmc_name || '—')}</strong></td>
          <td>${dateStr}</td>
          <td style="text-align:right;white-space:nowrap;" onclick="event.stopPropagation()">
            <button class="btn-invoice-pdf" onclick="downloadInvoicePdf('${inv.visit_id}')">📄 Download PDF</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load invoices:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center">
        <div class="ui-state-card ui-state-error" style="border:none;box-shadow:none;margin:0;padding:24px 16px;">
          <div class="ui-state-icon" style="width:36px;height:36px;margin-bottom:8px;">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </div>
          <div class="ui-state-title" style="font-size:0.9rem;">Unable to Load Invoices</div>
          <div class="ui-state-desc" style="font-size:0.8rem;margin-bottom:8px;">${esc(err.message || 'An unexpected error occurred while retrieving invoice records.')}</div>
          <button class="btn btn-outline btn-sm" onclick="loadInvoices()">Retry</button>
        </div>
      </td></tr>`;
    }
  }
}

// ── Invoice Preview Modal ────────────────────────────────────────────────────
let currentInvoiceData = null;

async function openInvoicePreview(visitId) {
  const modal = document.getElementById('invoice-preview-modal');
  const body = document.getElementById('inv-modal-body');
  if (!modal || !body) return;

  body.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B;">Loading invoice data...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await gmFetch(`/api/gm/invoices/${visitId}`);
    currentInvoiceData = res.visit;
    const v = res.visit;
    const trip = v.trip || {};

    const bmcName = v.bmc ? v.bmc.name : '—';
    const bmcCode = v.bmc ? v.bmc.bmc_code : '';

    const ftir = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : v.ftir_tests;
    const gerber = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : v.gerber_tests;

    const compRaw = String(v.compartment || 'front').toLowerCase();
    const compDisplay = compRaw === 'back' || compRaw === 'rear' ? 'Rear' : (compRaw === 'mid' || compRaw === 'middle' ? 'Mid' : 'Front');

    const spotAnalyzerName = trip.spot_analyzer_name || v.spot_analyzer_name || v.worker_name || '—';
    let milkKg = '—';
    if (v.milk_quantity_kg !== null && v.milk_quantity_kg !== undefined && v.milk_quantity_kg !== '') {
      milkKg = Number(v.milk_quantity_kg).toFixed(1);
    } else if (v.milk_quantity_liters !== null && v.milk_quantity_liters !== undefined && v.milk_quantity_liters !== '') {
      milkKg = (Number(v.milk_quantity_liters) * 1.03).toFixed(1);
    }

    body.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:1.1rem;font-weight:800;color:#0F172A;">TANKER MILK DESPATCH INVOICE</div>
        <div style="font-size:0.82rem;color:#64748B;margin-top:2px;">Tamil Nadu Co-operative Milk Producers' Federation Ltd.</div>
      </div>

      <div class="inv-detail-grid">
        <div class="inv-detail-item"><div class="lbl">BMC</div><div class="val">${esc(bmcName)} ${bmcCode ? `(${esc(bmcCode)})` : ''}</div></div>
        <div class="inv-detail-item"><div class="lbl">Serial No.</div><div class="val" style="color:#1D4ED8;font-weight:800;">${esc(v.invoice_serial_no || '—')}</div></div>
        <div class="inv-detail-item"><div class="lbl">Tanker Arrival</div><div class="val">${v.visit_start_time ? formatDateTime(v.visit_start_time) : '—'}</div></div>
        <div class="inv-detail-item"><div class="lbl">Tanker Dispatch</div><div class="val">${v.visit_end_time ? formatDateTime(v.visit_end_time) : '—'}</div></div>
        <div class="inv-detail-item"><div class="lbl">Tanker No.</div><div class="val">${esc(trip.tanker_number || '—')}</div></div>
        <div class="inv-detail-item"><div class="lbl">Driver Name</div><div class="val">${esc(trip.driver_name || '—')}</div></div>
        <div class="inv-detail-item"><div class="lbl">Spot Analyzer</div><div class="val">${esc(spotAnalyzerName)}</div></div>
        <div class="inv-detail-item"><div class="lbl">Compartment</div><div class="val">${compDisplay}</div></div>
        <div class="inv-detail-item"><div class="lbl">Contractor/Union</div><div class="val">UNION</div></div>
        <div class="inv-detail-item"><div class="lbl">Destination</div><div class="val">MADURAI AAVIN</div></div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:0.82rem;font-weight:800;color:#334155;margin-bottom:8px;">MILK LOADED BY BMC WITH SEAL DETAILS</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
            <thead>
              <tr style="background:#F1F5F9;">
                <th style="padding:10px;border:1px solid #E2E8F0;font-weight:700;color:#334155;">Compartment</th>
                <th style="padding:10px;border:1px solid #E2E8F0;font-weight:700;color:#334155;">Milk (KG)</th>
                <th style="padding:10px;border:1px solid #E2E8F0;font-weight:700;color:#334155;">Temperature °C</th>
                <th style="padding:10px;border:1px solid #E2E8F0;font-weight:700;color:#334155;">Seal No.</th>
                <th style="padding:10px;border:1px solid #E2E8F0;font-weight:700;color:#334155;">Broken Seal No.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;font-weight:600;">${compDisplay}</td>
                <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;">${milkKg}</td>
                <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;">${v.temperature ?? '—'}${v.temperature ? '°C' : ''}</td>
                <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;">${esc(v.seal_number || '—')}</td>
                <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;">${esc(v.broken_seal_number || '—')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Wire download button
    const dlBtn = document.getElementById('inv-modal-download');
    if (dlBtn) {
      dlBtn.onclick = () => generateInvoicePdf(currentInvoiceData);
    }

  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#DC2626;">Failed to load invoice: ${esc(err.message || String(err))}</div>`;
  }
}
window.openInvoicePreview = openInvoicePreview;

function closeInvoiceModal() {
  const modal = document.getElementById('invoice-preview-modal');
  if (modal) modal.classList.add('hidden');
}
