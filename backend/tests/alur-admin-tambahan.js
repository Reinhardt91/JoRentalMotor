// Uji halaman admin tambahan: Tinjau perpanjangan bermasalah dan Kelola armada motor.
// Butuh: backend menyala, data segar (schema.sql + npm run seed:demo).
//   node tests/alur-admin-tambahan.js
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { Pool } = require('pg');
const B = 'http://localhost:' + (process.env.PORT || 3000);
const KUNCI = process.env.MIDTRANS_SIGNATURE_SECRET || process.env.MIDTRANS_SERVER_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar' });
let gagal = 0;
const ok = (k, n) => { console.log((k ? '  OK    ' : '  GAGAL ') + n); if (!k) gagal++; };
const call = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
const settle = (orderId, gross) => {
  const b = { order_id: orderId, status_code: '200', gross_amount: gross, transaction_status: 'settlement', transaction_id: 'trx-uji' };
  b.signature_key = crypto.createHash('sha512').update(`${b.order_id}${b.status_code}${b.gross_amount}${KUNCI}`).digest('hex');
  return call('POST', '/api/webhook/midtrans', null, b);
};
(async () => {
  const hari = (await pool.query('select localtimestamp::date::text d')).rows[0].d;
  const D = (n) => { const x = new Date(hari + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const login = async (e, p) => (await call('POST', '/api/auth/login', null, { email: e, password: p })).d.token;
  const P1 = await login('pelanggan@test.com', 'Pelanggan123'), A = await login('admin@jorental.local', 'Admin12345');
  const motor = (await call('GET', '/api/motor', P1)).d.data; const idm = (p) => motor.find((m) => m.plat_nomor === p).id_motor;

  console.log('\n[1] Siapkan satu kasus LUNAS_PERLU_TINDAKAN (sewa diakhiri, lalu pembayaran perpanjangan masuk)');
  const r = (await call('POST', '/api/reservasi', P1, { id_motor: idm('DB 1002 JR'), mulai: D(0), selesai: D(2) })).d.data.id_reservasi;
  await call('POST', `/api/admin/reservasi/${r}/konfirmasi`, A);
  const idSewa = (await call('POST', `/api/admin/reservasi/${r}/mulai-sewa`, A)).d.data.id_sewa;
  const p = (await call('POST', '/api/perpanjangan', P1, { id_sewa: idSewa, tambahan_hari: 1 })).d.data;
  const sv = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.id_sewa === idSewa);
  await call('POST', `/api/admin/sewa/${idSewa}/akhiri`, A, { version: sv.version });
  await settle(p.order_id, `${p.biaya_perpanjangan}.00`);
  ok((await pool.query('select status_perpanjangan from perpanjangan_sewa where id_perpanjangan=$1', [p.id_perpanjangan])).rows[0].status_perpanjangan === 'LUNAS_PERLU_TINDAKAN', 'kasus bermasalah terbentuk');

  console.log('\n[2] Tinjau perpanjangan bermasalah');
  let x = await call('GET', '/api/admin/perpanjangan', A);
  const kasus = x.d.data.find((k) => k.id_perpanjangan === p.id_perpanjangan);
  ok(x.s === 200 && kasus && kasus.order_id === p.order_id && kasus.gross_amount === p.biaya_perpanjangan, 'muncul di daftar, lengkap dengan order_id dan nominal yang sudah dibayar');
  ok(/diakhiri/.test(kasus.catatan_penanganan), `alasan sistem tampil: "${kasus.catatan_penanganan}"`);
  ok((await call('GET', '/api/admin/perpanjangan', P1)).s === 403, 'pelanggan tidak boleh membuka -> 403');
  ok((await call('POST', `/api/admin/perpanjangan/${p.id_perpanjangan}/tangani`, A, { catatan: '' })).s === 400, 'tanpa catatan -> 400');
  x = await call('POST', `/api/admin/perpanjangan/${p.id_perpanjangan}/tangani`, A, { catatan: 'Dana Rp75.000 dikembalikan via transfer' });
  ok(x.s === 200, 'catat penanganan -> 200');
  const t = (await pool.query('select status_perpanjangan, ditangani_oleh, ditangani_pada, catatan_penanganan from perpanjangan_sewa where id_perpanjangan=$1', [p.id_perpanjangan])).rows[0];
  ok(t.status_perpanjangan === 'DITANGANI' && t.ditangani_oleh && t.ditangani_pada, 'status DITANGANI, admin dan waktu penanganan tercatat');
  ok(/Penanganan admin: Dana/.test(t.catatan_penanganan), 'catatan admin disimpan bersama alasan sistem');
  ok((await call('POST', `/api/admin/perpanjangan/${p.id_perpanjangan}/tangani`, A, { catatan: 'ulang lagi' })).s === 409, 'ditangani dua kali -> 409');
  ok(!(await call('GET', '/api/admin/perpanjangan', A)).d.data.some((k) => k.id_perpanjangan === p.id_perpanjangan), 'hilang dari daftar yang perlu tindakan');
  ok((await call('GET', '/api/admin/perpanjangan?status=DITANGANI', A)).d.data.some((k) => k.id_perpanjangan === p.id_perpanjangan && k.ditangani_oleh_email === 'admin@jorental.local'), 'tampil di riwayat yang sudah ditangani');

  console.log('\n[3] Kelola armada: tipe motor');
  x = await call('POST', '/api/admin/tipe-motor', A, { merek: 'Yamaha', nama_model: 'Mio M3', jenis_transmisi: 'MATIC', kapasitas_cc: 125, harga_harian: 70000, harga_mingguan: 420000 });
  ok(x.s === 201, 'tambah tipe -> 201'); const idTipe = x.d.data.id_tipe;
  ok((await call('POST', '/api/admin/tipe-motor', A, { merek: 'Yamaha', nama_model: 'Mio M3', jenis_transmisi: 'MATIC', kapasitas_cc: 125, harga_harian: 70000 })).s === 409, 'tipe ganda -> 409');
  ok((await call('POST', '/api/admin/tipe-motor', A, { merek: 'X', nama_model: '', jenis_transmisi: 'TERBANG', kapasitas_cc: -1, harga_harian: 0 })).s === 400, 'data tipe tidak valid -> 400');
  ok((await call('PATCH', `/api/admin/tipe-motor/${idTipe}`, A, { harga_harian: 72000 })).s === 200, 'ubah harga harian -> 200');
  ok((await call('POST', '/api/admin/tipe-motor', P1, { merek: 'Honda' })).s === 403, 'pelanggan -> 403');

  console.log('\n[4] Kelola armada: unit motor');
  x = await call('POST', '/api/admin/motor', A, { id_tipe: idTipe, plat_nomor: '  db 2001   jr ', warna: 'Merah', tahun_produksi: 2024 });
  ok(x.s === 201 && x.d.data.plat_nomor === 'DB 2001 JR', `tambah unit, plat dirapikan menjadi "${x.d.data && x.d.data.plat_nomor}"`);
  const idBaru = x.d.data.id_motor;
  ok((await call('POST', '/api/admin/motor', A, { id_tipe: idTipe, plat_nomor: 'DB 2001 JR' })).s === 409, 'plat ganda -> 409');
  ok((await call('POST', '/api/admin/motor', A, { id_tipe: idTipe, plat_nomor: 'bukan plat' })).s === 400, 'format plat salah -> 400');
  let mb = (await call('GET', '/api/motor', P1)).d.data.find((m) => m.plat_nomor === 'DB 2001 JR');
  ok(mb && mb.tersedia && mb.harga_harian === 72000, 'unit baru langsung tampil tersedia bagi pelanggan dengan harga baru');
  x = await call('PATCH', `/api/admin/motor/${idBaru}`, A, { kondisi_unit: 'PERBAIKAN' });
  ok(x.s === 200 && x.d.peringatan === null, 'ubah ke PERBAIKAN tanpa jadwal -> tanpa peringatan');
  mb = (await call('GET', '/api/motor', P1)).d.data.find((m) => m.plat_nomor === 'DB 2001 JR');
  ok(!mb.tersedia && mb.status_unit === 'PERBAIKAN', 'pelanggan melihatnya "Dalam perbaikan"');
  ok((await call('POST', '/api/reservasi', P1, { id_motor: idBaru, mulai: D(1), selesai: D(2) })).s === 409, 'unit perbaikan tidak bisa dipesan -> 409');
  await call('PATCH', `/api/admin/motor/${idBaru}`, A, { kondisi_unit: 'SIAP' });
  await call('POST', '/api/reservasi', P1, { id_motor: idBaru, mulai: D(5), selesai: D(6) });
  x = await call('PATCH', `/api/admin/motor/${idBaru}`, A, { kondisi_unit: 'TIDAK_TERSEDIA' });
  ok(x.s === 200 && /1 reservasi/.test(x.d.peringatan || ''), `ubah kondisi saat ada reservasi -> peringatan: "${x.d.peringatan}"`);
  ok((await call('PATCH', `/api/admin/motor/${idBaru}`, A, { kondisi_unit: 'RUSAK' })).s === 400, 'kondisi tidak valid -> 400');
  const ar = (await call('GET', '/api/admin/armada', A)).d.data;
  ok(ar.tipe.some((t2) => t2.id_tipe === idTipe && t2.jumlah_unit === 1) && ar.motor.some((m) => m.id_motor === idBaru && m.reservasi_mendatang === 1), 'ringkasan armada: jumlah unit per tipe dan reservasi mendatang');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
