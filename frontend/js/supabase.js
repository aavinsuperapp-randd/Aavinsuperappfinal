// supabase.js - Supabase Client Initialization and API Wrappers

let supabaseClient = null;

// Relative/Absolute path helper to work across different subdirectories (/gm/, /worker/, /admin/)
function getPath(target) {
  const isFileProtocol = window.location.protocol === 'file:';
  const pathname = (window.location.pathname || '').replace(/\\/g, '/');
  const inSubfolder = pathname.includes('/gm/') || pathname.includes('/worker/') || pathname.includes('/admin/');

  if (isFileProtocol) {
    if (inSubfolder) {
      return '../' + target.replace(/^\//, '');
    }
    return target.replace(/^\//, '');
  }

  // Server HTTP / HTTPS mode (e.g. http://localhost:5000)
  const cleanTarget = target.replace(/^\//, '');
  return '/' + cleanTarget;
}

// Initialize Supabase by fetching config from Backend API
async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  
  try {
    let configUrl = '/api/config';
    if (window.location.protocol === 'file:') {
      configUrl = 'http://localhost:5000/api/config';
    }
    const res = await fetch(configUrl);
    const config = await res.json();
    
    const isPlaceholder = !config.supabaseUrl || 
                          !config.supabaseAnonKey || 
                          config.supabaseUrl.includes('your-supabase-project-id') || 
                          config.supabaseAnonKey.includes('your-supabase-anon-key');
                          
    if (isPlaceholder) {
      console.error("❌ Supabase credentials missing or placeholder.");
      showToast("Database is not configured. Please edit backend/.env", "error");
      return null;
    }
    
    // Initialize using global window.supabase object from CDN
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      console.log("✅ Supabase client successfully initialized.");
      return supabaseClient;
    } else {
      console.error("❌ Supabase CDN script not loaded.");
      showToast("Supabase script failed to load. Check your internet connection.", "error");
      return null;
    }
  } catch (err) {
    console.error("❌ Failed to fetch Supabase config:", err);
    showToast("Failed to connect to backend server configuration.", "error");
    return null;
  }
}

// Global Toast notification helper
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  // Force reflow and show
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Global loading overlay helper
function toggleLoading(show) {
  let loader = document.getElementById('global-loader');
  if (show) {
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'global-loader';
      loader.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
      loader.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(loader);
    }
  } else {
    if (loader) loader.remove();
  }
}
