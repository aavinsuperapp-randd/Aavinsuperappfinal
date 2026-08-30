const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, 'frontend', 'admin');
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html'));

const linkHtml = `        <a href="users.html" class="admin-nav-item">
          <span>👥</span> Users
        </a>`;

for (const file of files) {
  const filePath = path.join(adminDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // If already has users link, skip
  if (content.includes('href="users.html"')) {
    if (file === 'users.html') {
      content = content.replace(/<a href="users.html" class="admin-nav-item">/g, '<a href="users.html" class="admin-nav-item active">');
      fs.writeFileSync(filePath, content);
    }
    continue;
  }

  // Insert before verification.html
  const target = '<a href="verification.html"';
  if (content.includes(target)) {
    content = content.replace(target, `${linkHtml}\n        ${target}`);
  } else {
    console.warn('Could not find verification link in', file);
  }
  
  if (file === 'users.html') {
    // Also remove the active class from verification if it exists
    content = content.replace(/<a href="verification.html" class="admin-nav-item active">/g, '<a href="verification.html" class="admin-nav-item">');
    // Add active class to users.html
    content = content.replace(/<a href="users.html" class="admin-nav-item">/g, '<a href="users.html" class="admin-nav-item active">');
  }

  fs.writeFileSync(filePath, content);
  console.log('Updated', file);
}
