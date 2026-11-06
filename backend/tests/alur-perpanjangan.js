// Uji pengajuan perpanjangan + pembuatan QRIS.
// Butuh: backend menyala, data segar (schema.sql + npm run seed:demo).
// Di komputer Anda, uji ini memanggil Midtrans Sandbox sungguhan (memakai kunci di .env).
//   node tests/alur-perpanjangan.js
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const B = 'http://localhost:' + (process.env.PORT || 3000);
const TIRUAN = process.env.MIDTRANS_API_URL || null; // hanya terisi saat memakai server tiruan
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar' });
let gagal = 0;
const ok = (k, n) => { console.log((k ? '  OK    ' : '  GAGAL ') + n); if (!k) gagal++; };
const call = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
(async () => {
  const login = async (e, p) => (await call('POST', '/api/auth/login', null, { email: e, password: p })).d.token;
  const P1 = await login('pelanggan@test.com', 'Pelanggan123'), P2 = await login('pelanggan2@test.com', 'Pelanggan123');
  const sewa = (await call('GET', '/api/reservasi/saya', P1)).d.data.find((x) => x.status_sewa === 'AKTIF');
  const idSewa = sewa.id_sewa;

  console.log('\n[1] Info perpanjangan sewa demo (jatuh tempo besok 17.00, reservasi pelanggan lain mulai +4 hari 09.00)');
  let r = await call('GET', `/api/sewa/${idSewa}/perpanjangan`, P1);
  ok(r.s === 200 && r.d.data.maks_hari === 2, `batas maksimal = 2 hari (dapat ${r.d.data && r.d.data.maks_hari})`);
  ok(r.d.data.menunggu === null && r.d.data.harga_harian === 75000, 'belum ada pengajuan, harga harian 75.000');
  ok((await call('GET', `/api/sewa/${idSewa}/perpanjangan`, P2)).s === 404, 'pelanggan lain tidak bisa melihat sewa ini -> 404');

  console.log('\n[2] Penolakan');
  ok((await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 3 })).s === 409, 'tambahan 3 hari melewati reservasi berikutnya -> 409');
  ok((await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 0 })).s === 400, 'tambahan 0 hari -> 400');
  ok((await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 'dua' })).s === 400, 'tambahan bukan angka -> 400');
  ok((await call('POST', '/api/perpanjangan', P2, { id_sewa: idSewa, tambahan_hari: 1 })).s === 404, 'pelanggan lain memperpanjang sewa orang -> 404');

  console.log('\n[3] PARALEL: 5 permintaan perpanjangan bersamaan dari pelanggan yang sama (klik ganda / beberapa tab)');
  const hs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 2 })));
  const sukses = hs.filter((h) => h.s === 201);
  ok(sukses.length === 1 && hs.filter((h) => h.s === 409).length === 4, `hasil: [${hs.map((h) => h.s)}] (harus satu 201, empat 409)`);
  const p = sukses[0].d.data;
  ok(p.status_perpanjangan === 'MENUNGGU_PEMBAYARAN' && p.transaction_status === 'PENDING', 'status MENUNGGU_PEMBAYARAN, pembayaran PENDING');
  ok(p.biaya_perpanjangan === 150000 && p.tambahan_hari === 2, `biaya 2 hari = 150.000 (dapat ${p.biaya_perpanjangan})`);
  ok(/^JRM-\d+-[0-9a-f]{6}$/.test(p.order_id) && !!p.qr_url, `order_id ${p.order_id}, QR tersedia`);
  ok(p.jatuh_tempo_baru.slice(11, 16) === '17:00', `jatuh tempo baru tetap pukul 17.00 (${p.jatuh_tempo_baru})`);
  const n = (await pool.query('select count(*)::int n from perpanjangan_sewa where id_sewa=$1', [idSewa])).rows[0].n;
  ok(n === 1, `hanya satu baris perpanjangan tersimpan (${n})`);
  const sv = (await pool.query('select version from sewa where id_sewa=$1', [idSewa])).rows[0].version;
  ok(sv === 0, 'version sewa TIDAK naik saat pengajuan (masih 0)');
  const jt = (await pool.query('select r.tanggal_selesai::text as tanggal_selesai from sewa s join reservasi r using(id_reservasi) where id_sewa=$1', [idSewa])).rows[0].tanggal_selesai;
  ok(jt === p.jatuh_tempo_lama, 'jatuh tempo sewa belum berubah sebelum dibayar');

  console.log('\n[4] Status, info, dan pembatalan');
  r = await call('GET', `/api/perpanjangan/${p.id_perpanjangan}`, P1); ok(r.s === 200 && r.d.data.status_perpanjangan === 'MENUNGGU_PEMBAYARAN', 'status dapat dipantau pemiliknya');
  ok((await call('GET', `/api/perpanjangan/${p.id_perpanjangan}`, P2)).s === 404, 'pelanggan lain -> 404');
  r = await call('GET', `/api/sewa/${idSewa}/perpanjangan`, P1); ok(r.d.data.menunggu && r.d.data.menunggu.id_perpanjangan === p.id_perpanjangan, 'info menampilkan pengajuan yang menunggu (bisa dilanjutkan)');
  r = await call('POST', `/api/perpanjangan/${p.id_perpanjangan}/batal`, P1); ok(r.s === 200, `batal -> 200 (${r.s})`);
  ok((await call('POST', `/api/perpanjangan/${p.id_perpanjangan}/batal`, P1)).s === 409, 'batal dua kali -> 409');
  r = await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 }); ok(r.s === 201, `setelah dibatalkan boleh mengajukan lagi -> 201 (${r.s})`);
  const p2 = r.d.data;

  console.log('\n[5] QR kedaluwarsa dibereskan otomatis sebelum pengajuan baru');
  await pool.query(`UPDATE pembayaran SET expiry_time = LOCALTIMESTAMP - interval '5 minutes' WHERE order_id = $1`, [p2.order_id]);
  r = await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 2 });
  ok(r.s === 201, `pengajuan baru diterima setelah QR lama kedaluwarsa -> 201 (${r.s})`);
  const lama = (await pool.query('select status_perpanjangan from perpanjangan_sewa where id_perpanjangan=$1', [p2.id_perpanjangan])).rows[0].status_perpanjangan;
  ok(lama === 'KEDALUWARSA', `pengajuan lama ditandai KEDALUWARSA (${lama})`);
  const p3 = r.d.data;

  if (TIRUAN) {
    console.log('\n[6] Pengajuan lama ternyata SUDAH DIBAYAR saat QR-nya lewat batas (hanya dengan server tiruan)');
    await fetch(`${TIRUAN}/uji/set/${p3.order_id}/settlement`);
    await pool.query(`UPDATE pembayaran SET expiry_time = LOCALTIMESTAMP - interval '1 minute' WHERE order_id = $1`, [p3.order_id]);
    r = await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 });
    ok(r.s === 409 && /sudah diterima/.test(r.d.pesan), `tidak membuat pengajuan baru, uang tidak hilang jejak -> 409 (${r.s})`);
    const st = (await pool.query('select status_perpanjangan from perpanjangan_sewa where id_perpanjangan=$1', [p3.id_perpanjangan])).rows[0].status_perpanjangan;
    ok(st === 'MENUNGGU_PEMBAYARAN', `pengajuan yang sudah dibayar TIDAK dikedaluwarsakan (${st})`);

    console.log('\n[7] Midtrans bermasalah saat membuat QR');
    await pool.query(`UPDATE perpanjangan_sewa SET status_perpanjangan='GAGAL' WHERE id_perpanjangan=$1`, [p3.id_perpanjangan]);
    await fetch(`${TIRUAN}/uji/rusak/1`);
    r = await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 });
    ok(r.s === 502, `gangguan Midtrans -> 502 dengan pesan jelas (${r.s}) "${r.d.pesan}"`);
    await fetch(`${TIRUAN}/uji/rusak/0`);
    r = await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 });
    ok(r.s === 201, `setelah Midtrans pulih, pelanggan bisa mencoba lagi -> 201 (${r.s})`);
    const kirim = (await (await fetch(`${TIRUAN}/uji/log`)).json()).filter((x) => x.startsWith('POST /v2/charge')).length;
    ok(kirim >= 5, `permintaan charge ke Midtrans tercatat (${kirim})`);
  }

  console.log('\n[8] Sewa yang sudah selesai tidak bisa diperpanjang');
  await pool.query(`UPDATE sewa SET status_sewa='SELESAI' WHERE id_sewa=$1`, [idSewa]);
  await pool.query(`UPDATE perpanjangan_sewa SET status_perpanjangan='GAGAL' WHERE id_sewa=$1 AND status_perpanjangan='MENUNGGU_PEMBAYARAN'`, [idSewa]);
  ok((await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 })).s === 409, 'sewa SELESAI -> 409');
  ok((await call('GET', `/api/sewa/${idSewa}/perpanjangan`, P1)).d.data.maks_hari === 0, 'info menunjukkan maks 0 hari');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
