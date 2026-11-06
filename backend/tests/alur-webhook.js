// Uji webhook Midtrans + rekonsiliasi (Rumusan 1, 2, dan 3).
// Notifikasi dikirim ke backend lokal dengan tanda tangan yang dihitung dari kunci di .env,
// jadi uji ini TIDAK memerlukan ngrok. Butuh: backend menyala, data segar (schema.sql + npm run seed:demo).
//   node tests/alur-webhook.js
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { Pool } = require('pg');
const B = 'http://localhost:' + (process.env.PORT || 3000);
const TIRUAN = process.env.MIDTRANS_API_URL || null;
const KUNCI = process.env.MIDTRANS_SIGNATURE_SECRET || process.env.MIDTRANS_SERVER_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar' });
let gagal = 0;
const ok = (k, n) => { console.log((k ? '  OK    ' : '  GAGAL ') + n); if (!k) gagal++; };
const call = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
const KODE = { settlement: '200', pending: '201', expire: '202', cancel: '202', deny: '202' };
const notif = (orderId, gross, status, kunci = KUNCI, ubah = {}) => {
  const b = { order_id: orderId, status_code: KODE[status], gross_amount: gross, transaction_status: status, payment_type: 'qris', transaction_id: 'trx-uji', fraud_status: 'accept' };
  b.signature_key = crypto.createHash('sha512').update(`${b.order_id}${b.status_code}${b.gross_amount}${kunci}`).digest('hex');
  return { ...b, ...ubah };
};
const kirim = (body) => call('POST', '/api/webhook/midtrans', null, body);
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];

(async () => {
  const hari = (await q1('select localtimestamp::date::text d')).d;
  const D = (n) => { const x = new Date(hari + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const login = async (e, p) => (await call('POST', '/api/auth/login', null, { email: e, password: p })).d.token;
  const P1 = await login('pelanggan@test.com', 'Pelanggan123'), P2 = await login('pelanggan2@test.com', 'Pelanggan123'), A = await login('admin@jorental.local', 'Admin12345');
  const motor = (await call('GET', '/api/motor', P1)).d.data; const idm = (p) => motor.find((m) => m.plat_nomor === p).id_motor;
  const buatSewa = async (tok, plat, lama) => {
    const r = (await call('POST', '/api/reservasi', tok, { id_motor: idm(plat), mulai: D(0), selesai: D(lama) })).d.data.id_reservasi;
    await call('POST', `/api/admin/reservasi/${r}/konfirmasi`, A);
    return (await call('POST', `/api/admin/reservasi/${r}/mulai-sewa`, A)).d.data.id_sewa;
  };
  const ajukan = async (tok, idSewa, hariTambah) => (await call('POST', '/api/perpanjangan', tok, { id_sewa: idSewa, tambahan_hari: hariTambah })).d.data;
  const gross = (p) => `${p.biaya_perpanjangan}.00`;
  const status = async (idP) => (await q1('select status_perpanjangan, catatan_penanganan from perpanjangan_sewa where id_perpanjangan=$1', [idP]));
  const jadwal = async (idSewa) => (await q1('select r.tanggal_selesai::text t, s.version v, s.status_sewa st from sewa s join reservasi r using(id_reservasi) where id_sewa=$1', [idSewa]));
  const logTerakhir = async (orderId) => (await pool.query('select hasil_proses from webhook_log where order_id=$1 order by id_webhook', [orderId])).rows.map((x) => x.hasil_proses);

  const s1 = (await call('GET', '/api/reservasi/saya', P1)).d.data.find((x) => x.status_sewa === 'AKTIF').id_sewa;
  const p1 = await ajukan(P1, s1, 2);
  const awal = await jadwal(s1);

  console.log('\n[1] Notifikasi PALSU ditolak tanpa mengubah data');
  let r = await kirim({ ...notif(p1.order_id, gross(p1), 'settlement'), signature_key: crypto.randomBytes(64).toString('hex') });
  ok(r.s === 403, `signature acak -> 403 (${r.s})`);
  r = await kirim(notif(p1.order_id, gross(p1), 'settlement', 'kunci-penyerang')); ok(r.s === 403, `signature dari kunci lain -> 403 (${r.s})`);
  r = await kirim({ ...notif(p1.order_id, gross(p1), 'settlement'), gross_amount: '1.00' }); ok(r.s === 403, `nominal diubah setelah ditandatangani -> 403 (${r.s})`);
  r = await kirim({ order_id: p1.order_id, transaction_status: 'settlement' }); ok(r.s === 403, `tanpa signature -> 403 (${r.s})`);
  ok((await status(p1.id_perpanjangan)).status_perpanjangan === 'MENUNGGU_PEMBAYARAN', 'perpanjangan tetap MENUNGGU_PEMBAYARAN');
  ok((await jadwal(s1)).t === awal.t, 'jatuh tempo tidak berubah');
  ok((await logTerakhir(p1.order_id)).filter((h) => h === 'DITOLAK_SIGNATURE').length === 4, 'keempat percobaan tercatat DITOLAK_SIGNATURE di webhook_log');

  console.log('\n[2] Notifikasi sah tetapi data tidak cocok / belum lunas');
  r = await kirim(notif('JRM-TIDAK-ADA', '1000.00', 'settlement')); ok(r.s === 200, `order_id tidak dikenal -> 200 tanpa efek (${r.s})`);
  ok((await logTerakhir('JRM-TIDAK-ADA'))[0] === 'DITOLAK_DATA', 'tercatat DITOLAK_DATA');
  r = await kirim(notif(p1.order_id, gross(p1), 'pending')); ok(r.s === 200 && (await status(p1.id_perpanjangan)).status_perpanjangan === 'MENUNGGU_PEMBAYARAN', 'status pending -> tidak ada perubahan');

  console.log('\n[3] PARALEL: 5 notifikasi settlement yang sama datang bersamaan (duplikat)');
  const hs = await Promise.all(Array.from({ length: 5 }, () => kirim(notif(p1.order_id, gross(p1), 'settlement'))));
  ok(hs.every((h) => h.s === 200), `semua dibalas 200: [${hs.map((h) => h.s)}]`);
  const hasil = (await logTerakhir(p1.order_id)).slice(-5);
  ok(hasil.filter((h) => h === 'DIPROSES').length === 1 && hasil.filter((h) => h === 'DUPLIKAT_DIABAIKAN').length === 4, `webhook_log: ${hasil.join(', ')}`);
  const sesudah = await jadwal(s1);
  ok((await status(p1.id_perpanjangan)).status_perpanjangan === 'LUNAS', 'perpanjangan LUNAS');
  ok(sesudah.t === p1.jatuh_tempo_baru, `jatuh tempo diperbarui ${awal.t} -> ${sesudah.t}`);
  ok(sesudah.v === awal.v + 1, `version sewa naik tepat satu kali (${awal.v} -> ${sesudah.v})`);
  const nk = await pool.query(`select isi_pesan from notifikasi_whatsapp where id_perpanjangan=$1`, [p1.id_perpanjangan]);
  ok(nk.rowCount === 1 && /sudah diterima/.test(nk.rows[0].isi_pesan), 'tepat satu konfirmasi WhatsApp masuk antrean');
  r = await kirim(notif(p1.order_id, gross(p1), 'settlement')); ok((await logTerakhir(p1.order_id)).slice(-1)[0] === 'DUPLIKAT_DIABAIKAN', 'notifikasi ulang (retry) kemudian -> DUPLIKAT_DIABAIKAN');
  ok((await q1('select is_processed, transaction_status from pembayaran where order_id=$1', [p1.order_id])).is_processed === true, 'pembayaran is_processed = true, SETTLEMENT');

  console.log('\n[4] Status selain lunas (sewa kedua, DB 1002)');
  const s2 = await buatSewa(P2, 'DB 1002 JR', 2);
  let p = await ajukan(P2, s2, 1); await kirim(notif(p.order_id, gross(p), 'expire'));
  ok((await status(p.id_perpanjangan)).status_perpanjangan === 'KEDALUWARSA', 'expire -> KEDALUWARSA');
  ok((await q1('select transaction_status from pembayaran where order_id=$1', [p.order_id])).transaction_status === 'EXPIRE', 'pembayaran EXPIRE');
  p = await ajukan(P2, s2, 1); await kirim(notif(p.order_id, gross(p), 'deny')); ok((await status(p.id_perpanjangan)).status_perpanjangan === 'GAGAL', 'deny -> GAGAL');
  p = await ajukan(P2, s2, 1); await kirim(notif(p.order_id, gross(p), 'cancel')); ok((await status(p.id_perpanjangan)).status_perpanjangan === 'GAGAL', 'cancel -> GAGAL');
  ok((await jadwal(s2)).t.startsWith(D(2)), 'jadwal sewa kedua tidak berubah');

  console.log('\n[5] Konflik webhook vs edit admin (Optimistic Locking, deterministik)');
  p = await ajukan(P2, s2, 1);
  const v0 = (await jadwal(s2)).v;
  const kuncinya = await pool.connect();
  await kuncinya.query('BEGIN'); await kuncinya.query('SELECT 1 FROM sewa WHERE id_sewa=$1 FOR UPDATE', [s2]); // admin sedang menyunting
  const jalan = kirim(notif(p.order_id, gross(p), 'settlement')); // webhook tiba saat itu
  await new Promise((x) => setTimeout(x, 600));
  await kuncinya.query('UPDATE sewa SET version = version + 1 WHERE id_sewa=$1', [s2]); await kuncinya.query('COMMIT'); kuncinya.release();
  r = await jalan;
  const j5 = await jadwal(s2);
  ok(r.s === 200 && (await status(p.id_perpanjangan)).status_perpanjangan === 'LUNAS', 'webhook tidak gagal walau version berubah: membaca ulang lalu LUNAS');
  ok(j5.v === v0 + 2, `version = ${j5.v} (edit admin +1, webhook +1)`);
  ok(j5.t === p.jatuh_tempo_baru, 'jatuh tempo tetap diperbarui');

  console.log('\n[6] Sewa diakhiri admin sebelum pembayaran masuk -> LUNAS_PERLU_TINDAKAN');
  p = await ajukan(P2, s2, 1);
  const sv = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.id_sewa === s2);
  await call('POST', `/api/admin/sewa/${s2}/akhiri`, A, { version: sv.version });
  if (TIRUAN) ok((await (await fetch(`${TIRUAN}/uji/log`)).json()).some((x) => x === `POST /v2/${p.order_id}/expire`), 'QR yang belum dibayar ikut dimatikan di Midtrans');
  r = await kirim(notif(p.order_id, gross(p), 'settlement'));
  const st6 = await status(p.id_perpanjangan);
  ok(r.s === 200 && st6.status_perpanjangan === 'LUNAS_PERLU_TINDAKAN', `uang masuk tidak hilang jejak: ${st6.status_perpanjangan} (${st6.catatan_penanganan})`);
  ok((await jadwal(s2)).st === 'SELESAI', 'sewa tetap SELESAI, jadwal tidak dibuka kembali');

  console.log('\n[7] Jadwal bentrok: reservasi lain dibuat selama pelanggan menunggu membayar');
  const s3 = await buatSewa(P2, 'DB 1004 JR', 1);
  p = await ajukan(P2, s3, 3);                                    // memperpanjang sampai +4
  const j7 = await jadwal(s3);
  const rb = await call('POST', '/api/reservasi', P1, { id_motor: idm('DB 1004 JR'), mulai: D(2), selesai: D(5) }); // orang lain memesan
  ok(rb.s === 201, 'pelanggan lain berhasil memesan tanggal setelah jatuh tempo lama');
  r = await kirim(notif(p.order_id, gross(p), 'settlement'));
  const st7 = await status(p.id_perpanjangan); const j7b = await jadwal(s3);
  ok(st7.status_perpanjangan === 'LUNAS_PERLU_TINDAKAN', `exclusion constraint menolak, ${st7.status_perpanjangan} (${st7.catatan_penanganan})`);
  ok(j7b.t === j7.t && j7b.v === j7.v, 'jatuh tempo dan version tidak berubah (dibatalkan ke savepoint)');

  console.log('\n[8] Nominal tidak cocok dengan data pembayaran');
  const s4 = await buatSewa(P1, 'DB 1005 JR', 1);
  p = await ajukan(P1, s4, 1);
  r = await kirim(notif(p.order_id, '1000.00', 'settlement'));
  const st8 = await status(p.id_perpanjangan);
  ok(r.s === 200 && st8.status_perpanjangan === 'LUNAS_PERLU_TINDAKAN', `${st8.status_perpanjangan} (${st8.catatan_penanganan})`);
  ok((await jadwal(s4)).t.startsWith(D(1)), 'jatuh tempo tidak berubah');

  if (TIRUAN) {
    console.log('\n[9] Rekonsiliasi: webhook tidak pernah tiba, status diambil lewat Get Status API');
    const s5 = await buatSewa(P1, 'DB 1007 JR', 1);
    p = await ajukan(P1, s5, 1);
    await fetch(`${TIRUAN}/uji/set/${p.order_id}/settlement`);
    await pool.query(`UPDATE pembayaran SET created_at = LOCALTIMESTAMP - interval '3 minutes' WHERE order_id=$1`, [p.order_id]);
    r = await call('POST', '/api/admin/rekonsiliasi', A);
    ok(r.s === 200 && r.d.data.berhasil >= 1, `job rekonsiliasi: ${r.d.pesan}`);
    ok((await status(p.id_perpanjangan)).status_perpanjangan === 'LUNAS', 'perpanjangan LUNAS tanpa webhook');
    ok(!!(await q1('select terakhir_direkonsiliasi from pembayaran where order_id=$1', [p.order_id])).terakhir_direkonsiliasi, 'terakhir_direkonsiliasi tercatat');
    r = await kirim(notif(p.order_id, gross(p), 'settlement'));
    ok((await logTerakhir(p.order_id)).slice(-1)[0] === 'DUPLIKAT_DIABAIKAN', 'webhook yang datang terlambat -> DUPLIKAT_DIABAIKAN');
    ok((await q1(`select status_job from scheduler_log where nama_job='rekonsiliasi_pembayaran' order by id_scheduler_log desc limit 1`)).status_job === 'SELESAI', 'eksekusi job tercatat di scheduler_log');
  }

  console.log('\n[10] Semua notifikasi tercatat');
  const total = (await q1('select count(*)::int n from webhook_log')).n;
  ok(total >= 20, `webhook_log berisi ${total} baris, termasuk yang ditolak`);

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
