// eo-test-results.js — Executive Officer Test Results Page Logic

let testsCache = [];
let currentDateFilter = 'all';
let currentQualityFilter = 'all';
let currentSortBy = 'latest';
let targetBmcId = '';

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('executive_officer');
  if (!profile) return;

  const mainContent = document.getElementById('main-dashboard-content');
  if (mainContent) mainContent.classList.remove('hidden');

  const userDisplayName = document.getElementById('user-display-name');
  if (userDisplayName) userDisplayName.textContent = profile.name || 'Executive Officer';

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLogout();
    });
  }

  // Check query params
  const params = new URLSearchParams(window.location.search);
  if (params.get('bmcId')) targetBmcId = params.get('bmcId');

  // Date filter buttons
  const dateBtns = document.querySelectorAll('.date-btn');
  dateBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      dateBtns.forEach(b => { b.classList.remove('active', 'btn-primary'); b.classList.add('btn-outline'); });
      btn.classList.add('active', 'btn-primary');
      btn.classList.remove('btn-outline');
      currentDateFilter = btn.getAttribute('data-date');
      await fetchAndRenderTestResults();
    });
  });

  const qualitySelect = document.getElementById('select-quality-filter');
  if (qualitySelect) {
    qualitySelect.addEventListener('change', () => {
      currentQualityFilter = qualitySelect.value;
      fetchAndRenderTestResults();
    });
  }

  const sortSelect = document.getElementById('select-sort-by');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentSortBy = sortSelect.value;
      fetchAndRenderTestResults();
    });
  }

  const modal = document.getElementById('test-detail-modal');
  const btnCloseModal = document.getElementById('close-test-modal');
  const btnCloseModal2 = document.getElementById('btn-close-test-modal');
  const closeModal = () => { if (modal) modal.classList.add('hidden'); };
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCloseModal2) btnCloseModal2.addEventListener('click', closeModal);

  await fetchAndRenderTestResults();
});

async function fetchAndRenderTestResults() {
  const tbody = document.getElementById('test-results-tbody');
  if (!tbody) return;

  try {
    let url = `/api/eo/test-results?dateFilter=${currentDateFilter}&quality=${currentQualityFilter}&sortBy=${currentSortBy}`;
    if (targetBmcId) url += `&bmcId=${targetBmcId}`;

    const data = await eoFetch(url);
    testsCache = data.testResults || [];

    if (testsCache.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center text-muted p-4">
            No milk quality test results found matching your filters.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    testsCache.forEach(test => {
      const tr = document.createElement('tr');
      const timeStr = test.test_time ? new Date(test.test_time).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

      const statusBadge = String(test.quality_grade).toLowerCase().includes('fail')
        ? '<span class="badge badge-danger">FAIL</span>'
        : String(test.quality_grade).toLowerCase().includes('warn')
        ? '<span class="badge badge-warning">WARNING</span>'
        : '<span class="badge badge-success">PASS</span>';

      tr.innerHTML = `
        <td style="font-weight: 600;">${timeStr}</td>
        <td><strong>${test.bmc_name || 'BMC'}</strong></td>
        <td><span class="badge badge-info">${test.test_type}</span></td>
        <td>${test.milk_quantity != null ? `${test.milk_quantity} kg` : '—'}</td>
        <td style="font-weight: 700;">${test.fat != null ? `${test.fat}%` : '—'}</td>
        <td style="font-weight: 700;">${test.snf != null ? `${test.snf}%` : '—'}</td>
        <td>${statusBadge}</td>
        <td>${test.worker_name || 'Worker'}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openTestDetail('${test.id}')">
            🔍 Details
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to fetch test results:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-danger p-4 text-center">Failed to load test results (${err.message}).</td></tr>`;
  }
}

window.openTestDetail = function(testId) {
  const test = testsCache.find(t => t.id === testId);
  if (!test) return;

  const modal = document.getElementById('test-detail-modal');
  if (!modal) return;

  document.getElementById('td-bmc').textContent = test.bmc_name || 'BMC';
  document.getElementById('td-type').textContent = test.test_type || 'FTIR';
  document.getElementById('td-time').textContent = test.test_time ? new Date(test.test_time).toLocaleString('en-IN') : '—';
  document.getElementById('td-worker').textContent = test.worker_name || 'Worker';
  document.getElementById('td-qty').textContent = test.milk_quantity != null ? `${test.milk_quantity} kg` : '—';
  
  const statusBadge = String(test.quality_grade).toLowerCase().includes('fail')
    ? '<span class="badge badge-danger">FAIL</span>'
    : String(test.quality_grade).toLowerCase().includes('warn')
    ? '<span class="badge badge-warning">WARNING</span>'
    : '<span class="badge badge-success">PASS</span>';
  document.getElementById('td-status').innerHTML = statusBadge;

  document.getElementById('td-fat').textContent = test.fat != null ? `${test.fat}%` : '—';
  document.getElementById('td-snf').textContent = test.snf != null ? `${test.snf}%` : '—';
  document.getElementById('td-clr').textContent = test.clr != null ? test.clr : '—';
  document.getElementById('td-temp').textContent = test.temperature != null ? `${test.temperature}°C` : '—';
  document.getElementById('td-rate').textContent = test.rate != null ? `₹${test.rate}/L` : '—';
  document.getElementById('td-remarks').textContent = test.remarks || 'No remarks recorded.';

  modal.classList.remove('hidden');
};
