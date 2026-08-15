// bmc-viewer.js — Shared BMC viewer for Worker and GM dashboards

async function loadAndRenderBmcs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center;padding:24px;">
      <div class="spinner" style="margin:0 auto;"></div>
    </div>`;

  const client = await initSupabase();
  if (!client) {
    container.innerHTML = `<p class="text-muted text-sm">Database is offline. Please contact administrator.</p>`;
    return;
  }

  const { data, error } = await client
    .from('bmcs')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<p class="text-muted text-sm">Failed to load BMCs: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="bmc-empty-state" style="padding:32px 16px;">
        <div class="bmc-empty-icon">🏭</div>
        <div class="bmc-empty-title">No active BMCs</div>
        <div class="bmc-empty-desc">No Bulk Milk Coolers have been activated yet. Contact your administrator.</div>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="bmc-viewer-grid">${data.map(bmc => `
    <div class="bmc-viewer-card">
      ${bmc.profile_image_url
        ? `<img src="${escHtml(bmc.profile_image_url)}" class="bmc-viewer-img" alt="${escHtml(bmc.name)}">`
        : `<div class="bmc-viewer-img-placeholder">🏭</div>`}
      <div class="bmc-viewer-body">
        <div class="bmc-viewer-name">${escHtml(bmc.name)}</div>
        <div class="bmc-viewer-info">
          <div class="bmc-viewer-info-item"><span>🗺️</span> ${escHtml(bmc.district)}</div>
          <div class="bmc-viewer-info-item"><span>📍</span> ${escHtml(bmc.location)}</div>
          <div class="bmc-viewer-info-item"><span>📞</span> ${escHtml(bmc.contact_number)}</div>
          ${bmc.latitude ? `<div class="bmc-viewer-info-item"><span>🛰️</span> ${Number(bmc.latitude).toFixed(4)}, ${Number(bmc.longitude).toFixed(4)}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('')}</div>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
