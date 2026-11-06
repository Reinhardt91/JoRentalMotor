// Uji alur admin: konfirmasi, mulai sewa, akhiri sewa (Optimistic Locking).
// Jalankan dari folder backend saat server menyala, setelah: schema.sql + npm run seed:demo
//   node tests/alur-admin.js
// CATATAN: skrip ini mengubah data. Setelah selesai, jalankan ulang schema.sql dan seed:demo.
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
  const hari = (await pool.query('select localtimestamp::date::text d')).rows[0].d;
  const D = (n) => { const x = new Date(hari + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const login = async (e, p) => (await call('POST', '/api/auth/login', null, { email: e, password: p })).d.token;
  const P1 = await login('pelanggan@test.com', 'Pelanggan123'), P2 = await login('pelanggan2@test.com', 'Pelanggan123'), A = await login('admin@jorental.local', 'Admin12345');
  const motor = (await call('GET', '/api/motor', P1)).d.data; const id = (p) => motor.find((m) => m.plat_nomor === p).id_motor;
  const pesan = async (tok, plat, a, b) => (await call('POST', '/api/reservasi', tok, { id_motor: id(plat), mulai: D(a), selesai: D(b) })).d.data.id_reservasi;

  console.log('\n[1] Konfirmasi lalu Mulai sewa (serah terima hari ini)');
  const r1 = await pesan(P1, 'DB 1002 JR', 0, 2);
  ok((await call('POST', `/api/admin/reservasi/${r1}/konfirmasi`, A)).s === 200, 'admin mengonfirmasi reservasi');
  let siap = (await call('GET', '/api/admin/reservasi?status=DIKONFIRMASI', A)).d.data.find((x) => x.id_reservasi === r1);
  ok(siap && siap.bisa_diserahkan === true && siap.id_sewa === null, 'muncul di "siap diserahkan" dengan bisa_diserahkan = true');
  let r = await call('POST', `/api/admin/reservasi/${r1}/mulai-sewa`, A);
  ok(r.s === 201 && r.d.data.status_sewa === 'AKTIF' && r.d.data.version === 0, `mulai sewa -> 201, AKTIF, version 0 (${r.s})`);
  r = await call('POST', `/api/admin/reservasi/${r1}/mulai-sewa`, A); ok(r.s === 409, `mulai sewa dua kali -> 409 (${r.s}) "${r.d.pesan}"`);
  r = await call('GET', '/api/reservasi/saya', P1); ok(r.d.data.find((x) => x.id_reservasi === r1).status_sewa === 'AKTIF', 'pelanggan melihat sewanya "Sedang berjalan"');

  console.log('\n[2] Aturan serah terima');
  const r2 = await pesan(P2, 'DB 1004 JR', 5, 7); await call('POST', `/api/admin/reservasi/${r2}/konfirmasi`, A);
  r = await call('POST', `/api/admin/reservasi/${r2}/mulai-sewa`, A); ok(r.s === 409, `belum tanggalnya -> 409 (${r.s}) "${r.d.pesan}"`);
  const r3 = await pesan(P2, 'DB 1005 JR', 0, 1);
  r = await call('POST', `/api/admin/reservasi/${r3}/mulai-sewa`, A); ok(r.s === 409, `belum dikonfirmasi -> 409 (${r.s})`);
  // Simulasi: sewa demo DB 1001 terlambat (jadwalnya sudah lewat, motor belum kembali)
  await pool.query(`UPDATE reservasi SET tanggal_selesai = (CURRENT_DATE - 1) + time '17:00' WHERE id_reservasi = 1`);
  const r4 = await pesan(P2, 'DB 1001 JR', 0, 1); await call('POST', `/api/admin/reservasi/${r4}/konfirmasi`, A);
  r = await call('POST', `/api/admin/reservasi/${r4}/mulai-sewa`, A); ok(r.s === 409, `unit belum dikembalikan penyewa sebelumnya -> 409 (${r.s}) "${r.d.pesan}"`);
  r = await call('GET', '/api/admin/sewa', A); const telat = r.d.data.find((x) => x.plat_nomor === 'DB 1001 JR');
  ok(telat && telat.lewat_jatuh_tempo === true, 'pantau sewa menandai DB 1001 lewat jatuh tempo');

  console.log('\n[3] PARALEL: dua klik "Mulai sewa" bersamaan');
  await call('POST', `/api/admin/reservasi/${r3}/konfirmasi`, A);
  const dua = await Promise.all([1, 2].map(() => call('POST', `/api/admin/reservasi/${r3}/mulai-sewa`, A)));
  ok(dua.filter((x) => x.s === 201).length === 1 && dua.filter((x) => x.s === 409).length === 1, `hasil: [${dua.map((x) => x.s)}] (harus satu 201 dan satu 409)`);
  ok((await pool.query('select count(*)::int n from sewa where id_reservasi=$1', [r3])).rows[0].n === 1, 'hanya satu baris sewa tercipta');

  console.log('\n[4] Akhiri sewa dengan Optimistic Locking');
  let s1 = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.id_reservasi === r1);
  r = await call('POST', `/api/admin/sewa/${s1.id_sewa}/akhiri`, A, { version: s1.version }); ok(r.s === 200 && r.d.data.version === 1, `akhiri dengan version benar -> 200, version jadi 1 (${r.s})`);
  ok((await pool.query('select status_reservasi from reservasi where id_reservasi=$1', [r1])).rows[0].status_reservasi === 'SELESAI', 'reservasi ikut SELESAI (jadwal dilepas)');
  const m2 = (await call('GET', '/api/motor', P1)).d.data.find((x) => x.plat_nomor === 'DB 1002 JR'); ok(m2.tersedia, 'DB 1002 kembali tersedia di daftar motor');
  r = await call('POST', `/api/admin/sewa/${s1.id_sewa}/akhiri`, A, { version: 1 }); ok(r.s === 409, `akhiri dua kali -> 409 (${r.s}) "${r.d.pesan}"`);

  console.log('\n[5] Konflik webhook vs admin: version berubah di tengah jalan');
  let sd = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.plat_nomor === 'DB 1001 JR');
  const vLama = sd.version;
  await pool.query(`UPDATE sewa SET version = version + 1 WHERE id_sewa = $1`, [sd.id_sewa]); // seolah webhook perpanjangan baru saja menyimpan
  await pool.query(`INSERT INTO perpanjangan_sewa (id_sewa, jatuh_tempo_lama, jatuh_tempo_baru, tambahan_hari, biaya_perpanjangan) VALUES ($1, '2026-01-01 17:00', '2026-01-02 17:00', 1, 75000)`, [sd.id_sewa]);
  r = await call('POST', `/api/admin/sewa/${sd.id_sewa}/akhiri`, A, { version: vLama }); ok(r.s === 409, `admin memakai version lama -> 409 (${r.s}) "${r.d.pesan.slice(0, 60)}..."`);
  ok((await pool.query('select status_sewa from sewa where id_sewa=$1', [sd.id_sewa])).rows[0].status_sewa !== 'SELESAI', 'data sewa TIDAK tertimpa');
  sd = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.plat_nomor === 'DB 1001 JR');
  r = await call('POST', `/api/admin/sewa/${sd.id_sewa}/akhiri`, A, { version: sd.version }); ok(r.s === 200, `setelah muat ulang (version baru) -> 200 (${r.s})`);
  ok((await pool.query(`select status_perpanjangan from perpanjangan_sewa where id_sewa=$1`, [sd.id_sewa])).rows[0].status_perpanjangan === 'GAGAL', 'perpanjangan yang belum dibayar ikut dinyatakan GAGAL');

  console.log('\n[6] PARALEL: dua admin mengakhiri sewa yang sama dengan version yang sama');
  const s3 = (await call('GET', '/api/admin/sewa', A)).d.data.find((x) => x.id_reservasi === r3);
  const ak = await Promise.all([1, 2].map(() => call('POST', `/api/admin/sewa/${s3.id_sewa}/akhiri`, A, { version: s3.version })));
  ok(ak.filter((x) => x.s === 200).length === 1, `hasil: [${ak.map((x) => x.s)}] (harus satu 200)`);
  ok((await pool.query('select version from sewa where id_sewa=$1', [s3.id_sewa])).rows[0].version === s3.version + 1, 'version hanya naik satu kali');

  console.log('\n[7] Hak akses dan input');
  ok((await call('GET', '/api/admin/sewa', P1)).s === 403, 'pelanggan membuka pantau sewa -> 403');
  ok((await call('POST', `/api/admin/sewa/${s3.id_sewa}/akhiri`, A, {})).s === 400, 'akhiri tanpa version -> 400');
  ok((await call('GET', '/api/admin/sewa?status=SELESAI', A)).d.data.length >= 3, 'riwayat sewa selesai dapat dilihat');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
