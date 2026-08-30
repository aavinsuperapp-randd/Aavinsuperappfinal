const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function ensureBucket() {
  const { data: buckets } = await adminClient.storage.listBuckets();
  const exists = buckets && buckets.some(b => b.name === 'bmc_images');
  if (!exists) {
    await adminClient.storage.createBucket('bmc_images', { public: true });
    console.log('Created public bmc_images storage bucket.');
  }
}

async function migrateImages() {
  await ensureBucket();
  const { data: bmcs, error } = await adminClient.from('bmcs').select('*').not('profile_image_url', 'is', null);
  if (error) { console.error('Error fetching BMCs:', error); return; }
  
  let migrated = 0;
  for (const bmc of bmcs) {
    if (bmc.profile_image_url.includes('bmc_images')) continue;
    
    console.log('Migrating BMC:', bmc.bmc_code);
    try {
      const response = await fetch(bmc.profile_image_url);
      if (!response.ok) { console.log('Failed to fetch image for', bmc.bmc_code); continue; }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = `bmc_${bmc.bmc_code}.jpg`;
      
      const { error: uploadError } = await adminClient.storage
        .from('bmc_images')
        .upload(fileName, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });
        
      if (uploadError) { console.log('Upload error for', bmc.bmc_code, uploadError.message); continue; }
      
      const { data: publicUrlData } = adminClient.storage.from('bmc_images').getPublicUrl(fileName);
      if (publicUrlData && publicUrlData.publicUrl) {
        const newUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
        await adminClient.from('bmcs').update({ profile_image_url: newUrl }).eq('id', bmc.id);
        migrated++;
        console.log('Successfully migrated', bmc.bmc_code);
      }
    } catch (err) {
      console.log('Exception for', bmc.bmc_code, err.message);
    }
  }
  console.log('Migration complete. Total migrated:', migrated);
}
migrateImages();
