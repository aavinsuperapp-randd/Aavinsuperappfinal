require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { createClient } = require('./backend/node_modules/@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const sql = fs.readFileSync('create_macs_readings_tables.sql', 'utf8');

  // Let's test calling postgres query or RPC
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    console.log('RPC exec_sql:', { data, error });
  } catch (e) {
    console.log('RPC catch:', e.message);
  }
}

main();
