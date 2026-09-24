// admin-society-data.js — Society Data Module Frontend Logic
// Handles: session toggle, route filters, society table, pagination, start job, progress polling, fetch history

// ─── State ──────────────────────────────────────────────────────────────────────
let societyCurrentSession = 'morning';
let societyCurrentRoute = 'all';
let societyCurrentPage = 1;
const SOCIETY_PAGE_SIZE = 10;
let societyStatusPollInterval = null;
let societyIsPolling = false;
let societyCountdownInterval = null;
let societyCountdownTargetTime = null;

// ─── Batch definitions for progress display ─────────────────────────────────────
const SOCIETY_BATCH_DEFS = [
  [18, 19, 31, 32, 33],
  [35, 36, 37, 38, 39],
  [41, 801, 802, 803, 804],
  [805, 806, 807, 809, 813],
  [814, 815, 816, 817, 818],
  [819, 820, 821, 824, 825],
  [826, 827, 828, 829, 830],
  [831, 832, 834, 835, 836],
  [837, 838, 839, 840, 841]
];

// ─── Initialize ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Only run on society-data page
  if (!document.getElementById('society-table')) return;

  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  initAdminSidebarToggle();
  setupSessionToggle();
  setupRouteFilters();
  setupStartFlow();

  // Load initial data
  await Promise.all([
    loadSocietyData(),
    loadFetchHistory(),
    checkFetchStatus()
  ]);
});

// ─── Session Toggle ─────────────────────────────────────────────────────────────
function setupSessionToggle() {
  const btns = document.querySelectorAll('.session-toggle-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      societyCurrentSession = btn.dataset.session;
      societyCurrentPage = 1;
      loadSocietyData();
    });
  });
}

// ─── Route Filters ──────────────────────────────────────────────────────────────
function setupRouteFilters() {
  const filterContainer = document.getElementById('route-filters');
  if (!filterContainer) return;

  filterContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.route-filter-btn');
    if (!btn) return;

    filterContainer.querySelectorAll('.route-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    societyCurrentRoute = btn.dataset.route;
    societyCurrentPage = 1;
    loadSocietyData();
  });
}

// ─── Start Job Flow ─────────────────────────────────────────────────────────────
function setupStartFlow() {
  const startBtn = document.getElementById('btn-start-now');
  const modal = document.getElementById('start-confirm-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const confirmBtn = document.getElementById('modal-confirm-btn');
  const confirmInput = document.getElementById('start-confirm-input');

  if (!startBtn || !modal) return;

  // Open modal
  startBtn.addEventListener('click', () => {
    const sessionLabel = document.getElementById('modal-session-label');
    if (sessionLabel) sessionLabel.textContent = societyCurrentSession === 'morning' ? 'Morning' : 'Evening';
    if (confirmInput) confirmInput.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    modal.classList.remove('hidden');
    if (confirmInput) confirmInput.focus();
  });

  // Close modal
  const closeModal = () => modal.classList.add('hidden');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Enable confirm button only when "START" is typed
  if (confirmInput) {
    confirmInput.addEventListener('input', () => {
      const val = (confirmInput.value || '').trim().toUpperCase();
      if (confirmBtn) confirmBtn.disabled = (val !== 'START');
    });
  }

  // Confirm and start
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (confirmInput && confirmInput.value.trim().toUpperCase() !== 'START') {
        showToast('Please type START to confirm.', 'error');
        return;
      }

      closeModal();
      await startFetchJob();
    });
  }

  // Stop button
  const stopBtn = document.getElementById('btn-stop-now');
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      await stopFetchJob();
    });
  }
}

// ─── Start / Stop Button Toggle ─────────────────────────────────────────────────
function toggleStartStopButtons(isRunning) {
  const startBtn = document.getElementById('btn-start-now');
  const stopBtn = document.getElementById('btn-stop-now');

  if (isRunning) {
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
  } else {
    if (startBtn) { startBtn.classList.remove('hidden'); startBtn.disabled = false; }
    if (stopBtn) stopBtn.classList.add('hidden');
  }
}

// ─── Start Fetch Job ────────────────────────────────────────────────────────────
async function startFetchJob() {
  const statusText = document.getElementById('start-status-text');

  toggleStartStopButtons(true);
  if (statusText) statusText.textContent = 'Starting...';

  try {
    const result = await adminFetch('/api/admin/society-data/fetch/start', {
      method: 'POST',
      body: JSON.stringify({ session: societyCurrentSession })
    });

    if (result.success) {
      showToast(`Society data fetch started for ${societyCurrentSession} session!`, 'success');
      if (statusText) statusText.textContent = 'Fetch job in progress...';
      startStatusPolling();
    } else {
      throw new Error(result.error || 'Failed to start fetch job');
    }
  } catch (err) {
    console.error('Start fetch error:', err);
    showToast(err.message || 'Failed to start society data fetch.', 'error');
    toggleStartStopButtons(false);
    if (statusText) statusText.textContent = '';

    // If it's a duplicate job error, start polling anyway
    if (err.message && err.message.includes('already in progress')) {
      toggleStartStopButtons(true);
      startStatusPolling();
    }
  }
}

// ─── Stop Fetch Job ─────────────────────────────────────────────────────────────
async function stopFetchJob() {
  const stopBtn = document.getElementById('btn-stop-now');
  const statusText = document.getElementById('start-status-text');

  if (stopBtn) stopBtn.disabled = true;
  if (statusText) statusText.textContent = 'Stopping...';

  try {
    const result = await adminFetch('/api/admin/society-data/fetch/stop', {
      method: 'POST'
    });

    if (result.success) {
      showToast(result.message || 'Society data fetch stopped.', 'success');
    } else {
      throw new Error(result.error || 'Failed to stop fetch job');
    }
  } catch (err) {
    console.error('Stop fetch error:', err);
    showToast(err.message || 'Failed to stop society data fetch.', 'error');
  } finally {
    if (stopBtn) stopBtn.disabled = false;
    // Polling will detect the stopped state and toggle buttons accordingly
  }
}

// ─── Status Polling ─────────────────────────────────────────────────────────────
function startStatusPolling() {
  if (societyStatusPollInterval) {
    clearInterval(societyStatusPollInterval);
  }

  // Show progress panel
  const progressPanel = document.getElementById('progress-panel');
  if (progressPanel) progressPanel.classList.remove('hidden');

  // Poll immediately, then every 10 seconds
  pollFetchStatus();
  societyStatusPollInterval = setInterval(pollFetchStatus, 10000);
}

function stopStatusPolling() {
  if (societyStatusPollInterval) {
    clearInterval(societyStatusPollInterval);
    societyStatusPollInterval = null;
  }
  clearBatchCountdown();
}

// ─── Batch Countdown Timer ──────────────────────────────────────────────────────
function clearBatchCountdown() {
  if (societyCountdownInterval) {
    clearInterval(societyCountdownInterval);
    societyCountdownInterval = null;
  }
  societyCountdownTargetTime = null;
  const el = document.getElementById('batch-countdown-display');
  if (el) el.remove();
}

function startBatchCountdown(lastBatchEndTime) {
  // Clear any existing countdown first to prevent duplicates
  clearBatchCountdown();

  // Calculate the target time: lastBatchEndTime + 3 minutes
  const endMs = new Date(lastBatchEndTime).getTime();
  const targetMs = endMs + (3 * 60 * 1000); // 3-minute interval
  societyCountdownTargetTime = targetMs;

  // Tick every second
  societyCountdownInterval = setInterval(() => {
    const now = Date.now();
    const remainMs = societyCountdownTargetTime - now;

    if (remainMs <= 0) {
      // Countdown reached zero
      clearBatchCountdown();
      return;
    }

    const totalSec = Math.ceil(remainMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');

    const el = document.getElementById('batch-countdown-display');
    if (el) {
      el.querySelector('.countdown-time').textContent = `${mm}:${ss}`;
    }
  }, 1000);
}

async function pollFetchStatus() {
  if (societyIsPolling) return;
  societyIsPolling = true;

  try {
    const status = await adminFetch('/api/admin/society-data/fetch/status');
    renderProgress(status);

    if (!status.isRunning && status.status !== 'idle') {
      clearBatchCountdown();
      stopStatusPolling();
      // Show START, hide STOP
      toggleStartStopButtons(false);
      const statusText = document.getElementById('start-status-text');
      if (statusText) {
        if (status.status === 'stopped') {
          statusText.textContent = `Stopped after Batch ${status.currentBatch}`;
          statusText.style.color = '#DC2626';
        } else {
          statusText.textContent = '';
          statusText.style.color = '#64748B';
        }
      }

      // Reload data and history
      await Promise.all([loadSocietyData(), loadFetchHistory()]);
    }
  } catch (err) {
    console.error('Status poll error:', err);
  } finally {
    societyIsPolling = false;
  }
}

async function checkFetchStatus() {
  try {
    const status = await adminFetch('/api/admin/society-data/fetch/status');
    if (status.isRunning) {
      toggleStartStopButtons(true);
      const statusText = document.getElementById('start-status-text');
      if (statusText) statusText.textContent = 'Fetch job in progress...';
      startStatusPolling();
    } else {
      toggleStartStopButtons(false);
    }
    renderProgress(status);
  } catch (err) {
    console.error('Initial status check error:', err);
  }
}

// ─── Render Progress ────────────────────────────────────────────────────────────
function renderProgress(status) {
  const panel = document.getElementById('progress-panel');
  const icon = document.getElementById('progress-icon');
  const label = document.getElementById('progress-label');
  const batchText = document.getElementById('progress-batch-text');
  const bar = document.getElementById('progress-bar');
  const batchGrid = document.getElementById('batch-grid');

  if (!panel) return;

  // Show/hide based on status
  if (status.status === 'idle' && !status.startedAt) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  // Update header
  if (status.status === 'running') {
    icon.textContent = '⏳';
    label.textContent = 'Fetching...';
    label.style.color = '#D97706';
  } else if (status.status === 'completed') {
    icon.textContent = '✅';
    label.textContent = 'Job Completed';
    label.style.color = '#059669';
  } else if (status.status === 'failed') {
    icon.textContent = '❌';
    label.textContent = 'Job Failed';
    label.style.color = '#DC2626';
  } else if (status.status === 'stopped') {
    icon.textContent = '🛑';
    label.textContent = `Stopped after Batch ${status.currentBatch}`;
    label.style.color = '#DC2626';
  }

  const total = status.totalBatches || 9;
  const current = status.currentBatch || 0;
  if (batchText) batchText.textContent = `Batch ${current} / ${total}`;
  if (bar) bar.style.width = `${(current / total) * 100}%`;

  // Render batch grid
  if (!batchGrid) return;
  batchGrid.innerHTML = '';

  for (let i = 0; i < SOCIETY_BATCH_DEFS.length; i++) {
    const batchNum = i + 1;
    const bmcCodes = SOCIETY_BATCH_DEFS[i];
    const batchResult = (status.batchResults || []).find(b => b.batchNum === batchNum);

    const item = document.createElement('div');
    item.className = 'batch-item';

    let batchStatus = 'waiting';
    let batchStatusLabel = 'Waiting';
    if (batchResult) {
      if (batchResult.failCount > 0 && batchResult.successCount === 0) {
        batchStatus = 'failed';
        batchStatusLabel = 'Failed';
      } else if (batchResult.failCount > 0) {
        batchStatus = 'completed';
        batchStatusLabel = 'Partial';
      } else {
        batchStatus = 'completed';
        batchStatusLabel = 'Completed';
      }
    } else if (status.isRunning && batchNum === current) {
      batchStatus = 'fetching';
      batchStatusLabel = 'Fetching...';
    }

    // Determine if this batch should show a countdown above it
    // Countdown shows above the NEXT waiting batch, after the last completed batch
    let countdownHtml = '';
    const lastCompleted = (status.batchResults || []).length;
    const isNextWaitingBatch = status.isRunning && batchNum === lastCompleted + 1 && !batchResult && lastCompleted > 0 && lastCompleted < SOCIETY_BATCH_DEFS.length;

    if (isNextWaitingBatch) {
      const lastBatch = status.batchResults[status.batchResults.length - 1];
      if (lastBatch && lastBatch.endTime) {
        const endMs = new Date(lastBatch.endTime).getTime();
        const targetMs = endMs + (3 * 60 * 1000);
        const remainMs = targetMs - Date.now();

        if (remainMs > 0) {
          const totalSec = Math.ceil(remainMs / 1000);
          const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
          const ss = String(totalSec % 60).padStart(2, '0');

          countdownHtml = `
            <div id="batch-countdown-display" style="
              background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
              border: 1px solid #93C5FD; border-radius: 10px;
              padding: 12px 16px; margin-bottom: 8px; text-align: center;
            ">
              <div style="font-size: 0.75rem; font-weight: 600; color: #3B82F6; margin-bottom: 4px;">Next batch starts in</div>
              <div class="countdown-time" style="font-size: 1.6rem; font-weight: 800; color: #1D4ED8; font-variant-numeric: tabular-nums; letter-spacing: 2px;">${mm}:${ss}</div>
            </div>
          `;

          // Start the countdown ticker (only once per batch transition)
          if (!societyCountdownInterval || societyCountdownTargetTime !== targetMs) {
            startBatchCountdown(lastBatch.endTime);
          }
        }
      }
    }

    item.innerHTML = `
      ${countdownHtml}
      <div class="batch-item-header">
        <span class="batch-item-label">Batch ${batchNum}</span>
        <span class="batch-item-status ${batchStatus}">${batchStatusLabel}</span>
      </div>
      <div class="bmc-status-list">
        ${bmcCodes.map(code => {
          const bmcResult = status.bmcResults ? status.bmcResults[code] : null;
          let chipClass = 'pending';
          let chipIcon = '·';
          if (bmcResult) {
            if (bmcResult.status === 'completed') { chipClass = 'ok'; chipIcon = '✓'; }
            else if (bmcResult.status === 'failed') { chipClass = 'fail'; chipIcon = '✗'; }
            else if (bmcResult.status === 'fetching') { chipClass = 'fetching'; chipIcon = '⟳'; }
          }
          return `<span class="bmc-chip ${chipClass}">${chipIcon} ${code}</span>`;
        }).join('')}
      </div>
    `;

    batchGrid.appendChild(item);
  }
}

// ─── Load Society Data ──────────────────────────────────────────────────────────
async function loadSocietyData() {
  const tbody = document.getElementById('society-table-body');
  const mobileCards = document.getElementById('society-mobile-cards');
  const countEl = document.getElementById('table-count');
  const paginationBar = document.getElementById('pagination-bar');

  if (!tbody) return;

  try {
    const params = new URLSearchParams({
      session: societyCurrentSession,
      route: societyCurrentRoute,
      page: societyCurrentPage,
      limit: SOCIETY_PAGE_SIZE
    });

    const result = await adminFetch(`/api/admin/society-data?${params.toString()}`);

    if (!result.success) {
      throw new Error(result.error || 'Failed to load society data');
    }

    const { data, total, page, totalPages } = result;

    // Update count
    if (countEl) {
      countEl.textContent = total > 0 ? `${total} societies found` : '';
    }

    // Render table
    if (data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state-box">
              <div class="icon">📭</div>
              <div class="title">No Society Data Available</div>
              <div class="desc">Start a fetch job to load today's society data, or adjust filters.</div>
            </div>
          </td>
        </tr>
      `;
      if (mobileCards) mobileCards.innerHTML = '';
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    // Desktop table rows
    tbody.innerHTML = data.map((row, idx) => {
      const rowNum = (page - 1) * SOCIETY_PAGE_SIZE + idx + 1;
      return `
        <tr>
          <td>${rowNum}</td>
          <td><strong>${row.bmc_code}</strong></td>
          <td><span class="route-badge ${row.route}">${row.route}</span></td>
          <td>${row.society_code || '—'}</td>
          <td>${row.society_name || '—'}</td>
          <td><span class="quality-value quality-fat">${row.fat !== null ? row.fat : '—'}</span></td>
          <td><span class="quality-value quality-liter">${row.liter !== null ? row.liter : '—'}</span></td>
          <td><span class="quality-value quality-snf">${row.snf !== null ? row.snf : '—'}</span></td>
        </tr>
      `;
    }).join('');

    // Mobile cards
    if (mobileCards) {
      mobileCards.innerHTML = data.map(row => `
        <div class="society-mobile-card">
          <div class="society-mobile-card-header">
            <div>
              <div class="society-mobile-card-name">${row.society_name || 'Society ' + row.society_code}</div>
              <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">
                BMC ${row.bmc_code} · <span class="route-badge ${row.route}">${row.route}</span>
              </div>
            </div>
          </div>
          <div class="society-mobile-card-values">
            <div class="society-mobile-card-val quality-fat">
              <div class="label">FAT</div>
              <div class="value">${row.fat !== null ? row.fat : '—'}</div>
            </div>
            <div class="society-mobile-card-val quality-liter">
              <div class="label">Liter</div>
              <div class="value">${row.liter !== null ? row.liter : '—'}</div>
            </div>
            <div class="society-mobile-card-val quality-snf">
              <div class="label">SNF</div>
              <div class="value">${row.snf !== null ? row.snf : '—'}</div>
            </div>
          </div>
        </div>
      `).join('');
    }

    // Pagination
    renderPagination(paginationBar, page, totalPages, total);

  } catch (err) {
    console.error('Load society data error:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state-box">
            <div class="icon">⚠️</div>
            <div class="title">Failed to Load Data</div>
            <div class="desc">${err.message}</div>
          </div>
        </td>
      </tr>
    `;
  }
}

// ─── Pagination ─────────────────────────────────────────────────────────────────
function renderPagination(container, currentPage, totalPages, totalItems) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `<button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToSocietyPage(${currentPage - 1})">← Prev</button>`;

  // Page numbers
  const maxVisible = 5;
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  if (start > 1) {
    html += `<button class="page-btn" onclick="goToSocietyPage(1)">1</button>`;
    if (start > 2) html += `<span style="padding: 0 4px; color: #94A3B8;">…</span>`;
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToSocietyPage(${i})">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span style="padding: 0 4px; color: #94A3B8;">…</span>`;
    html += `<button class="page-btn" onclick="goToSocietyPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `<button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToSocietyPage(${currentPage + 1})">Next →</button>`;

  container.innerHTML = html;
}

window.goToSocietyPage = function(page) {
  societyCurrentPage = page;
  loadSocietyData();
  // Scroll to table
  const tableCard = document.getElementById('society-table-card');
  if (tableCard) tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ─── Load Fetch History ─────────────────────────────────────────────────────────
async function loadFetchHistory() {
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');

  if (!historyList) return;

  try {
    const result = await adminFetch('/api/admin/society-data/fetch/history');

    if (!result.success || !result.jobs || result.jobs.length === 0) {
      if (historyEmpty) historyEmpty.style.display = '';
      historyList.innerHTML = '';
      return;
    }

    if (historyEmpty) historyEmpty.style.display = 'none';

    historyList.innerHTML = result.jobs.map(job => {
      const startTime = job.startedAt ? new Date(job.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
      const endTime = job.completedAt ? new Date(job.completedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
      const statusClass = job.status === 'completed' ? 'completed' : 
                          job.status === 'running' ? 'running' : 
                          job.status === 'stopped' ? 'stopped' : 'failed';
      const sessionLabel = job.session === 'morning' ? '☀️ Morning' : '🌙 Evening';

      let batchHtml = '';
      if (job.batchDetails && Array.isArray(job.batchDetails)) {
        batchHtml = job.batchDetails.map(batch => {
          const batchTime = batch.startTime ? new Date(batch.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
          return `
            <div style="font-size: 0.75rem; color: #475569; margin-top: 4px;">
              <strong>Batch ${batch.batchNum}</strong> · ${batchTime} · BMC: ${batch.bmcCodes.join(', ')} · 
              <span style="color: #059669;">${batch.successCount}✓</span>
              ${batch.failCount > 0 ? `<span style="color: #DC2626;"> ${batch.failCount}✗</span>` : ''}
            </div>
          `;
        }).join('');
      }

      return `
        <div class="history-item">
          <div class="history-item-header">
            <div>
              <span class="history-time">${startTime}</span>
              ${endTime !== '—' ? `<span style="font-size: 0.75rem; color: #94A3B8;"> → ${endTime}</span>` : ''}
              <span style="font-size: 0.78rem; margin-left: 8px;">${sessionLabel}</span>
            </div>
            <span class="history-status-badge ${statusClass}">${job.status}</span>
          </div>
          <div style="font-size: 0.78rem; color: #64748B;">
            Batches: ${job.currentBatch} / ${job.totalBatches}
          </div>
          ${batchHtml}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Load fetch history error:', err);
    if (historyEmpty) historyEmpty.style.display = '';
    historyList.innerHTML = '';
  }
}
