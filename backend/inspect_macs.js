require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkData() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("Fetching some qc_excel_import_rows...");
  
  const { data, error } = await adminClient
    .from('qc_excel_import_rows')
    .select('id, test_date, overall_result, raw_data, bmc_name, fat, snf')
    .limit(5);

  if (error) {
    console.error("ERROR:", error.message);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

checkData();
