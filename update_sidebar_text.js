const fs = require('fs');
const files = ['dashboard.html', 'duty.html', 'vehicles.html', 'macs-data.html', 'driver-analysis.html', 'fleet.html'];
files.forEach(f => {
  let p = 'frontend/transport/' + f;
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(/<span>👥<\/span> Fleet &amp; Staff/g, '<span>⛽</span> Mileage Data');
  c = c.replace(/<span>👥<\/span> Fleet & Staff/g, '<span>⛽</span> Mileage Data');
  fs.writeFileSync(p, c);
});
console.log('Done replacing sidebar text');
