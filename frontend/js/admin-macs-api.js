// admin-macs-api.js — MACS API Tab Frontend Logic
// Handles: status display, manual sync, data table with pagination, sync history inspection & live delete controls

let currentPage = 1;
const PAGE_SIZE = 50;

// State tracking for deletion modal
let pendingDeleteAction = null;
let currentModalSyncRunId = null;

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

  // Auto-refresh status & sync history every 60 seconds
  setInterval(() => {
    loadMacsApiStatus();
    loadSyncHistory();
  }, 60000);
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
    document.getElementById('status-stored').textContent = status.totalRecordsStored !== undefined ? status.totalRecordsStored : (ls ? ls.records_stored : '—');
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
    const connEl = document.getElementById('status-connection');
    if (connEl) connEl.innerHTML = '<span class="status-dot red"></span> Error loading status';
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

// ─── Sync History & Management ────────────────────────────────────────────────

window.loadSyncHistory = async function() {
  const tbody = document.getElementById('sync-history-tbody');
  if (!tbody) return;

  try {
    const result = await adminFetch('/api/admin/macs-api/sync-history?limit=25');
    
    // Filter out successful syncs that have 0 stored/expired records (deleted data)
    const runs = (result.runs || []).filter(r => {
      if (r.status === 'success') {
        const storedCount = r.currently_stored !== undefined ? r.currently_stored : (r.records_stored || 0);
        return storedCount > 0;
      }
      return true;
    });

    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94A3B8; padding:24px;">No sync runs recorded yet. Click "Sync Now" to start.</td></tr>';
      return;
    }

    tbody.innerHTML = runs.map(r => {
      const time = formatDateTime(r.started_at);
      const badgeClass = r.status === 'success' ? 'success' : (r.status === 'failed' ? 'failed' : 'in_progress');
      const storedCount = r.currently_stored !== undefined ? r.currently_stored : (r.records_stored || 0);

      // Data retention / availability badge
      let dataBadge = '';
      if (r.status === 'success') {
        if (storedCount > 0) {
          dataBadge = `<span class="sync-badge available">● ${storedCount} Live Records</span>`;
        } else {
          dataBadge = `<span class="sync-badge empty">0 Stored / Expired</span>`;
        }
      } else {
        dataBadge = `<span class="sync-badge empty">—</span>`;
      }

      // Stats string
      const stats = r.status === 'success'
        ? `${r.records_fetched || 0} fetched / ${r.records_stored || 0} inserted`
        : '0 records';

      // Message
      const message = r.status === 'failed'
        ? `<span style="color:#DC2626; font-size:0.75rem;">${truncate(r.error_message || 'Fetch failed', 45)}</span>`
        : `<span style="color:#64748B; font-size:0.75rem;">Requested: ${esc(r.requested_date || 'Today')}</span>`;

      // Actions
      const viewBtn = `<button class="btn-action-view" onclick="openSyncReadingsModal('${r.id}')" title="View live readings fetched in this sync">👁️ View Readings</button>`;
      const deleteDisabled = storedCount === 0;
      const deleteBtn = `<button class="btn-action-delete" onclick="confirmDeleteSyncReadings('${r.id}', '${time}', ${storedCount})" ${deleteDisabled ? 'disabled' : ''} title="${deleteDisabled ? 'No live records currently stored' : 'Delete all live records for this sync'}">🗑️ Delete Data</button>`;

      return `
        <tr>
          <td style="font-weight:700; color:#1E293B;">${time}</td>
          <td><span class="sync-badge ${badgeClass}">${r.status}</span></td>
          <td style="font-weight:600; color:#475569;">${stats}</td>
          <td>${dataBadge}</td>
          <td>${message}</td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:6px; align-items:center;">
              ${viewBtn}
              ${deleteBtn}
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#DC2626; padding:24px;">Failed to load sync history: ${err.message}</td></tr>`;
  }
};

// ─── Modal: View Sync Live Readings ───────────────────────────────────────────

window.openSyncReadingsModal = async function(syncRunId) {
  currentModalSyncRunId = syncRunId;
  const modal = document.getElementById('sync-readings-modal');
  const titleEl = document.getElementById('modal-sync-title');
  const subtitleEl = document.getElementById('modal-sync-subtitle');
  const metaEl = document.getElementById('modal-sync-meta');
  const actionsEl = document.getElementById('modal-sync-actions');
  const tbody = document.getElementById('modal-readings-tbody');

  if (!modal || !tbody) return;

  modal.classList.remove('hidden');
  tbody.innerHTML = '<tr><td colspan="18" style="text-align:center; color:#94A3B8; padding:36px; font-weight:600;">Loading live readings...</td></tr>';
  subtitleEl.textContent = `Sync ID: ${syncRunId}`;
  metaEl.textContent = 'Loading sync metadata...';
  actionsEl.innerHTML = '';

  try {
    const result = await adminFetch(`/api/admin/macs-api/sync-history/${syncRunId}/readings`);
    const { syncRun, readings, count } = result;

    const time = formatDateTime(syncRun?.started_at);
    subtitleEl.textContent = `Sync executed at ${time} (${syncRun?.status || 'unknown'})`;
    metaEl.innerHTML = `
      <span>📅 Report Date: <strong>${esc(syncRun?.requested_date || '—')}</strong></span>
      <span style="margin: 0 8px;">•</span>
      <span>📥 Originally Inserted: <strong>${syncRun?.records_stored || 0}</strong></span>
      <span style="margin: 0 8px;">•</span>
      <span>📊 Currently Retained: <strong style="color:${count > 0 ? '#16A34A' : '#DC2626'};">${count} records</strong></span>
    `;

    if (count > 0) {
      actionsEl.innerHTML = `
        <button class="btn-action-delete" style="padding:6px 12px; font-size:0.8rem;" onclick="confirmDeleteSyncReadings('${syncRunId}', '${time}', ${count})">
          🗑️ Delete These ${count} Readings
        </button>
      `;
    } else {
      actionsEl.innerHTML = `<span style="font-size:0.75rem; color:#64748B; font-style:italic;">No live records currently stored</span>`;
    }

    if (!readings || readings.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="18" style="text-align:center; color:#64748B; padding:48px 16px;">
            <div style="font-size:1.8rem; margin-bottom:8px;">📭</div>
            <div style="font-weight:700; color:#1E293B; font-size:0.95rem;">No live MACS records are currently stored for this sync.</div>
            <div style="font-size:0.8rem; color:#64748B; margin-top:4px;">Records may have been manually deleted or automatically removed by the 4-record rolling retention policy.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = readings.map(r => `
      <tr>
        <td style="font-weight:800; color:#2563EB;">${r.macs_bmc_code}</td>
        <td style="font-weight:700; color:#0F172A;">${esc(r.macs_bmc_name || '—')}</td>
        <td style="font-weight:600;">${esc(r.report_date || '—')}</td>
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
        <td style="font-size:0.75rem; color:#64748B;">${formatDateTime(r.fetched_at)}</td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="18" style="text-align:center; color:#DC2626; padding:32px;">Error loading readings: ${err.message}</td></tr>`;
  }
};

window.closeSyncReadingsModal = function() {
  const modal = document.getElementById('sync-readings-modal');
  if (modal) modal.classList.add('hidden');
  currentModalSyncRunId = null;
};

// ─── Delete Confirmation & Execution ──────────────────────────────────────────

window.confirmDeleteSyncReadings = function(syncRunId, syncTime, count) {
  pendingDeleteAction = {
    type: 'sync',
    syncRunId,
    syncTime,
    count
  };

  const modal = document.getElementById('macs-delete-confirm-modal');
  const titleEl = document.getElementById('delete-confirm-title');
  const descEl = document.getElementById('delete-confirm-desc');
  const detailsEl = document.getElementById('delete-confirm-details');

  if (!modal) return;

  titleEl.textContent = 'Delete MACS Live Data for Sync?';
  descEl.textContent = 'This will permanently remove the live MACS readings fetched during this sync.';
  detailsEl.innerHTML = `
    <div><strong>Sync Time:</strong> ${syncTime}</div>
    <div style="margin-top:4px;"><strong>Live Records Affected:</strong> ${count} records</div>
    <div style="margin-top:4px; font-size:0.75rem; color:#64748B;">Sync ID: ${syncRunId}</div>
  `;

  modal.classList.remove('hidden');
};

window.confirmDeleteRow = function(recordId, bmcCode, bmcName) {
  pendingDeleteAction = {
    type: 'row',
    recordId,
    bmcCode,
    bmcName
  };

  const modal = document.getElementById('macs-delete-confirm-modal');
  const titleEl = document.getElementById('delete-confirm-title');
  const descEl = document.getElementById('delete-confirm-desc');
  const detailsEl = document.getElementById('delete-confirm-details');

  if (!modal) return;

  titleEl.textContent = 'Delete Single Live MACS Record?';
  descEl.textContent = 'This will permanently delete this individual BMC snapshot record.';
  detailsEl.innerHTML = `
    <div><strong>BMC Code:</strong> ${bmcCode}</div>
    <div style="margin-top:4px;"><strong>BMC Name:</strong> ${bmcName || '—'}</div>
    <div style="margin-top:4px; font-size:0.75rem; color:#64748B;">Record ID: ${recordId}</div>
  `;

  modal.classList.remove('hidden');
};

window.confirmDeleteAllLiveData = function() {
  pendingDeleteAction = {
    type: 'all'
  };

  const modal = document.getElementById('macs-delete-confirm-modal');
  const titleEl = document.getElementById('delete-confirm-title');
  const descEl = document.getElementById('delete-confirm-desc');
  const detailsEl = document.getElementById('delete-confirm-details');

  if (!modal) return;

  titleEl.textContent = 'Clear ALL Live MACS Data?';
  descEl.textContent = 'This will remove all snapshot records currently stored in macs_api_bmc_data.';
  detailsEl.innerHTML = `
    <div style="color:#DC2626; font-weight:700;">⚠️ Extreme Action: All current live MACS snapshots will be deleted.</div>
    <div style="margin-top:4px;">Historical sync runs and Excel imports will remain safe. Fresh records will arrive on the next 15-minute sync.</div>
  `;

  modal.classList.remove('hidden');
};

window.closeDeleteConfirmModal = function() {
  const modal = document.getElementById('macs-delete-confirm-modal');
  if (modal) modal.classList.add('hidden');
  pendingDeleteAction = null;
};

window.handleConfirmedDelete = async function() {
  if (!pendingDeleteAction) return;

  const btn = document.getElementById('delete-confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Deleting...';
  }

  try {
    if (pendingDeleteAction.type === 'sync') {
      const { syncRunId } = pendingDeleteAction;
      const res = await adminFetch(`/api/admin/macs-api/sync-history/${syncRunId}/readings`, {
        method: 'DELETE'
      });

      if (res.success) {
        showToast(`🗑️ MACS live data deleted (${res.deletedCount || 0} records removed)`, 'success');
      } else {
        showToast(`❌ Error: ${res.error || 'Failed to delete data'}`, 'error');
      }

      // If modal for this sync is open, refresh or close it
      if (currentModalSyncRunId === syncRunId) {
        openSyncReadingsModal(syncRunId);
      }

    } else if (pendingDeleteAction.type === 'row') {
      const { recordId } = pendingDeleteAction;
      const res = await adminFetch(`/api/admin/macs-api/data/${recordId}`, {
        method: 'DELETE'
      });

      if (res.success) {
        showToast('🗑️ Record deleted successfully', 'success');
      } else {
        showToast(`❌ Error: ${res.error || 'Failed to delete record'}`, 'error');
      }

    } else if (pendingDeleteAction.type === 'all') {
      const res = await adminFetch('/api/admin/macs-api/data', {
        method: 'DELETE'
      });

      if (res.success) {
        showToast(`🗑️ All live MACS data cleared (${res.deletedCount || 0} records removed)`, 'success');
      } else {
        showToast(`❌ Error: ${res.error || 'Failed to clear live data'}`, 'error');
      }

      closeSyncReadingsModal();
    }

    closeDeleteConfirmModal();

    // Refresh UI without page reload
    await Promise.all([
      loadMacsApiStatus(),
      loadSyncHistory(),
      loadMacsApiData(currentPage)
    ]);

  } catch (err) {
    showToast(`❌ Delete failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🗑️ Delete Live Data';
    }
  }
};

// ─── Main Live Data Table ─────────────────────────────────────────────────────

window.loadMacsApiData = async function(page) {
  currentPage = page;
  const tbody = document.getElementById('macs-data-tbody');
  const pageInfo = document.getElementById('data-page-info');
  const pagination = document.getElementById('macs-pagination');

  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="19" style="text-align:center; color:#94A3B8; padding:32px; font-weight:600;">Loading...</td></tr>';

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
      tbody.innerHTML = '<tr><td colspan="19" style="text-align:center; color:#94A3B8; padding:40px; font-weight:600;">No live MACS data currently stored in database. Click "Sync Now" to fetch latest data.</td></tr>';
      if (pagination) pagination.innerHTML = '';
      return;
    }

    // Render table rows with row-level delete button
    tbody.innerHTML = records.map(r => {
      const fetchTime = formatDateTime(r.fetched_at);
      const bmcName = esc(r.macs_bmc_name || '');
      return `
        <tr>
          <td style="font-weight:600; color:#64748B; font-size:0.78rem;">${fetchTime}</td>
          <td style="font-weight:700;">${esc(r.report_date || '—')}</td>
          <td style="font-weight:800; color:#2563EB;">${r.macs_bmc_code}</td>
          <td style="font-weight:700; color:#0F172A;">${bmcName || '—'}</td>
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
          <td style="text-align:center;">
            <button class="btn-action-delete" onclick="confirmDeleteRow('${r.id}', '${r.macs_bmc_code}', '${bmcName}')" title="Delete this single snapshot record">
              🗑️
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Render pagination
    renderPagination(pagination, page, totalPages);

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="19" style="text-align:center; color:#DC2626; padding:32px; font-weight:600;">Failed to load data: ${err.message}</td></tr>`;
  }
};

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

// ─── Sub-Tab Navigation ──────────────────────────────────────────────────────

window.switchMacsSubTab = function(tabName) {
  const liveContainer = document.getElementById('live-macs-container');
  const dailyContainer = document.getElementById('daily-macs-container');
  const btnLive = document.getElementById('tab-btn-live-macs');
  const btnDaily = document.getElementById('tab-btn-daily-macs');

  if (tabName === 'daily') {
    if (liveContainer) liveContainer.classList.add('hidden');
    if (dailyContainer) dailyContainer.classList.remove('hidden');
    if (btnLive) {
      btnLive.classList.remove('active');
      btnLive.style.borderBottomColor = 'transparent';
      btnLive.style.color = '#64748B';
    }
    if (btnDaily) {
      btnDaily.classList.add('active');
      btnDaily.style.borderBottomColor = '#2563EB';
      btnDaily.style.color = '#2563EB';
    }
    loadDailySnapshots();
  } else {
    if (dailyContainer) dailyContainer.classList.add('hidden');
    if (liveContainer) liveContainer.classList.remove('hidden');
    if (btnDaily) {
      btnDaily.classList.remove('active');
      btnDaily.style.borderBottomColor = 'transparent';
      btnDaily.style.color = '#64748B';
    }
    if (btnLive) {
      btnLive.classList.add('active');
      btnLive.style.borderBottomColor = '#2563EB';
      btnLive.style.color = '#2563EB';
    }
  }
};

// ─── Daily MACS Snapshots List ───────────────────────────────────────────────

let dailySnapshotModalRecords = [];

window.loadDailySnapshots = async function() {
  const tbody = document.getElementById('daily-snapshots-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:24px;">Loading daily MACS snapshots...</td></tr>';

  try {
    const res = await adminFetch('/api/admin/macs-api/daily-snapshots');
    if (!res.success || !res.snapshots || res.snapshots.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:24px;">No 23:55 daily MACS snapshots saved yet. Daily snapshots are fetched every night at 23:55:00.</td></tr>';
      return;
    }

    tbody.innerHTML = res.snapshots.map(s => {
      const dateStr = esc(s.requested_date);
      const timeStr = s.started_at ? formatTimeOnly(s.started_at) : '23:55:00';
      const bmcCount = s.currently_stored !== undefined ? s.currently_stored : (s.records_stored || 0);

      return `
        <tr>
          <td style="font-weight:700; color:#1E293B;">📅 ${dateStr}</td>
          <td style="font-weight:600; color:#475569;">⏰ ${timeStr}</td>
          <td style="font-weight:700; color:#2563EB;">🏭 ${bmcCount} BMCs</td>
          <td><span class="sync-badge success">● Saved Permanently</span></td>
          <td style="text-align:right;">
            <button class="btn-action-view" onclick="openDailySnapshotModal('${dateStr}')" style="background:#2563EB; color:#FFF; border-color:#2563EB;">
              👁️ View Saved MACS Data
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading daily MACS snapshots:', err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#DC2626; padding:24px;">Failed to load daily MACS snapshots: ${esc(err.message)}</td></tr>`;
  }
};

// ─── Daily MACS Snapshot Detail Modal ────────────────────────────────────────

window.openDailySnapshotModal = async function(dateStr) {
  const modal = document.getElementById('daily-snapshot-detail-modal');
  const dateTitle = document.getElementById('daily-modal-date-title');
  const tbody = document.getElementById('daily-modal-tbody');
  const countBadge = document.getElementById('daily-modal-count-badge');
  const searchInput = document.getElementById('daily-modal-search');

  if (!modal || !tbody) return;

  if (dateTitle) dateTitle.textContent = dateStr;
  if (searchInput) searchInput.value = '';
  tbody.innerHTML = '<tr><td colspan="17" style="text-align:center; color:#94A3B8; padding:32px;">Loading 23:55 saved snapshot records...</td></tr>';
  if (countBadge) countBadge.textContent = 'Loading...';

  modal.classList.remove('hidden');

  try {
    const res = await adminFetch(`/api/admin/macs-api/daily-snapshots/${encodeURIComponent(dateStr)}`);
    if (!res.success || !res.records) {
      tbody.innerHTML = `<tr><td colspan="17" style="text-align:center; color:#DC2626; padding:32px;">${esc(res.error || 'Failed to load records')}</td></tr>`;
      return;
    }

    dailySnapshotModalRecords = res.records;
    renderDailyModalRows(dailySnapshotModalRecords);

  } catch (err) {
    console.error('Error fetching snapshot detail:', err);
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center; color:#DC2626; padding:32px;">Error: ${esc(err.message)}</td></tr>`;
  }
};

window.closeDailySnapshotModal = function() {
  const modal = document.getElementById('daily-snapshot-detail-modal');
  if (modal) modal.classList.add('hidden');
  dailySnapshotModalRecords = [];
};

function renderDailyModalRows(records) {
  const tbody = document.getElementById('daily-modal-tbody');
  const countBadge = document.getElementById('daily-modal-count-badge');

  if (countBadge) countBadge.textContent = `${records.length} BMC Records`;

  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" style="text-align:center; color:#94A3B8; padding:32px;">No matching MACS records found.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map((r, idx) => {
    const bmcCode = esc(r.macs_bmc_code || '—');
    const bmcName = esc(r.bmc_master_name || r.macs_bmc_name || '—');
    const reportDate = esc(r.report_date || '—');
    const fetchTime = r.fetched_at ? formatTimeOnly(r.fetched_at) : '23:55:00';

    return `
      <tr>
        <td style="font-weight:600; color:#64748B;">${idx + 1}</td>
        <td style="font-weight:700; color:#2563EB;">${bmcCode}</td>
        <td style="font-weight:700; color:#0F172A;">${bmcName}</td>
        <td style="font-weight:600; color:#475569;">${reportDate}</td>
        <td style="font-weight:600; color:#059669;">${fetchTime}</td>
        <td>${fmtNum(r.li_t1)}</td>
        <td>${fmtNum(r.fat_t1)}</td>
        <td>${fmtNum(r.snf_t1)}</td>
        <td>${fmtNum(r.li_t2)}</td>
        <td>${fmtNum(r.fat_t2)}</td>
        <td>${fmtNum(r.snf_t2)}</td>
        <td>${fmtNum(r.so_c1)}</td>
        <td>${fmtNum(r.so_c2)}</td>
        <td style="font-weight:700; color:#1E293B;">${fmtNum(r.lit)}</td>
        <td>${fmtNum(r.kgfat_t1)}</td>
        <td>${fmtNum(r.kgsnf_t1)}</td>
        <td>${fmtNum(r.diff)}</td>
      </tr>
    `;
  }).join('');
}

window.filterDailyModalTable = function() {
  const query = (document.getElementById('daily-modal-search')?.value || '').toLowerCase().trim();
  if (!query) {
    renderDailyModalRows(dailySnapshotModalRecords);
    return;
  }

  const filtered = dailySnapshotModalRecords.filter(r => {
    const code = String(r.macs_bmc_code || '').toLowerCase();
    const name = String(r.bmc_master_name || r.macs_bmc_name || '').toLowerCase();
    return code.includes(query) || name.includes(query);
  });

  renderDailyModalRows(filtered);
};

function formatTimeOnly(isoStr) {
  if (!isoStr) return '23:55:00';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoStr;
  }
}
