const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, 'frontend', 'admin');
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html'));

for (const file of files) {
  const filePath = path.join(adminDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Regex to remove the Trips link
  const tripsRegex = /[ \t]*<a href="trips\.html"[^>]*>[\s\S]*?<\/a>\r?\n?/g;
  content = content.replace(tripsRegex, '');

  // Regex to remove the Executive Officers link
  const eoRegex = /[ \t]*<a href="executive-officers\.html"[^>]*>[\s\S]*?<\/a>\r?\n?/g;
  content = content.replace(eoRegex, '');

  fs.writeFileSync(filePath, content);
  console.log('Removed trips & EO links from', file);
}
