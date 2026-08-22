require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("Checking tables...");
  
  const { data: assign, error: assignError } = await adminClient.from('eo_bmc_assignments').select('*').limit(1);
  if (assignError) {
    console.error("❌ ERROR accessing eo_bmc_assignments:", assignError.message);
  }

  const { data: bmcs, error: bmcError } = await adminClient.from('bmcs').select('id, name').limit(1);
  const { data: eos, error: eoError } = await adminClient.from('profiles').select('id, name').eq('role', 'executive_officer').limit(1);

  if (bmcs.length > 0 && eos.length > 0) {
    const bmcId = bmcs[0].id;
    const eoId = eos[0].id;
    
    console.log(`Assigning ${bmcId} to ${eoId}`);
    
    const { data: existing, error: existError } = await adminClient
      .from('eo_bmc_assignments')
      .select('*')
      .eq('eo_id', eoId)
      .eq('bmc_id', bmcId)
      .maybeSingle();

    if (existError) console.error(existError);
    console.log("Existing record:", existing);

    let resultError;
    if (existing) {
       const res = await adminClient.from('eo_bmc_assignments').update({ status: 'active' }).eq('id', existing.id);
       resultError = res.error;
    } else {
       const res = await adminClient.from('eo_bmc_assignments').insert({ eo_id: eoId, bmc_id: bmcId, status: 'active' });
       resultError = res.error;
    }
    
    console.log("Update/Insert Error:", resultError || 'None');
    
    const { data: updated } = await adminClient.from('eo_bmc_assignments').select('*').eq('eo_id', eoId).eq('status', 'active');
    console.log("Active assignments for EO:", updated);
  }
}
test();
