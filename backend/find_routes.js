const fs = require('fs');
const path = require('path');

const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const lines = serverJs.split('\n');

lines.forEach((line, idx) => {
  if (line.match(/app\.(get|post|put|delete|patch)\s*\(/i)) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
