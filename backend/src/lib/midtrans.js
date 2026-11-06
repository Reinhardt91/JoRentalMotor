// Pemanggil API Midtrans (Core API). Semua kunci dibaca dari .env, tidak ada yang ditulis di kode.
// MIDTRANS_API_URL hanya untuk pengujian otomatis dengan server tiruan; biarkan kosong saat dipakai sungguhan.
function baseUrl() {
  if (process.env.MIDTRANS_API_URL) return process.env.MIDTRANS_API_URL;
  return process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
}

function authHeader() {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) throw new Error('MIDTRANS_SERVER_KEY belum diisi di .env');
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

async function panggil(method, path, body) {
  const r = await fetch(baseUrl() + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authHeader() },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  return { http: r.status, data };
}

// Membuat transaksi QRIS. Mengembalikan URL gambar QR dan identitas transaksi.
async function buatQris({ orderId, jumlah, menitBerlaku }) {
  const { http, data } = await panggil('POST', '/v2/charge', {
    payment_type: 'qris',
    transaction_details: { order_id: orderId, gross_amount: jumlah },
    qris: { acquirer: 'gopay' },
    custom_expiry: { expiry_duration: menitBerlaku, unit: 'minute' },
  });
  if (String(data.status_code) !== '201') {
    const e = new Error(data.status_message || `Midtrans menolak permintaan (HTTP ${http})`);
    e.midtrans = data;
    throw e;
  }
  const aksi = (data.actions || []).find((a) => a.name === 'generate-qr-code');
  return {
    transaction_id: data.transaction_id || null,
    transaction_time: data.transaction_time || null,
    expiry_time: data.expiry_time || null,
    qr_url: aksi ? aksi.url : null,
  };
}

// Get Status API: dipakai saat pengajuan lama perlu dibereskan (dan nanti oleh job rekonsiliasi)
async function cekStatus(orderId) {
  return panggil('GET', `/v2/${encodeURIComponent(orderId)}/status`);
}

// Membuat QR yang belum dibayar tidak berlaku lagi
async function kedaluwarsakan(orderId) {
  return panggil('POST', `/v2/${encodeURIComponent(orderId)}/expire`);
}

const mode = () => (process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'production' : 'sandbox');

module.exports = { buatQris, cekStatus, kedaluwarsakan, mode };
