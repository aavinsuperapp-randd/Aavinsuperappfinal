const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

code = code.replace(/adminClient\.from\('trips'\)\.select\('\*'\)\.order/g, 'adminClient.from(\'trips\').select(\'*\').neq(\'status\', \'deleted\').order');
code = code.replace(/adminClient\.from\('trips'\)\.select\('\*'\)\.gte/g, 'adminClient.from(\'trips\').select(\'*\').neq(\'status\', \'deleted\').gte');
code = code.replace(/adminClient\.from\('driver_trips'\)\.select\('\*'\)/g, 'adminClient.from(\'driver_trips\').select(\'*\').neq(\'status\', \'deleted\')');
code = code.replace(/adminClient\.from\('trips'\)\.select\('\*'\)/g, 'adminClient.from(\'trips\').select(\'*\').neq(\'status\', \'deleted\')');

code = code.replace(
  /\.from\('driver_trips'\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\('id', id\);/g,
  '.from(\'driver_trips\').update({ status: \'deleted\' }).eq(\'id\', id);'
);
code = code.replace(
  /\.from\('trips'\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\('id', id\);/g,
  '.from(\'trips\').update({ status: \'deleted\' }).eq(\'id\', id);'
);

const oldPatch = \pp.patch('/api/driver/trips/:id/location', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required.' });

  try {
    const { data, error } = await adminClient
      .from('driver_trips')
      .update({
        end_lat: Number(lat),
        end_lng: Number(lng),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select('id, end_lat, end_lng');\;

const newPatch = \pp.patch('/api/driver/trips/:id/location', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { lat, lng, tracking_status } = req.body;
  
  if (!lat && !lng && !tracking_status) return res.status(400).json({ error: 'lat/lng or tracking_status required.' });

  try {
    const { data: trip } = await adminClient.from('driver_trips').select('remarks, start_lat, start_lng').eq('id', req.params.id).single();
    
    let remarks = trip.remarks || '';
    
    let journey = [];
    if (remarks.includes('__JOURNEY_DATA__=')) {
      try {
        const jStr = remarks.split('__JOURNEY_DATA__=')[1].split('\\n')[0];
        journey = JSON.parse(jStr);
      } catch(e) {}
    }
    
    let interruptions = [];
    if (remarks.includes('__INTERRUPTIONS_DATA__=')) {
      try {
        const iStr = remarks.split('__INTERRUPTIONS_DATA__=')[1].split('\\n')[0];
        interruptions = JSON.parse(iStr);
      } catch(e) {}
    }

    const now = new Date().toISOString();
    let updatePayload = { updated_at: now };

    if (lat && lng) {
      updatePayload.end_lat = Number(lat);
      updatePayload.end_lng = Number(lng);
      journey.push({ lat: Number(lat), lng: Number(lng), timestamp: now });
      if (!trip.start_lat) {
        updatePayload.start_lat = Number(lat);
        updatePayload.start_lng = Number(lng);
      }
    }

    if (tracking_status) {
      interruptions.push({ status: tracking_status, timestamp: now });
    }
    
    let cleanRemarks = remarks.split('\\n__JOURNEY_DATA__=')[0].split('\\n__INTERRUPTIONS_DATA__=')[0];
    let newRemarks = cleanRemarks;
    if (journey.length > 0) newRemarks += '\\n__JOURNEY_DATA__=' + JSON.stringify(journey);
    if (interruptions.length > 0) newRemarks += '\\n__INTERRUPTIONS_DATA__=' + JSON.stringify(interruptions);
    updatePayload.remarks = newRemarks;

    const { data, error } = await adminClient
      .from('driver_trips')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('id, end_lat, end_lng, remarks');\;

if(code.includes(oldPatch)) {
  code = code.replace(oldPatch, newPatch);
  fs.writeFileSync('backend/server.js', code);
  console.log('Successfully updated server.js');
} else {
  console.log('Could not find oldPatch in server.js');
}

