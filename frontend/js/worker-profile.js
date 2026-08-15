// worker-profile.js — Worker Profile Logic

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('main-content-area').classList.remove('hidden');
  document.getElementById('header-worker-name').textContent = profile.name;

  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('profile-logout-btn').addEventListener('click', handleLogout);

  document.getElementById('prof-name').value = profile.name || '';
  document.getElementById('prof-email').value = profile.email || '';
  document.getElementById('prof-dob').value = profile.dob || '';
  document.getElementById('prof-role').value = (profile.role || 'user').toUpperCase() + ' (R&D / Field Worker)';

  const badge = document.getElementById('prof-status-badge');
  if (profile.status === 'approved') {
    badge.textContent = '✓ Approved Account';
    badge.className = 'status-pill pill-completed';
  } else {
    badge.textContent = profile.status;
    badge.className = 'status-pill pill-pending';
  }
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}
