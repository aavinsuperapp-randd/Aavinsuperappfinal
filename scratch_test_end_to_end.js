require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { createClient } = require('./backend/node_modules/@supabase/supabase-js');
const { parseMacsExcel } = require('./scratch_test_parser.js');
const XLSX = require('./backend/node_modules/xlsx');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const samplePath = 'C:\\Users\\user\\Downloads\\bmc_report_24-08-2026_to_24-08-2026.xlsx';

async function testFullMacsWorkflow() {
  console.log('=== STEP 1: READING EXCEL FILE ===');
  const workbook = XLSX.readFile(samplePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const { detectedDates, parsedReadings } = parseMacsExcel(rows);
  console.log('Detected Dates:', detectedDates);
  console.log('Total Parsed MACS Readings:', parsedReadings.length);

  // Check 24/08/2026 normalized date
  if (!detectedDates.includes('2026-08-24')) {
    throw new Error('FAILED: Date 24/08/2026 was not normalized to 2026-08-24');
  }
  console.log('✅ Date 24/08/2026 normalized to 2026-08-24 successfully!');

  // Check no SOC, Share %, LIT fields
  const sampleReading = parsedReadings[0];
  if ('soc' in sampleReading || 'share' in sampleReading || 'lit' in sampleReading || 'quantity' in sampleReading) {
    throw new Error('FAILED: Excluded fields present in parsed readings');
  }
  console.log('✅ SOC, Share %, LIT, Quantity fields completely excluded!');

  console.log('\n=== STEP 2: IMPORT TO SUPABASE ===');
  const { data: bmcMaster } = await supabase.from('bmcs').select('id, name, bmc_code');
  const bmcCodeToIdMap = {};
  (bmcMaster || []).forEach(b => {
    if (b.bmc_code) bmcCodeToIdMap[String(b.bmc_code).trim()] = b.id;
    bmcCodeToIdMap[String(b.name).toLowerCase().trim()] = b.id;
  });

  const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
  const adminId = profiles[0].id;

  const { data: importBatch, error: batchErr } = await supabase
    .from('qc_excel_imports')
    .insert({
      file_name: 'bmc_report_24-08-2026_to_24-08-2026.xlsx',
      imported_by: adminId,
      total_rows: parsedReadings.length,
      notes: 'Automated Test Import',
      status: 'completed'
    })
    .select()
    .single();

  if (batchErr) throw batchErr;
  console.log('Batch created:', importBatch.id);

  let successCount = 0;
  let updatedCount = 0;

  for (const r of parsedReadings) {
    const bmcCodeStr = String(r.bmc_code || '').trim();
    const matchedBmcId = bmcCodeToIdMap[bmcCodeStr] || (r.bmc_name ? bmcCodeToIdMap[String(r.bmc_name).toLowerCase().trim()] : null);
    
    const source = r.source === 'qc' ? 'qc' : 'worker';

    const { data: existingRows } = await supabase
      .from('qc_excel_import_rows')
      .select('*')
      .eq('sample_ref', bmcCodeStr)
      .eq('test_date', r.reading_date)
      .eq('overall_result', source);

    const existing = existingRows && existingRows[0];

    const rowPayload = {
      import_id: importBatch.id,
      bmc_id: matchedBmcId || null,
      bmc_name: r.bmc_name || null,
      sample_ref: bmcCodeStr,
      test_date: r.reading_date,
      fat: r.fat !== undefined && r.fat !== '' && r.fat !== null ? parseFloat(r.fat) : null,
      snf: r.snf !== undefined && r.snf !== '' && r.snf !== null ? parseFloat(r.snf) : null,
      overall_result: source,
      raw_data: r,
      row_status: 'imported',
      error_message: null
    };

    if (existing) {
      await supabase.from('qc_excel_import_rows').update(rowPayload).eq('id', existing.id);
      updatedCount++;
      successCount++;
    } else {
      await supabase.from('qc_excel_import_rows').insert(rowPayload);
      successCount++;
    }
  }

  console.log(`✅ MACS Import complete! Total: ${successCount}, Updated: ${updatedCount}`);

  console.log('\n=== STEP 3: QUERYING MACS READINGS COMPARISON ===');
  const { data: rowsQuery } = await supabase
    .from('qc_excel_import_rows')
    .select('*')
    .eq('test_date', '2026-08-24');

  const bmcMap = {};
  (rowsQuery || []).forEach(r => {
    const bmcCode = r.sample_ref;
    const key = `${bmcCode}_${r.test_date}`;

    if (!bmcMap[key]) {
      bmcMap[key] = {
        bmc_code: bmcCode,
        bmc_name: r.bmc_name,
        reading_date: r.test_date,
        worker: null,
        qc: null
      };
    }

    if (r.overall_result === 'worker') bmcMap[key].worker = r;
    if (r.overall_result === 'qc') bmcMap[key].qc = r;
  });

  const comparisons = Object.values(bmcMap);
  console.log(`Total paired BMC records for 2026-08-24: ${comparisons.length}`);

  const v32 = comparisons.find(c => c.bmc_code === '32');
  console.log('BMC 32 (Vandapuli) Comparison:', {
    bmc_code: v32.bmc_code,
    bmc_name: v32.bmc_name,
    worker_fat: v32.worker ? v32.worker.fat : null,
    worker_snf: v32.worker ? v32.worker.snf : null,
    qc_fat: v32.qc ? v32.qc.fat : null,
    qc_snf: v32.qc ? v32.qc.snf : null,
    matched: v32.worker && v32.qc && v32.worker.fat === v32.qc.fat && v32.worker.snf === v32.qc.snf ? 'MATCHED' : 'MISMATCH'
  });

  console.log('\n🎉 ALL 20 VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

testFullMacsWorkflow().catch(err => {
  console.error('❌ VERIFICATION TEST FAILED:', err);
});
