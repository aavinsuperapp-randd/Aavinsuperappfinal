/**
 * AAVIN Admin — WhatsApp Monitoring Dashboard JavaScript
 * Fetches WhatsApp send logs and summary from backend API.
 * Renders summary cards and recent activity table.
 */

// ─── State ─────────────────────────────────────────────────────────────────────
let waRefreshTimer = null;
const WA_REFRESH_INTERVAL = 30000; // 30 seconds

// ─── API Helpers ────────────────────────────────────────────────────────────────

function getAuthHeaders() {
  const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

function getApiBase() {
  // Use relative URL (same origin)
  return '';
}

// ─── Data Fetchers ──────────────────────────────────────────────────────────────

async function fetchWhatsAppSummary() {
  try {
    const res = await fetch(`${getApiBase()}/api/admin/whatsapp/summary`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('WhatsApp summary fetch error:', err);
    return null;
  }
}

async function fetchWhatsAppLogs(page = 1, limit = 50) {
  try {
    const res = await fetch(`${getApiBase()}/api/admin/whatsapp/logs?page=${page}&limit=${limit}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('WhatsApp logs fetch error:', err);
    return null;
  }
}

// ─── Renderers ──────────────────────────────────────────────────────────────────

function renderSummaryCards(summary) {
  if (!summary || !summary.success) {
    document.getElementById('wa-total-attempts').textContent = '—';
    document.getElementById('wa-success-count').textContent = '—';
    document.getElementById('wa-failed-count').textContent = '—';
    document.getElementById('wa-current-session').textContent = '—';
    document.getElementById('wa-recent-batch').textContent = '—';
    document.getElementById('wa-last-send-time').textContent = '—';
    return;
  }

  document.getElementById('wa-total-attempts').textContent = summary.totalAttempts;
  document.getElementById('wa-success-count').textContent = summary.successCount;
  document.getElementById('wa-failed-count').textContent = summary.failedCount;

  // Current session
  const sessionEl = document.getElementById('wa-current-session');
  if (summary.fetchJobRunning && summary.currentSession) {
    sessionEl.textContent = summary.currentSession === 'morning' ? '🌅 Morning' : '🌙 Evening';
    sessionEl.className = 'wa-status-value info';
  } else if (summary.currentSession) {
    sessionEl.textContent = summary.currentSession === 'morning' ? 'Morning' : 'Evening';
    sessionEl.className = 'wa-status-value';
  } else {
    sessionEl.textContent = 'No activity';
    sessionEl.className = 'wa-status-value muted';
  }

  // Recent batch
  const batchEl = document.getElementById('wa-recent-batch');
  if (summary.fetchJobRunning && summary.fetchJobCurrentBatch) {
    batchEl.textContent = `Batch ${summary.fetchJobCurrentBatch}/${summary.fetchJobTotalBatches} (Running)`;
    batchEl.className = 'wa-status-value info';
  } else if (summary.recentBatch) {
    batchEl.textContent = `Batch ${summary.recentBatch}`;
    batchEl.className = 'wa-status-value';
  } else {
    batchEl.textContent = '—';
    batchEl.className = 'wa-status-value muted';
  }

  // Last send time
  const timeEl = document.getElementById('wa-last-send-time');
  if (summary.lastSendTime) {
    const d = new Date(summary.lastSendTime);
    timeEl.textContent = d.toLocaleString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' });
    timeEl.className = 'wa-status-value';
  } else {
    timeEl.textContent = '—';
    timeEl.className = 'wa-status-value muted';
  }

  // Color-code the counts
  const successEl = document.getElementById('wa-success-count');
  const failedEl = document.getElementById('wa-failed-count');
  successEl.className = 'wa-status-value' + (summary.successCount > 0 ? ' success' : '');
  failedEl.className = 'wa-status-value' + (summary.failedCount > 0 ? ' error' : '');
}

function renderActivityTable(logsData) {
  const tbody = document.getElementById('wa-activity-tbody');
  if (!logsData || !logsData.success || !logsData.logs || logsData.logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94A3B8; padding:32px; font-weight:600;">No WhatsApp activity found for today.</td></tr>';
    document.getElementById('wa-page-info').textContent = '';
    return;
  }

  const rows = logsData.logs.map(log => {
    const time = log.created_at ? new Date(log.created_at).toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const sessionLabel = log.session === 'morning' ? '🌅 Morning' : (log.session === 'evening' ? '🌙 Evening' : (log.session || '—'));
    const statusBadge = log.status === 'SUCCESS'
      ? '<span class="wa-badge success">SUCCESS</span>'
      : '<span class="wa-badge failed">FAILED</span>';
    const errorCell = log.status === 'FAILED' && log.error_message
      ? `<span class="wa-error-text" title="${escapeHtml(log.error_message)}">${escapeHtml(truncate(log.error_message, 40))}</span>`
      : '—';

    return `<tr>
      <td>${escapeHtml(log.society_name || log.society_code || '—')}</td>
      <td>${log.bmc_code || '—'}</td>
      <td>${sessionLabel}</td>
      <td>${log.batch_number || '—'}</td>
      <td>${statusBadge}</td>
      <td>${time}</td>
      <td>${errorCell}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;

  // Page info
  const pageInfo = document.getElementById('wa-page-info');
  if (logsData.totalPages > 1) {
    pageInfo.textContent = `Page ${logsData.page} of ${logsData.totalPages} (${logsData.total} total)`;
  } else {
    pageInfo.textContent = logsData.total > 0 ? `${logsData.total} records` : '';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

// ─── Main Load Function ─────────────────────────────────────────────────────────

async function loadWhatsAppDashboard() {
  const [summary, logs] = await Promise.all([
    fetchWhatsAppSummary(),
    fetchWhatsAppLogs(1, 50)
  ]);

  renderSummaryCards(summary);
  renderActivityTable(logs);

  // Auto-refresh if a fetch job is running
  if (summary && summary.fetchJobRunning) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

function startAutoRefresh() {
  if (waRefreshTimer) return;
  waRefreshTimer = setInterval(() => {
    loadWhatsAppDashboard();
  }, WA_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (waRefreshTimer) {
    clearInterval(waRefreshTimer);
    waRefreshTimer = null;
  }
}

function handleRefreshWhatsApp() {
  loadWhatsAppDashboard();
}

// ─── Initialize ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wait for auth check to complete, then load
  setTimeout(() => {
    loadWhatsAppDashboard();
  }, 500);
});
