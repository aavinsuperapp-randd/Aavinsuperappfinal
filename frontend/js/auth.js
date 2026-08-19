// Check session and profile authorization for a specific role/status
async function checkAuth(requiredRole) {
  toggleLoading(true);
  const client = await initSupabase();
  
  if (!client) {
    toggleLoading(false);
    showToast("Supabase configuration is missing or inactive.", "error");
    const mainContent = document.getElementById('main-dashboard-content') || document.getElementById('main-admin-content');
    if (mainContent) mainContent.classList.add('hidden');
    let errorDiv = document.getElementById('auth-error-container');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'auth-error-container';
      errorDiv.className = 'container mt-4';
      document.body.appendChild(errorDiv);
    }
    errorDiv.innerHTML = `
      <div class="status-box status-rejected mt-4">
        <h3>Database Offline</h3>
        <p class="mt-1">Please configure real Supabase environment variables in backend/.env and restart the server.</p>
      </div>
    `;
    return null;
  }
  
  try {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    
    if (sessionError || !session) {
      console.warn("🔒 No active session. Redirecting to login.");
      redirectToLogin(requiredRole);
      return null;
    }
    
    const user = session.user;
    
    // Fetch profile
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
      
    if (profileError || !profile) {
      console.error("❌ Failed to fetch user profile:", profileError);
      showToast("Access Denied: Profile not found.", "error");
      await client.auth.signOut();
      redirectToLogin(requiredRole);
      return null;
    }
    
    // Authorization checks
    if (requiredRole === 'admin') {
      if (profile.role !== 'admin') {
        showToast("Access Denied: Admin authorization required.", "error");
        window.location.href = getPath('login.html');
        return null;
      }
    } else if (requiredRole === 'user') {
      if (profile.role === 'driver' || profile.role === 'transport_officer') {
        window.location.href = getPath('transport.html');
        return null;
      }
      if (profile.role !== 'user') {
        showToast("Access Denied: User role required.", "error");
        window.location.href = getPath('login.html');
        return null;
      }
      
      if (profile.status === 'pending') {
        showStatusScreen('pending');
        return null;
      } else if (profile.status === 'rejected') {
        showStatusScreen('rejected');
        return null;
      }
    } else if (requiredRole === 'gm') {
      if (profile.role !== 'gm') {
        showToast("Access Denied: GM role required.", "error");
        window.location.href = getPath('login.html');
        return null;
      }
      
      if (profile.status === 'pending') {
        showStatusScreen('pending');
        return null;
      } else if (profile.status === 'rejected') {
        showStatusScreen('rejected');
        return null;
      }
    } else if (requiredRole === 'transport_officer' || requiredRole === 'driver') {
      if (profile.role !== 'transport_officer' && profile.role !== 'driver') {
        showToast("Access Denied: Transport Officer or Driver role required.", "error");
        window.location.href = getPath('login.html');
        return null;
      }
      
      if (profile.status === 'pending') {
        showStatusScreen('pending');
        return null;
      } else if (profile.status === 'rejected') {
        showStatusScreen('rejected');
        return null;
      }
    }
    
    toggleLoading(false);
    return profile;
  } catch (err) {
    console.error("❌ Auth check failed:", err);
    toggleLoading(false);
    redirectToLogin(requiredRole);
    return null;
  }
}

// Redirect helper
function redirectToLogin(role) {
  if (role === 'admin') {
    window.location.href = getPath('admin/login.html');
  } else {
    window.location.href = getPath('login.html');
  }
}

// Display overlay/status screen for Pending or Rejected accounts
function showStatusScreen(status) {
  toggleLoading(false);
  
  // Hide main container if it exists
  const mainContent = document.getElementById('main-dashboard-content');
  if (mainContent) mainContent.classList.add('hidden');
  
  // Create status container
  let statusDiv = document.getElementById('auth-status-container');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'auth-status-container';
    statusDiv.className = 'container mt-4';
    document.body.appendChild(statusDiv);
  }
  
  if (status === 'pending') {
    statusDiv.innerHTML = `
      <div class="status-box status-pending mt-4">
        <h3>Approval Pending</h3>
        <p class="mt-1">Your account is waiting for administrator approval.</p>
        <div class="mt-2">
          <button class="btn btn-outline btn-sm" onclick="handleLogout()">Logout</button>
        </div>
      </div>
    `;
  } else if (status === 'rejected') {
    statusDiv.innerHTML = `
      <div class="status-box status-rejected mt-4">
        <h3>Account Rejected</h3>
        <p class="mt-1">Your account has been rejected. Please contact the administrator.</p>
        <div class="mt-2">
          <button class="btn btn-outline btn-sm" onclick="handleLogout()">Logout</button>
        </div>
      </div>
    `;
  }
}

// Handle Logout for all roles
async function handleLogout() {
  toggleLoading(true);
  const client = await initSupabase();
  
  if (client) {
    await client.auth.signOut();
  }
  
  showToast("Logged out successfully.", "info");
  setTimeout(() => {
    window.location.href = getPath('login.html');
  }, 500);
}
