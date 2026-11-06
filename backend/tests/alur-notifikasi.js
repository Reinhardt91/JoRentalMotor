// Uji halaman admin "Log notifikasi" (Rumusan 4): daftar notifikasi gagal, ringkasan, dan eksekusi scheduler.
// Butuh: backend menyala dengan WA_MODE=simulasi (bawaan) dan JOB_AKTIF=false, data segar (schema.sql + npm run seed:demo).
//   node tests/alur-notifikasi.js
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const B = 'http://localhost:' + (process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar' });
let gagal = 0;
const ok = (k, n) => { console.log((k ? '  OK    ' : '  GAGAL ') + n); if (!k) gagal++; };
const call = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
(async () => {
  const A = (await call('POST', '/api/auth/login', null, { email: 'admin@jorental.local', password: 'Admin12345' })).d.token;
  const P = (await call('POST', '/api/auth/login', null, { email: 'pelanggan@test.com', password: 'Pelanggan123' })).d.token;
  const idSewa = (await pool.query('SELECT id_sewa FROM sewa ORDER BY id_sewa LIMIT 1')).rows[0].id_sewa;
  const antre = (no, isi) => pool.query(
    `INSERT INTO notifikasi_whatsapp (id_sewa, jenis_notifikasi, no_tujuan, isi_pesan, tanggal_jadwal)
     VALUES ($1, 'KONFIRMASI_PERPANJANGAN', $2, $3, CURRENT_DATE) RETURNING id_notifikasi`, [idSewa, no, isi]).then((r) => r.rows[0].id_notifikasi);
  const kirim = () => call('POST', '/api/admin/jobs/pengirim', A);
  const majukan = (id) => pool.query(`UPDATE notifikasi_whatsapp SET coba_lagi_pada = LOCALTIMESTAMP - interval '1 minute' WHERE id_notifikasi = $1`, [id]);

  console.log('\n[1] Siapkan data: 2 pesan terkirim, 1 pesan gagal setelah 3 percobaan, 1 pesan masih menunggu');
  await antre('6281234567890', 'Pesan uji terkirim A');
  await antre('6281234567891', 'Pesan uji terkirim B');
  const gagalId = await antre('628111110000', 'Pesan uji ke nomor yang selalu gagal');
  await kirim(); await majukan(gagalId); await kirim(); await majukan(gagalId); await kirim();
  await antre('6281234567892', 'Pesan uji menunggu');
  ok((await pool.query('SELECT status_kirim FROM notifikasi_whatsapp WHERE id_notifikasi=$1', [gagalId])).rows[0].status_kirim === 'GAGAL', 'pesan ke nomor 0000 berakhir GAGAL setelah 3 percobaan');

  console.log('\n[2] Daftar notifikasi gagal');
  let r = await call('GET', '/api/admin/notifikasi', A);
  const g = r.d.data.find((x) => x.id_notifikasi === gagalId);
  ok(r.s === 200 && g, 'pesan gagal tampil di daftar bawaan (status GAGAL)');
  ok(g.jumlah_percobaan === 3 && /tidak terdaftar/.test(g.error_message), `jumlah percobaan dan alasan tampil: ${g.jumlah_percobaan} kali, "${g.error_message}"`);
  ok(g.plat_nomor && g.nama_lengkap, `dilengkapi plat dan nama pelanggan (${g.plat_nomor}, ${g.nama_lengkap})`);
  r = await call('GET', '/api/admin/notifikasi?status=PENDING', A); ok(r.d.data.length === 1, 'tab Menunggu berisi 1 pesan');
  r = await call('GET', '/api/admin/notifikasi?status=TERKIRIM', A); ok(r.d.data.length === 2 && r.d.data.every((x) => x.dikirim_pada), 'tab Terkirim berisi 2 pesan dengan waktu kirim');

  console.log('\n[3] Ringkasan');
  r = await call('GET', '/api/admin/notifikasi/ringkasan', A);
  const k = r.d.data;
  ok(k.menunggu === 1 && k.terkirim_7_hari === 2 && k.gagal_7_hari === 1, `menunggu ${k.menunggu}, terkirim ${k.terkirim_7_hari}, gagal ${k.gagal_7_hari}`);
  ok(k.tingkat_keberhasilan_7_hari === 66.7, `tingkat keberhasilan 7 hari = ${k.tingkat_keberhasilan_7_hari}% (2 dari 3 yang selesai diproses)`);
  ok(k.mode_pengiriman === 'simulasi', `mode pengiriman ditampilkan: ${k.mode_pengiriman}`);
  ok(k.eksekusi_terakhir.some((j) => j.nama_job === 'pengirim_whatsapp' && j.status_job === 'SELESAI'), 'eksekusi terakhir job pengirim tampil');

  console.log('\n[4] Hak akses dan masukan');
  ok((await call('GET', '/api/admin/notifikasi', P)).s === 403, 'pelanggan -> 403');
  ok((await call('GET', '/api/admin/notifikasi/ringkasan', P)).s === 403, 'ringkasan untuk pelanggan -> 403');
  ok((await call('GET', '/api/admin/notifikasi?status=HILANG', A)).s === 400, 'status tidak valid -> 400');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
