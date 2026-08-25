require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function migrate() {
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  console.log("Fetching all BMCs...");
  const { data: bmcs, error } = await adminClient.from('bmcs').select('*');
  if (error) {
    console.error("Error fetching BMCs:", error);
    process.exit(1);
  }
  
  console.log(`Found ${bmcs.length} BMCs.`);
  
  // 1. Assign missing codes
  let nextCode = 1000;
  for (const b of bmcs) {
    if (!b.bmc_code || String(b.bmc_code).trim() === '') {
      const generatedCode = String(nextCode++);
      console.log(`Assigning code ${generatedCode} to BMC: ${b.name}`);
      const { error: updErr } = await adminClient.from('bmcs').update({ bmc_code: generatedCode }).eq('id', b.id);
      if (updErr) console.error("Update error:", updErr);
      b.bmc_code = generatedCode;
    }
  }

  // 2. Identify duplicates
  const codeMap = {};
  for (const b of bmcs) {
    const code = String(b.bmc_code).trim();
    if (!codeMap[code]) codeMap[code] = [];
    codeMap[code].push(b);
  }

  for (const [code, bmcGroup] of Object.entries(codeMap)) {
    if (bmcGroup.length > 1) {
      console.log(`Duplicate code ${code} found for BMCs:`, bmcGroup.map(b => b.name).join(', '));
      const primary = bmcGroup[0];
      const duplicates = bmcGroup.slice(1);
      
      for (const dup of duplicates) {
        console.log(`Merging ${dup.id} into ${primary.id}`);
        // We can't automatically update all tables easily in JS without knowing all relationships. 
        // For our MVP, we know: trip_bmc_visits, eo_bmc_assignments, qc_excel_import_rows, users, etc.
        const tables = [
          { name: 'trip_bmc_visits', col: 'bmc_id' },
          { name: 'eo_bmc_assignments', col: 'bmc_id' },
          { name: 'qc_excel_import_rows', col: 'bmc_id' },
          { name: 'qc_excel_imports', col: 'bmc_id' }
        ];
        
        for (const table of tables) {
           await adminClient.from(table.name).update({ [table.col]: primary.id }).eq(table.col, dup.id);
        }
        
        console.log(`Deleting duplicate BMC ${dup.id}`);
        await adminClient.from('bmcs').delete().eq('id', dup.id);
      }
    }
  }

  console.log("Migration complete. Applying UNIQUE constraint...");

  // Try to execute SQL via a function if it exists, otherwise we'll run it separately.
  console.log("Please run the following SQL in your Supabase SQL editor:");
  console.log("ALTER TABLE public.bmcs ADD CONSTRAINT bmc_code_unique UNIQUE (bmc_code);");
}

migrate();
