// register.js - Registration logic with Supabase Auth + Database Profile creation

document.addEventListener('DOMContentLoaded', async () => {
  const registerForm = document.getElementById('register-form');
  const roleCards = document.querySelectorAll('.role-option');
  const roleInput = document.getElementById('reg-role');
  const fileInput = document.getElementById('reg-image');
  const fileTrigger = document.getElementById('reg-image-trigger');
  const imgPreview = document.getElementById('reg-image-preview');
  
  let selectedFile = null;

  // 1. Role Selection Click Handlers
  roleCards.forEach(card => {
    card.addEventListener('click', () => {
      roleCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      roleInput.value = card.dataset.role;
    });
  });

  // 2. Profile Image Selection & Preview Handler
  if (fileTrigger && fileInput) {
    fileTrigger.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Validate file type & size (max 2MB, jpg/png/webp)
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
          showToast('Invalid file format. Please upload JPG, PNG or WEBP.', 'error');
          fileInput.value = '';
          return;
        }
        if (file.size > 2 * 1024 * 1024) {
          showToast('Image size exceeds 2MB limit.', 'error');
          fileInput.value = '';
          return;
        }
        
        selectedFile = file;
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
          imgPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // 3. Form Submit Handler
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const role = roleInput.value;
      const name = document.getElementById('reg-name').value.trim();
      const dob = document.getElementById('reg-dob').value;
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      
      // Basic Validations
      if (!role) {
        showToast('Please select your account type.', 'error');
        return;
      }
      if (password.length < 6) {
        showToast('Password must be at least 6 characters long.', 'error');
        return;
      }
      
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (typeof UIStates !== 'undefined' && submitBtn) {
        UIStates.setSaving(submitBtn, true, 'Submitting registration...');
      } else {
        toggleLoading(true);
      }

      try {
        // POST to backend — server uses service role key to create user
        // with no email confirmation and insert profile bypassing RLS
        const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com';
        const res = await fetch(`${baseUrl}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, dob, email, password, role })
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'Registration failed.');
        }

        if (typeof UIStates !== 'undefined' && submitBtn) UIStates.setSaving(submitBtn, false);
        toggleLoading(false);
        showRegistrationSuccess();

      } catch (err) {
        console.error("❌ Registration error:", err);
        showToast(err.message || "Failed to register account.", "error");
        if (typeof UIStates !== 'undefined' && submitBtn) UIStates.setSaving(submitBtn, false);
        toggleLoading(false);
      }
    });
  }

  // Display clean success screen
  function showRegistrationSuccess() {
    const card = document.querySelector('.auth-card');
    card.innerHTML = `
      <div class="reg-success">
        <div class="check-icon">✓</div>
        <h2>Registration successful</h2>
        <p>Your account has been submitted for administrator approval.</p>
        <p class="text-muted text-sm mt-1">Once approved, you can log in to access your dashboard.</p>
        <div class="mt-3">
          <a href="login.html" class="btn btn-primary btn-block">Back to Login</a>
        </div>
      </div>
    `;
  }
});
