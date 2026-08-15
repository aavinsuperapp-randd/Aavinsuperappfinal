// worker.js - Worker Dashboard logic and session enforcement

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  
  if (profile) {
    const nameEl = document.getElementById('worker-name');
    const emailEl = document.getElementById('worker-email');
    if (nameEl) nameEl.textContent = profile.name;
    if (emailEl) emailEl.textContent = profile.email;

    const mainEl = document.getElementById('main-dashboard-content');
    if (mainEl) mainEl.classList.remove('hidden');

    // Load BMC list for this worker
    await loadAndRenderBmcs('bmc-list-container');
  }
  
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
});
