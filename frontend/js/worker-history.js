// worker-history.js — Trip History Logic

let allTrips = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;

  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  document.getElementById('history-search-input').addEventListener('input', filterAndRenderHistory);
  document.getElementById('history-status-select').addEventListener('change', filterAndRenderHistory);

  await loadHistory();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}

async function loadHistory() {
  const container = document.getElementById('history-list-container');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Loading trip history...</div></div>';

  try {
    const res = await apiGetTrips();
    allTrips = res.trips || [];
    filterAndRenderHistory();
  } catch (err) {
    console.error('Failed to load history:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Error loading history: ${esc(err.message)}</div></div>`;
  }
}

function filterAndRenderHistory() {
  const searchQ = document.getElementById('history-search-input').value.toLowerCase().trim();
  const statusF = document.getElementById('history-status-select').value;
  const container = document.getElementById('history-list-container');

  let filtered = [...allTrips];

  if (searchQ) {
    filtered = filtered.filter(t => 
      (t.trip_name && t.trip_name.toLowerCase().includes(searchQ)) ||
      (t.trip_number && t.trip_number.toLowerCase().includes(searchQ)) ||
      (t.driver_name && t.driver_name.toLowerCase().includes(searchQ)) ||
      (t.tanker_number && t.tanker_number.toLowerCase().includes(searchQ))
    );
  }

  if (statusF !== 'all') {
    filtered = filtered.filter(t => t.status === statusF);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <div class="empty-state-title">No trips found</div>
        <div class="empty-state-desc">No trip records matching your current filter criteria.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const isCompleted = t.status === 'completed';
    const driverName = t.driver_name || (t.driver ? t.driver.name : 'Unassigned');
    const tankerBoard = t.tanker_number || (t.tanker ? t.tanker.board_number : 'N/A');
    const outTimeStr = new Date(t.out_time).toLocaleString();


    return `
      <a href="trip.html?id=${t.id}" class="trip-card">
        <div class="trip-card-icon">🚚</div>
        <div class="trip-card-body">
          <div class="trip-card-name">${esc(t.trip_name)} (${esc(t.trip_number || '')})</div>
          <div class="trip-card-meta">👨‍✈️ Driver: ${esc(driverName)} | 🚛 Tanker: ${esc(tankerBoard)} | ⏰ Out: ${esc(outTimeStr)}</div>
        </div>
        <div class="trip-card-right">
          <span class="status-pill ${isCompleted ? 'pill-completed' : 'pill-active'}">
            ${isCompleted ? 'Completed' : '● Active'}
          </span>
        </div>
      </a>
    `;
  }).join('');
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
