require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');

async function checkColumns() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("Checking columns in trip_bmc_visits...");

  const columnsToCheck = ['invoice_serial_no', 'temperature', 'seal_number', 'broken_seal_number'];
  const missingColumns = [];

  for (const col of columnsToCheck) {
    const { error } = await adminClient.from('trip_bmc_visits').select(col).limit(1);
    if (error) {
      if (error.code === 'PGRST200' || error.message.includes('Could not find the column')) {
        missingColumns.push(col);
        console.log(`Column '${col}' is MISSING.`);
      } else {
        console.log(`Column '${col}' Error -> ${error.message}`);
      }
    } else {
      console.log(`Column '${col}' EXISTS.`);
    }
  }

  console.log("\n--- RESULT ---");
  console.log("Missing columns:", missingColumns);
}

checkColumns();
