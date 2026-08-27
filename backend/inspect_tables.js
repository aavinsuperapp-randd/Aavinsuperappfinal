require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');

async function inspect() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("Inspecting tables...");

  const tables = ['bmcs', 'driver_trips', 'trips', 'macs_readings', 'qc_excel_import_rows', 'bmc_daily_records'];
  for (const t of tables) {
    const { data, error } = await adminClient.from(t).select('*').limit(1);
    if (error) {
      console.log(`Table '${t}': Error -> ${error.message} (${error.code})`);
    } else {
      console.log(`Table '${t}': OK. Columns -> ${data.length > 0 ? Object.keys(data[0]).join(', ') : 'Empty table'}`);
    }
  }
}

inspect();
