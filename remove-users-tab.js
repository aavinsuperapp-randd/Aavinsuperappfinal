const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, 'frontend', 'admin');
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html'));

for (const file of files) {
  const filePath = path.join(adminDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Regex to remove the Users link
  const linkRegex = /[ \t]*<a href="users\.html"[^>]*>[\s\S]*?<\/a>\r?\n?/g;
  content = content.replace(linkRegex, '');

  fs.writeFileSync(filePath, content);
  console.log('Removed link from', file);
}
