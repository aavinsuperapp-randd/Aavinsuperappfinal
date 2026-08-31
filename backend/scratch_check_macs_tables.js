require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');

async function checkTripsColumns() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Check trips table columns
  const { data: tripRow, error: tripErr } = await adminClient.from('trips').select('*').limit(1);
  if (tripErr) {
    console.log('trips table error:', tripErr.message);
  } else if (tripRow && tripRow.length > 0) {
    console.log('trips columns:', Object.keys(tripRow[0]).join(', '));
  } else {
    console.log('trips table: exists but empty');
  }
  
  // Check driver_trips table columns
  const { data: dtRow, error: dtErr } = await adminClient.from('driver_trips').select('*').limit(1);
  if (dtErr) {
    console.log('driver_trips table error:', dtErr.message);
  } else if (dtRow && dtRow.length > 0) {
    console.log('driver_trips columns:', Object.keys(dtRow[0]).join(', '));
  } else {
    console.log('driver_trips table: exists but empty');
  }

  // Check qc_lab_tests table columns  
  const { data: qcRow, error: qcErr } = await adminClient.from('qc_lab_tests').select('*').limit(1);
  if (qcErr) {
    console.log('qc_lab_tests table error:', qcErr.message);
  } else if (qcRow && qcRow.length > 0) {
    console.log('qc_lab_tests columns:', Object.keys(qcRow[0]).join(', '));
  } else {
    console.log('qc_lab_tests table: exists but empty');
  }

  // Check trip_bmc_visits table columns
  const { data: vRow, error: vErr } = await adminClient.from('trip_bmc_visits').select('*').limit(1);
  if (vErr) {
    console.log('trip_bmc_visits table error:', vErr.message);
  } else if (vRow && vRow.length > 0) {
    console.log('trip_bmc_visits columns:', Object.keys(vRow[0]).join(', '));
  } else {
    console.log('trip_bmc_visits table: exists but empty');
  }

  // Check if trips.duty_type exists by trying to select it
  const { data: dtCheck, error: dtCheckErr } = await adminClient.from('trips').select('duty_type').limit(1);
  if (dtCheckErr) {
    console.log('\ntrips.duty_type column: DOES NOT EXIST ->', dtCheckErr.message);
  } else {
    console.log('\ntrips.duty_type column: EXISTS');
  }

  // Check if trip_bmc_visits.duty_period exists
  const { data: vpCheck, error: vpCheckErr } = await adminClient.from('trip_bmc_visits').select('duty_period').limit(1);
  if (vpCheckErr) {
    console.log('trip_bmc_visits.duty_period column: DOES NOT EXIST ->', vpCheckErr.message);
  } else {
    console.log('trip_bmc_visits.duty_period column: EXISTS');
  }

  // Check if qc_lab_tests.duty_period exists
  const { data: qpCheck, error: qpCheckErr } = await adminClient.from('qc_lab_tests').select('duty_period').limit(1);
  if (qpCheckErr) {
    console.log('qc_lab_tests.duty_period column: DOES NOT EXIST ->', qpCheckErr.message);
  } else {
    console.log('qc_lab_tests.duty_period column: EXISTS');
  }
}

checkTripsColumns();
