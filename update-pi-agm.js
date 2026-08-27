const fs = require('fs');

function updateJs(file) {
  let content = fs.readFileSync(file, 'utf8');

  // Add allRoutes
  if (!content.includes('let allRoutes = [];')) {
    content = content.replace('let currentSilos = [];', 'let currentSilos = [];\nlet allRoutes = [];');
  }

  // Add loadRoutes
  if (!content.includes('async function loadRoutes()')) {
    content = content.replace('await loadBmcs();\n  bindEvents();', 'await loadRoutes();\n  await loadBmcs();\n  bindEvents();');
    
    const loadRoutesStr = `
// ── Load Routes ───────────────────────────────────────────────────────────────
async function loadRoutes() {
  try {
    const fetchFunc = typeof gmFetch === 'function' ? gmFetch : (typeof adminFetch === 'function' ? adminFetch : fetch);
    const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
    const res = await fetchFunc(\`\${baseUrl}/api/gm/routes\`);
    const data = typeof res.json === 'function' ? await res.json() : res;
    allRoutes = data.routes || [];
    
    const filterSelect = document.getElementById('bmc-filter-route');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="all">All Routes</option><option value="none">No Route</option>' + 
        allRoutes.map(r => \`<option value="\${r.id}">\${r.name}</option>\`).join('');
    }
    
    const modalSelect = document.getElementById('bmc-route');
    if (modalSelect) {
      modalSelect.innerHTML = '<option value="">No Route</option>' + 
        allRoutes.map(r => \`<option value="\${r.id}">\${r.name}</option>\`).join('');
    }
  } catch (err) {
    console.error('Failed to load routes:', err);
  }
}
`;
    content = content.replace('// ── Load All BMCs', loadRoutesStr + '\n// ── Load All BMCs');
  }

  // Update renderGrid
  if (!content.includes("const routeName = bmc.bmc_routes?.name || 'No Route';")) {
    // Only replace inside renderGrid
    content = content.replace(
      'const siloCount = bmc.silos ? bmc.silos.length : 0;\n\n    return `\n    <div class="bmc-card ${bmc.is_active === false ? \'inactive-card\' : \'\'}">', 
      'const siloCount = bmc.silos ? bmc.silos.length : 0;\n    const routeName = bmc.bmc_routes?.name || \'No Route\';\n\n    return `\n    <div class="bmc-card ${bmc.is_active === false ? \'inactive-card\' : \'\'}">'
    );
    
    content = content.replace(
      '<div class="bmc-card-meta-item"><span>📞</span>${escHtml(bmc.contact_number)}</div>\n          <div class="bmc-card-meta-item"><span>🏋️</span>Capacity: <b>${capacityKg}</b>', 
      '<div class="bmc-card-meta-item"><span>📞</span>${escHtml(bmc.contact_number)}</div>\n          <div class="bmc-card-meta-item" style="color:#0284c7; font-weight:600;"><span>🛣️</span>${escHtml(routeName)}</div>\n          <div class="bmc-card-meta-item"><span>🏋️</span>Capacity: <b>${capacityKg}</b>'
    );
  }

  // applyFilters
  if (!content.includes("const routeEl = document.getElementById('bmc-filter-route');")) {
    content = content.replace("const status = statusEl ? statusEl.value : 'all';", "const status = statusEl ? statusEl.value : 'all';\n  const routeEl = document.getElementById('bmc-filter-route');\n  const routeId = routeEl ? routeEl.value : 'all';");
    
    content = content.replace("if (status === 'inactive') list = list.filter(b => b.is_active === false);", "if (status === 'inactive') list = list.filter(b => b.is_active === false);\n  \n  if (routeId === 'none') {\n    list = list.filter(b => !b.route_id);\n  } else if (routeId !== 'all') {\n    list = list.filter(b => b.route_id === routeId);\n  }");
  }

  // bindEvents
  if (!content.includes("const filterRoute = document.getElementById('bmc-filter-route');")) {
    content = content.replace("const filterStatus = document.getElementById('bmc-filter-status');\n  if (filterStatus) filterStatus.addEventListener('change', applyFilters);", "const filterStatus = document.getElementById('bmc-filter-status');\n  if (filterStatus) filterStatus.addEventListener('change', applyFilters);\n  \n  const filterRoute = document.getElementById('bmc-filter-route');\n  if (filterRoute) filterRoute.addEventListener('change', applyFilters);\n  \n  const addRouteBtn = document.getElementById('add-route-btn');\n  if (addRouteBtn) {\n    addRouteBtn.addEventListener('click', async () => {\n      const name = prompt('Enter new route name:');\n      if (name && name.trim()) {\n        try {\n          const fetchFunc = typeof gmFetch === 'function' ? gmFetch : (typeof adminFetch === 'function' ? adminFetch : fetch);\n          const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';\n          const headers = {'Content-Type': 'application/json'};\n          if (typeof gmFetch !== 'function' && typeof adminFetch !== 'function') {\n            headers['Authorization'] = `Bearer ${window.localStorage.getItem('sb-access-token')}`;\n          }\n          const res = await fetchFunc(`${baseUrl}/api/gm/routes`, {\n            method: 'POST',\n            headers,\n            body: JSON.stringify({ name: name.trim() })\n          });\n          const data = typeof res.json === 'function' ? await res.json() : res;\n          if (data.route) {\n            await loadRoutes();\n            document.getElementById('bmc-route').value = data.route.id;\n            if (typeof showToast === 'function') showToast('Route added successfully', 'success');\n          } else {\n             if (typeof showToast === 'function') showToast(data.error || 'Failed to add route', 'error');\n          }\n        } catch (err) {\n          if (typeof showToast === 'function') showToast(err.message, 'error');\n        }\n      }\n    });\n  }");
  }

  // openAddModal
  if (!content.includes("if (routeEl) routeEl.value = '';")) {
    content = content.replace("document.getElementById('bmc-modal-title').textContent = 'Add New BMC';", "document.getElementById('bmc-modal-title').textContent = 'Add New BMC';\n  \n  const routeEl = document.getElementById('bmc-route');\n  if (routeEl) routeEl.value = '';");
  }

  // openEditModal
  if (!content.includes("if (routeEl) routeEl.value = bmc.route_id || '';")) {
    content = content.replace("document.getElementById('bmc-modal-title').textContent = 'Edit BMC';", "document.getElementById('bmc-modal-title').textContent = 'Edit BMC';\n  \n  const routeEl = document.getElementById('bmc-route');\n  if (routeEl) routeEl.value = bmc.route_id || '';");
  }

  // saveBmc
  if (!content.includes("const route_id = routeEl ? routeEl.value : null;")) {
    content = content.replace("const latStr = document.getElementById('bmc-latitude').value.trim();\n  const lngStr = document.getElementById('bmc-longitude').value.trim();", "const latStr = document.getElementById('bmc-latitude').value.trim();\n  const lngStr = document.getElementById('bmc-longitude').value.trim();\n  \n  const routeEl = document.getElementById('bmc-route');\n  const route_id = routeEl ? routeEl.value : null;");
    content = content.replace("console.log('[saveBmc] Starting save. Values:', { name, district, contact, capacityStr, location, latStr, lngStr });", "console.log('[saveBmc] Starting save. Values:', { name, district, contact, capacityStr, location, latStr, lngStr, route_id });");
    
    content = content.replace("profile_image_url: imageUrl,", "profile_image_url: imageUrl,\n      route_id: route_id,");
    content = content.replace("total_capacity: payload.total_capacity", "total_capacity: payload.total_capacity,\n          route_id: payload.route_id");
  }

  fs.writeFileSync(file, content, 'utf8');
}

updateJs('frontend/js/pi-agm-bmcs.js');
console.log('pi-agm-bmcs.js updated');

