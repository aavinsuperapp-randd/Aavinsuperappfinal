require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');

async function testRpc() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Try running a raw SQL function if it exists or try creating table via rpc/rest
  const { data, error } = await adminClient.rpc('exec_sql', { sql: 'SELECT 1;' });
  console.log('rpc exec_sql test:', data, error);
}

testRpc();
