// transport-macs.js — Transport Officer MACS Data Overview (QC Manager Table View)
let allMacsBmcs = [];
let currentSelectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let currentSelectedPeriod = 'both';

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  if (document.getElementById('header-to-name')) {
    document.getElementById('header-to-name').textContent = profile.name || 'Transport Officer';
  }

  // Setup Logout Button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Setup Date Filter
  const dateInput = document.getElementById('macs-date-filter');
  if (dateInput) {
    dateInput.value = currentSelectedDate;
    dateInput.addEventListener('change', (e) => {
      currentSelectedDate = e.target.value;
      loadMacsData();
    });
  }

  // Setup Batch / Period Filter Buttons
  const periodBtns = document.querySelectorAll('.date-preset-btn[data-period]');
  periodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      periodBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSelectedPeriod = btn.getAttribute('data-period') || 'all';
      loadMacsData();
    });
  });

  // Setup Search Input
  const searchInput = document.getElementById('macs-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderMacsTables(searchInput.value.trim());
    });
  }

  // Refresh Button
  const btnRefresh = document.getElementById('btn-refresh-macs');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => loadMacsData());
  }

  await loadMacsData();
});

async function loadMacsData() {
  const tbody = document.getElementById('macs-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:28px;">Loading MACS data...</td></tr>';
  }

  try {
    const data = await apiFetchMacsSummary({
      date: currentSelectedDate,
      period: currentSelectedPeriod
    });

    if (data.date) {
      currentSelectedDate = data.date;
      const dateInput = document.getElementById('macs-date-filter');
      if (dateInput) dateInput.value = data.date;

      const dateSub = document.getElementById('macs-date-subtitle');
      if (dateSub) dateSub.textContent = `MACS laboratory & collection readings for ${data.date}`;
    }

    allMacsBmcs = data.bmcs || [];

    // Update KPI Summary Cards
    const summary = data.summary || {};
    document.getElementById('kpi-total-bmcs').textContent = summary.total_bmcs || 0;
    document.getElementById('kpi-matched-bmcs').textContent = summary.matched_bmcs || 0;
    document.getElementById('kpi-total-kg').textContent = `${(summary.total_kg || 0).toLocaleString()} KG`;
    document.getElementById('kpi-total-liters').textContent = `${(summary.total_liters || 0).toLocaleString()} L`;

    renderMacsTables(document.getElementById('macs-search-input')?.value.trim() || '');
  } catch (err) {
    console.error('Failed to load MACS data:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger" style="padding:28px;">❌ ${err.message || 'Failed to fetch MACS data.'}</td></tr>`;
    }
  }
}

function renderMacsTables(query = '') {
  const tbody1 = document.getElementById('macs-table-body');
  const tbody2 = document.getElementById('no-macs-table-body');
  const countBadge = document.getElementById('macs-row-count-badge');
  if (!tbody1) return;

  const filtered = allMacsBmcs.filter(b =>
    !query ||
    (b.bmc_name || '').toLowerCase().includes(query.toLowerCase()) ||
    (b.bmc_code || '').toLowerCase().includes(query.toLowerCase()) ||
    (b.location || '').toLowerCase().includes(query.toLowerCase())
  );

  const matchedList = filtered.filter(b => b.has_macs_data);
  const noMacsList = filtered.filter(b => !b.has_macs_data);

  if (countBadge) {
    countBadge.textContent = `${matchedList.length} Matched Record${matchedList.length === 1 ? '' : 's'}`;
  }

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  // Render Table 1: Matched MACS Readings
  if (matchedList.length === 0) {
    tbody1.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:28px;">No matching MACS data available for selected criteria.</td></tr>';
  } else {
    tbody1.innerHTML = matchedList.map(b => {
      const macsStr = (b.capacity_litre !== null && b.capacity_litre !== undefined)
        ? `<div style="font-size:0.9rem; font-weight:800; color:#1E3A8A;">🥛 ${b.capacity_litre.toLocaleString()} L <span style="font-size:0.78rem; color:#475569; font-weight:700;">(${b.capacity_kg ? b.capacity_kg.toLocaleString() : '-'} KG)</span></div>`
        : dash;

      return `
        <tr style="transition: background 0.15s ease;">
          <td style="padding:14px 18px; font-weight:800; color:#0F172A;">${b.bmc_code}</td>
          <td style="padding:14px 18px;">
            <strong style="font-size:0.95rem; color:#0F172A;">🏢 ${b.bmc_name}</strong>
            ${b.location ? `<div style="font-size:0.78rem; color:#64748B;">📍 ${b.location}</div>` : ''}
          </td>
          <td style="padding:14px 18px;">${macsStr}</td>
          <td style="padding:14px 18px;">${dash}</td>
          <td style="padding:14px 18px;">${dash}</td>
          <td style="padding:14px 18px;">
            <span class="badge badge-success" style="font-size:0.78rem; font-weight:700;">✓ MATCHED</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Table 2: No MACS Data
  if (!tbody2) return;

  if (noMacsList.length === 0) {
    tbody2.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:28px; color:#92400E;">All active BMCs have MACS lab data recorded.</td></tr>';
  } else {
    tbody2.innerHTML = noMacsList.map(b => {
      return `
        <tr style="transition: background 0.15s ease;">
          <td style="padding:14px 18px; font-weight:800; color:#92400E;">${b.bmc_code}</td>
          <td style="padding:14px 18px;">
            <strong style="font-size:0.95rem; color:#0F172A;">🏢 ${b.bmc_name}</strong>
            ${b.location ? `<div style="font-size:0.78rem; color:#64748B;">📍 ${b.location}</div>` : ''}
          </td>
          <td style="padding:14px 18px;">${dash}</td>
          <td style="padding:14px 18px;">${dash}</td>
          <td style="padding:14px 18px;">
            <span class="badge badge-warning" style="font-size:0.78rem; font-weight:700;">⚠️ NO MACS DATA</span>
          </td>
        </tr>
      `;
    }).join('');
  }
}
