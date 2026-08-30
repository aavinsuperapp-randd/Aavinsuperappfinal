// eo-invoices.js — Executive Officers Portal: Invoices Tab (Tanker Milk Despatch Advice)

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

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('executive_officer');
  if (!profile) return;

  if (document.getElementById('header-eo-name')) {
    document.getElementById('header-eo-name').textContent = profile.name || 'Executive Officer';
  }

  // Sidebar toggle
  const sidebar = document.getElementById('eo-sidebar');
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

  // Search
  const searchBtn = document.getElementById('invoice-search-btn');
  const searchInput = document.getElementById('invoice-search-input');
  if (searchBtn) searchBtn.addEventListener('click', () => loadInvoices(searchInput?.value.trim()));
  if (searchInput) searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadInvoices(searchInput.value.trim());
  });

  // Modal close
  document.getElementById('inv-modal-close')?.addEventListener('click', closeInvoiceModal);
  document.getElementById('inv-modal-dismiss')?.addEventListener('click', closeInvoiceModal);

  await loadInvoices();
});

async function loadInvoices(searchQuery = '') {
  const tbody = document.getElementById('invoices-table-body');
  const badge = document.getElementById('invoice-count-badge');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="invoice-empty">Loading invoices...</td></tr>';

  try {
    const params = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '';
    const res = await eoFetch(`/api/gm/invoices${params}`);
    const invoices = res.invoices || [];

    if (badge) badge.textContent = invoices.length;

    if (invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="invoice-empty">
        ${searchQuery ? `No invoices found matching "${esc(searchQuery)}"` : 'No invoices generated yet. Invoices are created when Spot Analyzers close BMC visits.'}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = invoices.map((inv, idx) => {
      const dateStr = inv.visit_end_time ? formatDate(inv.visit_end_time) : '—';
      return `
        <tr>
          <td style="text-align:center;font-weight:600;color:#64748B;">${idx + 1}</td>
          <td><strong style="color:#1D4ED8;">${esc(inv.bmc_code || '—')}</strong></td>
          <td><strong>${esc(inv.bmc_name || '—')}</strong></td>
          <td>${dateStr}</td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn-invoice-pdf" onclick="downloadInvoicePdf('${inv.visit_id}')">📄 Download PDF</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load invoices:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="invoice-empty" style="color:#DC2626;">Failed to load invoices: ${esc(err.message || String(err))}</td></tr>`;
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
    const res = await eoFetch(`/api/gm/invoices/${visitId}`);
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
