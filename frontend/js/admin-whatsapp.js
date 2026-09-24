/**
 * AAVIN Admin — WhatsApp History Dashboard JavaScript
 * READ-ONLY dashboard: fetches historical job/send data from backend APIs.
 * Does NOT trigger any fetches, sends, or state changes.
 */

// ─── State ─────────────────────────────────────────────────────────────────────
let whCurrentSession = 'morning';
let whListPage = 1;
let whDetailJobId = null;
let whDetailPage = 1;
let whDetailFilter = '';

// ─── Session Toggle ─────────────────────────────────────────────────────────────

function switchSession(session) {
  whCurrentSession = session;
  whListPage = 1;

  // Toggle active button
  document.querySelectorAll('.wh-session-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.session === session);
  });

  // Close detail view if open
  closeDetail();

  // Reload list
  loadJobList();
}

// ─── Job List ───────────────────────────────────────────────────────────────────

async function loadJobList() {
  const listEl = document.getElementById('wh-job-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="wh-loading">Loading history...</div>';

  try {
    const result = await adminFetch(
      `/api/admin/whatsapp/history?session=${whCurrentSession}&page=${whListPage}&limit=10`
    );

    if (!result.success || !result.jobs || result.jobs.length === 0) {
      listEl.innerHTML = `
        <div class="wh-empty-state">
          <div class="icon">📭</div>
          <div>No WhatsApp history found for ${whCurrentSession === 'morning' ? 'Morning' : 'Evening'} session.</div>
        </div>
      `;
      document.getElementById('wh-list-pagination').innerHTML = '';
      return;
    }

    listEl.innerHTML = result.jobs.map(job => {
      const dateDisplay = formatJobDate(job.jobDate);
      const sessionLabel = job.session === 'morning' ? '☀️ Morning' : '🌙 Evening';
      const startTime = job.startedAt ? formatTime(job.startedAt) : '—';
      const endTime = job.completedAt ? formatTime(job.completedAt) : '—';
      const statusClass = job.status || 'unknown';

      return `
        <div class="wh-job-card" onclick="openJobDetail('${job.id}')" data-job-id="${job.id}">
          <div class="wh-job-card-left">
            <div class="wh-job-date">${dateDisplay}</div>
            <div class="wh-job-meta">
              <span>${sessionLabel}</span>
              <span>Started: ${startTime}</span>
              ${endTime !== '—' ? `<span>Ended: ${endTime}</span>` : ''}
              <span>Batches: ${job.currentBatch || 0}/${job.totalBatches || 9}</span>
            </div>
          </div>
          <span class="wh-job-status ${statusClass}">${job.status || 'unknown'}</span>
        </div>
      `;
    }).join('');

    // Render pagination
    renderPagination(
      document.getElementById('wh-list-pagination'),
      result.page,
      result.totalPages,
      (p) => { whListPage = p; loadJobList(); }
    );

  } catch (err) {
    console.error('WhatsApp history list error:', err);
    listEl.innerHTML = `
      <div class="wh-empty-state">
        <div class="icon">⚠️</div>
        <div>Failed to load history: ${escapeHtml(err.message)}</div>
      </div>
    `;
  }
}

// ─── Job Detail ─────────────────────────────────────────────────────────────────

async function openJobDetail(jobId) {
  whDetailJobId = jobId;
  whDetailPage = 1;
  whDetailFilter = '';

  // Highlight active card
  document.querySelectorAll('.wh-job-card').forEach(c => {
    c.classList.toggle('active', c.dataset.jobId === jobId);
  });

  // Show detail view
  document.getElementById('wh-detail-view').style.display = '';

  // Reset filter pills
  document.querySelectorAll('.wh-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === '');
  });

  // Load detail data
  await Promise.all([
    loadJobSummary(jobId),
    loadJobLogs(jobId)
  ]);

  // Scroll to detail
  document.getElementById('wh-detail-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDetail() {
  whDetailJobId = null;
  document.getElementById('wh-detail-view').style.display = 'none';
  document.querySelectorAll('.wh-job-card').forEach(c => c.classList.remove('active'));
}

async function loadJobSummary(jobId) {
  const titleEl = document.getElementById('wh-detail-title');
  const infoEl = document.getElementById('wh-detail-info');
  const summaryEl = document.getElementById('wh-detail-summary');

  titleEl.textContent = 'Loading...';
  infoEl.textContent = '';
  summaryEl.innerHTML = '';

  try {
    const result = await adminFetch(`/api/admin/whatsapp/history/${jobId}`);

    if (!result.success) {
      titleEl.textContent = 'Error';
      infoEl.textContent = result.error || 'Failed to load job detail.';
      return;
    }

    const job = result.job;
    const ws = result.whatsappSummary;

    // Title
    const dateDisplay = formatJobDate(job.jobDate);
    const sessionLabel = job.session === 'morning' ? '☀️ Morning' : '🌙 Evening';
    titleEl.textContent = `${dateDisplay} — ${sessionLabel}`;

    // Info bar
    const startTime = job.startedAt ? formatDateTime(job.startedAt) : '—';
    const endTime = job.completedAt ? formatDateTime(job.completedAt) : '—';
    const statusBadge = `<span class="wh-job-status ${job.status}" style="margin-left:8px;">${job.status}</span>`;
    infoEl.innerHTML = `Started: ${startTime} · Ended: ${endTime} · Batches: ${job.currentBatch}/${job.totalBatches} ${statusBadge}`;

    // Summary cards
    summaryEl.innerHTML = `
      <div class="wh-summary-card border-info">
        <div class="label">Total Logged</div>
        <div class="value info">${ws.totalLogs}</div>
      </div>
      <div class="wh-summary-card border-success">
        <div class="label">Successful</div>
        <div class="value success">${ws.successCount}</div>
      </div>
      <div class="wh-summary-card border-error">
        <div class="label">Total Failed</div>
        <div class="value error">${ws.failedCount}</div>
      </div>
      <div class="wh-summary-card border-warning">
        <div class="label">Missing Mapping</div>
        <div class="value warning">${ws.missingNumberCount}</div>
      </div>
      <div class="wh-summary-card border-purple">
        <div class="label">Invalid Number</div>
        <div class="value" style="color:#7C3AED;">${ws.invalidNumberCount}</div>
      </div>
      <div class="wh-summary-card border-error">
        <div class="label">Send Failures</div>
        <div class="value error">${ws.sendFailures}</div>
      </div>
    `;

  } catch (err) {
    console.error('WhatsApp job summary error:', err);
    titleEl.textContent = 'Error';
    infoEl.textContent = err.message || 'Failed to load job detail.';
  }
}

async function loadJobLogs(jobId) {
  const tbody = document.getElementById('wh-detail-tbody');
  const pageInfoEl = document.getElementById('wh-detail-page-info');

  tbody.innerHTML = '<tr><td colspan="9" class="wh-loading">Loading logs...</td></tr>';
  pageInfoEl.textContent = '';

  try {
    let url = `/api/admin/whatsapp/history/${jobId}/logs?page=${whDetailPage}&limit=10`;
    if (whDetailFilter) {
      url += `&status=${whDetailFilter}`;
    }

    const result = await adminFetch(url);

    if (!result.success || !result.logs || result.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#94A3B8; padding:32px; font-weight:600;">No WhatsApp logs found for this job.</td></tr>';
      document.getElementById('wh-detail-pagination').innerHTML = '';
      pageInfoEl.textContent = '';
      return;
    }

    tbody.innerHTML = result.logs.map((log, idx) => {
      const sno = (result.page - 1) * result.limit + idx + 1;
      const time = log.createdAt ? formatTime(log.createdAt) : '—';
      const statusBadge = log.status === 'SUCCESS'
        ? '<span class="wh-badge success">SUCCESS</span>'
        : '<span class="wh-badge failed">FAILED</span>';

      // Classify error
      let errorDisplay = '—';
      if (log.status === 'FAILED' && log.errorMessage) {
        const short = truncateStr(log.errorMessage, 45);
        errorDisplay = `<span class="wh-error-text" title="${escapeHtml(log.errorMessage)}">${escapeHtml(short)}</span>`;
      }

      // Mask phone number for display (show last 4 digits)
      let phoneDisplay = '—';
      if (log.recipientNumber) {
        const num = String(log.recipientNumber);
        phoneDisplay = num.length > 4 ? '•••••' + num.slice(-4) : num;
      }

      return `<tr>
        <td>${sno}</td>
        <td>${escapeHtml(log.societyCode || '—')}</td>
        <td>${escapeHtml(log.societyName || '—')}</td>
        <td>${log.bmcCode || '—'}</td>
        <td>${log.batchNumber || '—'}</td>
        <td style="font-family:monospace; font-size:0.78rem;">${phoneDisplay}</td>
        <td>${statusBadge}</td>
        <td>${errorDisplay}</td>
        <td>${time}</td>
      </tr>`;
    }).join('');

    // Page info
    const startItem = (result.page - 1) * result.limit + 1;
    const endItem = Math.min(result.page * result.limit, result.total);
    pageInfoEl.textContent = `${startItem}–${endItem} of ${result.total}`;

    // Pagination
    renderPagination(
      document.getElementById('wh-detail-pagination'),
      result.page,
      result.totalPages,
      (p) => { whDetailPage = p; loadJobLogs(whDetailJobId); }
    );

  } catch (err) {
    console.error('WhatsApp job logs error:', err);
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#DC2626; padding:32px; font-weight:600;">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ─── Detail Filter ──────────────────────────────────────────────────────────────

function filterDetailLogs(status) {
  whDetailFilter = status;
  whDetailPage = 1;

  // Toggle active pill
  document.querySelectorAll('.wh-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === status);
  });

  if (whDetailJobId) {
    loadJobLogs(whDetailJobId);
  }
}

// ─── Pagination Renderer ────────────────────────────────────────────────────────

function renderPagination(container, currentPage, totalPages, onPageClick) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous
  html += `<button class="wh-page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="void(0)">← Prev</button>`;

  // Page numbers
  const maxVisible = 5;
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  if (start > 1) {
    html += `<button class="wh-page-btn" onclick="void(0)">1</button>`;
    if (start > 2) html += `<span style="padding:0 4px; color:#94A3B8;">…</span>`;
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="wh-page-btn ${i === currentPage ? 'active' : ''}" onclick="void(0)">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span style="padding:0 4px; color:#94A3B8;">…</span>`;
    html += `<button class="wh-page-btn" onclick="void(0)">${totalPages}</button>`;
  }

  // Next
  html += `<button class="wh-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="void(0)">Next →</button>`;

  container.innerHTML = html;

  // Attach click handlers
  const buttons = container.querySelectorAll('.wh-page-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const text = btn.textContent.trim();
      let targetPage = currentPage;
      if (text === '← Prev') targetPage = currentPage - 1;
      else if (text === 'Next →') targetPage = currentPage + 1;
      else {
        const num = parseInt(text);
        if (!isNaN(num)) targetPage = num;
      }
      if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
        onPageClick(targetPage);
      }
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateStr(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

function formatJobDate(dateStr) {
  if (!dateStr) return '—';
  // dateStr is YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch { return '—'; }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch { return '—'; }
}

// ─── Initialize ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for auth + admin.js to be ready
  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  initAdminSidebarToggle();

  // Load initial job list
  loadJobList();
});
