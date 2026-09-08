const fs = require('fs');
const filePath = 'backend/server.js';
let content = fs.readFileSync(filePath, 'utf8');

const badCode = `      .order('created_at', { ascending: false }
};
app.get('/api/pi-agm/mileage', requirePiAgm, mileageHandler);
app.get('/api/transport/mileage', requireTransportOfficer, mileageHandler);

    if (from_date) query = query.gte('created_at', \`\${from_date}T00:00:00\`);`;

const goodCode = `      .order('created_at', { ascending: false });

    if (from_date) query = query.gte('created_at', \`\${from_date}T00:00:00\`);`;

if (content.includes(badCode)) {
  content = content.replace(badCode, goodCode);
  console.log("Fixed part 1");
}

const badCode2 = `  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});`;

const goodCode2 = `  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/pi-agm/mileage', requirePiAgm, mileageHandler);
app.get('/api/transport/mileage', requireTransportOfficer, mileageHandler);`;

if (content.includes(badCode2)) {
  content = content.replace(badCode2, goodCode2);
  console.log("Fixed part 2");
}

fs.writeFileSync(filePath, content);
console.log('Done');
