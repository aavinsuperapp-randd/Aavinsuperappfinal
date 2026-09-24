require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');
async function run() {
  const r = await fetch(process.env.SUPABASE_URL+'/rest/v1/', {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }
  });
  const d = await r.json();
  console.log('society_code type:', d.definitions.society_data.properties.society_code.type);
}
run().catch(console.error);
