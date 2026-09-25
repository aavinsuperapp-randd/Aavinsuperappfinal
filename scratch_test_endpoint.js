async function test() {
  const res = await fetch('https://aavin-backend.onrender.com/api/admin/society-data/fetch/start', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer fake_token_123' }
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Content:', text);
}
test();
