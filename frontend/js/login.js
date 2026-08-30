// login.js - Authentication submit handling with Supabase & Admin special check

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      if (typeof UIStates !== 'undefined' && submitBtn) {
        UIStates.setSaving(submitBtn, true, 'Signing in...');
      } else {
        toggleLoading(true);
      }
      
      // 1. Initialize Supabase
      const client = await initSupabase();
      
      if (!client) {
        showToast("Supabase is not initialized. Check server settings.", "error");
        if (typeof UIStates !== 'undefined' && submitBtn) UIStates.setSaving(submitBtn, false);
        toggleLoading(false);
        return;
      }
      
      try {
        // 2. Real Supabase Authentication
        const { data, error } = await client.auth.signInWithPassword({
          email: email,
          password: password
        });
        
        if (error) throw error;
        
        const userId = data.user.id;
        
        // 3. Fetch User Profile from Database
        let { data: profile, error: profileError } = await client
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
          
        // Auto-seed admin/driver profiles if missing
        if ((profileError || !profile) && email === 'admin@gmail.com') {
          const { error: insertError } = await client
            .from('profiles')
            .insert({
              id: userId,
              name: 'System Administrator',
              dob: '1990-01-01',
              email: 'admin@gmail.com',
              role: 'admin',
              status: 'approved'
            });
          if (insertError) throw insertError;
          
          const { data: adminProfile, error: refetchError } = await client
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
            
          if (refetchError) throw refetchError;
          profile = adminProfile;
        } else if ((profileError || !profile) && (email.startsWith('demodriver') || email.includes('driver'))) {
          const { error: insertError } = await client
            .from('profiles')
            .insert({
              id: userId,
              name: 'Demo Driver',
              dob: '1992-05-15',
              email: email,
              role: 'driver',
              status: 'approved'
            });
          if (insertError) throw insertError;
          
          const { data: driverProfile, error: refetchError } = await client
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
            
          if (refetchError) throw refetchError;
          profile = driverProfile;
        } else if (profileError || !profile) {
          throw new Error("User profile not found. Please register or contact administration.");
        }
        
        // Auto-approve demo driver test accounts
        if (profile && profile.status === 'pending' && (profile.email.startsWith('demodriver') || profile.email.includes('driver'))) {
          await client.from('profiles').update({ status: 'approved' }).eq('id', userId);
          profile.status = 'approved';
        }

        // 4. Handle Redirection based on Role and Approval Status
        toggleLoading(false);
        
        if (profile.role === 'admin') {
          showToast("Welcome back, Admin!", "success");
          setTimeout(() => {
            window.location.href = getPath('aavinadminmonitoringdashboard/dashboard.html');
          }, 600);
        } else if (profile.status === 'pending') {
          showStatusOverlay('pending');
        } else if (profile.status === 'rejected') {
          showStatusOverlay('rejected');
        } else if (profile.status === 'approved') {
          showToast(`Welcome back, ${profile.name}!`, "success");
          setTimeout(() => {
            // Route based on role
            if (profile.role === 'gm') {
              window.location.href = getPath('gm/dashboard.html');
            } else if (profile.role === 'pi_agm') {
              window.location.href = getPath('pi-agm/dashboard.html');
            } else if (profile.role === 'executive_officer') {
              window.location.href = getPath('eo/dashboard.html');
            } else if (profile.role === 'transport_officer' || profile.role === 'driver') {
              window.location.href = getPath('transport.html');
            } else if (profile.role === 'qc_worker') {
              window.location.href = getPath('qc-worker/dashboard.html');
            } else if (profile.role === 'qc_agm') {
              window.location.href = getPath('qc-agm/dashboard.html');
            } else if (profile.role === 'user') {
              window.location.href = getPath('worker/dashboard.html');
            } else {
              showToast("Your role does not have an assigned dashboard.", "error");
            }
          }, 800);
        }
      } catch (err) {
        console.error("❌ Login failed:", err);
        showToast(err.message || "Invalid credentials or login failed.", "error");
        if (typeof UIStates !== 'undefined' && submitBtn) UIStates.setSaving(submitBtn, false);
        toggleLoading(false);
      }
    });
  }

  // Display status overlays directly on the login form for pending/rejected
  function showStatusOverlay(status) {
    toggleLoading(false);
    const card = document.querySelector('.auth-card');
    if (!card) return;
    
    if (status === 'pending') {
      card.innerHTML = `
        <div class="reg-success">
          <div class="check-icon" style="background:var(--amber-50);border-color:#fde68a;color:var(--amber-600);">⏱</div>
          <h2>Pending Approval</h2>
          <p>Your account is waiting for administrator approval.</p>
          <div class="mt-3">
            <a href="login.html" class="btn btn-outline btn-block">Back to Login</a>
          </div>
        </div>
      `;
    } else if (status === 'rejected') {
      card.innerHTML = `
        <div class="reg-success">
          <div class="check-icon" style="background:var(--red-50);border-color:#fecaca;color:var(--red-600);">✗</div>
          <h2>Account Rejected</h2>
          <p>Your account has been rejected. Please contact the administrator.</p>
          <div class="mt-3">
            <a href="login.html" class="btn btn-outline btn-block">Back to Login</a>
          </div>
        </div>
      `;
    }
  }
});
