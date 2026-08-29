// admin-macs-api.js — MACS API Tab Frontend Logic
// Handles: status display, manual sync, data table with pagination, sync history

let currentPage = 1;
const PAGE_SIZE = 50;

document.addEventListener('DOMContentLoaded', async () => {
  // Auth is handled by admin.js which runs before this script

  // Check if we're on the MACS API page
  if (!document.getElementById('macs-data-table')) return;

  // Load initial data
  await Promise.all([
    loadMacsApiStatus(),
    loadMacsApiData(1),
    loadSyncHistory()
  ]);

  // Auto-refresh status every 60 seconds
  setInterval(loadMacsApiStatus, 60000);
});

// ─── Status Panel ─────────────────────────────────────────────────────────────

async function loadMacsApiStatus() {
  try {
    const status = await adminFetch('/api/admin/macs-api/status');

    // Connection status
    const connEl = document.getElementById('status-connection');
    if (status.schedulerRunning) {
      if (status.lastSuccessfulSync) {
        connEl.innerHTML = '<span class="status-dot green"></span> Connected';
        connEl.className = 'macs-status-value success';
      } else if (status.lastSync && status.lastSync.status === 'failed') {
        connEl.innerHTML = '<span class="status-dot red"></span> Error';
        connEl.className = 'macs-status-value error';
      } else {
        connEl.innerHTML = '<span class="status-dot yellow"></span> Waiting...';
        connEl.className = 'macs-status-value pending';
      }
    } else {
      connEl.innerHTML = '<span class="status-dot red"></span> Scheduler Stopped';
      connEl.className = 'macs-status-value error';
    }

    // Last successful sync
    const lastSyncEl = document.getElementById('status-last-sync');
    if (status.lastSuccessfulSync && status.lastSuccessfulSync.completed_at) {
      lastSyncEl.textContent = formatDateTime(status.lastSuccessfulSync.completed_at);
      lastSyncEl.className = 'macs-status-value success';
    } else {
      lastSyncEl.textContent = 'No successful sync yet';
      lastSyncEl.className = 'macs-status-value pending';
    }

    // Next sync
    const nextSyncEl = document.getElementById('status-next-sync');
    if (status.nextSyncTime) {
      nextSyncEl.textContent = formatDateTime(status.nextSyncTime);
    } else {
      nextSyncEl.textContent = '—';
    }

    // Records fetched / stored / skipped (from last successful sync)
    const ls = status.lastSuccessfulSync;
    document.getElementById('status-fetched').textContent = ls ? ls.records_fetched : '—';
    document.getElementById('status-stored').textContent = ls ? ls.records_stored : '—';
    document.getElementById('status-skipped').textContent = ls ? ls.records_skipped : '—';

    // Total sync runs
    document.getElementById('status-total-syncs').textContent = status.totalSyncRuns || 0;

    // Last error
    const errorEl = document.getElementById('status-last-error');
    if (status.lastSync && status.lastSync.status === 'failed' && status.lastSync.error_message) {
      errorEl.textContent = status.lastSync.error_message;
      errorEl.className = 'macs-status-value error';
    } else {
      errorEl.textContent = 'None';
      errorEl.className = 'macs-status-value success';
    }

  } catch (err) {
    console.error('Failed to load MACS API status:', err);
    document.getElementById('status-connection').innerHTML = '<span class="status-dot red"></span> Error loading status';
  }
}

// ─── Manual Sync ──────────────────────────────────────────────────────────────

window.handleManualSync = async function() {
  const btn = document.getElementById('macs-sync-btn');
  if (!btn) return;

  btn.disabled = true;
  btn.classList.add('syncing');
  btn.innerHTML = '⏳ Syncing...';

  try {
    const result = await adminFetch('/api/admin/macs-api/sync', { method: 'POST' });

    if (result.success) {
      showToast(`✅ Sync complete — ${result.recordsFetched} fetched, ${result.recordsStored} stored`, 'success');
    } else {
      showToast(`❌ Sync failed: ${result.error}`, 'error');
    }

    // Refresh everything
    await Promise.all([
      loadMacsApiStatus(),
      loadMacsApiData(1),
      loadSyncHistory()
    ]);

  } catch (err) {
    showToast(`❌ Sync error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
    btn.innerHTML = '🔄 Sync Now';
  }
};

// ─── Sync History ─────────────────────────────────────────────────────────────

async function loadSyncHistory() {
  const container = document.getElementById('sync-history-list');
  if (!container) return;

  try {
    const result = await adminFetch('/api/admin/macs-api/sync-history?limit=15');
    const runs = result.runs || [];

    if (runs.length === 0) {
      container.innerHTML = '<div style="color:#94A3B8; font-size:0.82rem; padding:8px 0;">No sync runs yet. Click "Sync Now" to start.</div>';
      return;
    }

    container.innerHTML = runs.map(r => {
      const time = formatDateTime(r.started_at);
      const badgeClass = r.status === 'success' ? 'success' : (r.status === 'failed' ? 'failed' : 'in_progress');
      const stats = r.status === 'success'
        ? `<span style="color:#64748B;">${r.records_fetched} fetched, ${r.records_stored} stored, ${r.records_skipped} skipped</span>`
        : (r.error_message ? `<span style="color:#DC2626; font-size:0.75rem;">${truncate(r.error_message, 60)}</span>` : '');

      return `
        <div class="sync-history-row">
          <span class="sync-badge ${badgeClass}">${r.status}</span>
          <span style="color:#334155; font-weight:600;">${time}</span>
          ${stats}
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<div style="color:#DC2626; font-size:0.82rem;">Failed to load: ${err.message}</div>`;
  }
}

// ─── Data Table ───────────────────────────────────────────────────────────────

async function loadMacsApiData(page) {
  currentPage = page;
  const tbody = document.getElementById('macs-data-tbody');
  const pageInfo = document.getElementById('data-page-info');
  const pagination = document.getElementById('macs-pagination');

  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="18" style="text-align:center; color:#94A3B8; padding:32px; font-weight:600;">Loading...</td></tr>';

  try {
    const result = await adminFetch(`/api/admin/macs-api/data?page=${page}&limit=${PAGE_SIZE}`);
    const records = result.data || [];
    const total = result.total || 0;
    const totalPages = result.totalPages || 1;

    // Update page info
    if (pageInfo) {
      const from = total > 0 ? ((page - 1) * PAGE_SIZE) + 1 : 0;
      const to = Math.min(page * PAGE_SIZE, total);
      pageInfo.textContent = `Showing ${from}–${to} of ${total} records`;
    }

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="18" style="text-align:center; color:#94A3B8; padding:40px; font-weight:600;">No MACS API data yet. Click "Sync Now" to fetch data from MACS.</td></tr>';
      if (pagination) pagination.innerHTML = '';
      return;
    }

    // Render table rows
    tbody.innerHTML = records.map(r => {
      const fetchTime = formatDateTime(r.fetched_at);
      return `
        <tr>
          <td style="font-weight:600; color:#64748B; font-size:0.78rem;">${fetchTime}</td>
          <td style="font-weight:700;">${esc(r.report_date || '—')}</td>
          <td style="font-weight:800; color:#2563EB;">${r.macs_bmc_code}</td>
          <td style="font-weight:700; color:#0F172A;">${esc(r.macs_bmc_name || '—')}</td>
          <td style="font-weight:700; color:#1E3A8A;">${fmtNum(r.li_t1)}</td>
          <td>${fmtNum(r.fat_t1)}</td>
          <td>${fmtNum(r.snf_t1)}</td>
          <td style="font-weight:700; color:#1E3A8A;">${fmtNum(r.li_t2)}</td>
          <td>${fmtNum(r.fat_t2)}</td>
          <td>${fmtNum(r.snf_t2)}</td>
          <td style="color:#64748B;">${esc(r.so_c1 || '—')}</td>
          <td style="color:#64748B;">${esc(r.so_c2 || '—')}</td>
          <td style="color:#64748B;">${fmtNum(r.lit)}</td>
          <td style="color:#64748B;">${fmtNum(r.kgfat_t1)}</td>
          <td style="color:#64748B;">${fmtNum(r.kgsnf_t1)}</td>
          <td style="color:#64748B;">${fmtNum(r.kgfat_t2)}</td>
          <td style="color:#64748B;">${fmtNum(r.kgsnf_t2)}</td>
          <td style="color:#64748B;">${fmtNum(r.diff)}</td>
        </tr>
      `;
    }).join('');

    // Render pagination
    renderPagination(pagination, page, totalPages);

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="18" style="text-align:center; color:#DC2626; padding:32px; font-weight:600;">Failed to load data: ${err.message}</td></tr>`;
  }
}

function renderPagination(container, current, total) {
  if (!container || total <= 1) {
    if (container) container.innerHTML = '';
    return;
  }

  let html = '';

  // Prev button
  html += `<button ${current <= 1 ? 'disabled' : ''} onclick="loadMacsApiData(${current - 1})">← Prev</button>`;

  // Page numbers (show up to 7 pages centered on current)
  const maxPages = 7;
  let startPage = Math.max(1, current - Math.floor(maxPages / 2));
  let endPage = Math.min(total, startPage + maxPages - 1);
  if (endPage - startPage + 1 < maxPages) {
    startPage = Math.max(1, endPage - maxPages + 1);
  }

  if (startPage > 1) {
    html += `<button onclick="loadMacsApiData(1)">1</button>`;
    if (startPage > 2) html += `<span class="page-info">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="${i === current ? 'active' : ''}" onclick="loadMacsApiData(${i})">${i}</button>`;
  }

  if (endPage < total) {
    if (endPage < total - 1) html += `<span class="page-info">...</span>`;
    html += `<button onclick="loadMacsApiData(${total})">${total}</button>`;
  }

  // Next button
  html += `<button ${current >= total ? 'disabled' : ''} onclick="loadMacsApiData(${current + 1})">Next →</button>`;

  container.innerHTML = html;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoStr;
  }
}

function fmtNum(val) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toString() : n.toFixed(3);
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}
