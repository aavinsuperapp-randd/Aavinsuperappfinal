const fs = require('fs');
let c = fs.readFileSync('backend/server.js', 'utf8');

c = c.replace(
`.order('created_at', { ascending: false }
};
app.get('/api/pi-agm/mileage', requirePiAgm, mileageHandler);
app.get('/api/transport/mileage', requireTransportOfficer, mileageHandler);

    if (from_date) query = query.gte('created_at', \`\${from_date}T00:00:00\`);`,
`.order('created_at', { ascending: false });

    if (from_date) query = query.gte('created_at', \`\${from_date}T00:00:00\`);`
);

c = c.replace(
`  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});`,
`  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/pi-agm/mileage', requirePiAgm, mileageHandler);
app.get('/api/transport/mileage', requireTransportOfficer, mileageHandler);`
);

fs.writeFileSync('backend/server.js', c);
console.log('Fixed syntax error in backend/server.js');
