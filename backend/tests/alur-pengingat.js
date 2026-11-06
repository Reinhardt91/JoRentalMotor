// Uji job pengingat jatuh tempo (Rumusan 4): H-1 dan H-0, tanpa pengingat ganda, pemulihan jadwal terlewat,
// penandaan TERLAMBAT, dan pengiriman lewat worker (mode simulasi).
// Butuh: backend menyala dengan IZINKAN_WAKTU_UJI=true dan JOB_AKTIF=false di .env, data segar
// (schema.sql + npm run seed:demo). Waktu "buatan" dipakai agar tidak perlu menunggu pukul 08.00 / 17.00.
//   node tests/alur-pengingat.js
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
const q = (sql, p) => pool.query(sql, p);

(async () => {
  const hari = (await q('select localtimestamp::date::text d')).rows[0].d;
  const D = (n) => { const x = new Date(hari + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const login = async (e, p) => (await call('POST', '/api/auth/login', null, { email: e, password: p })).d.token;
  const P = await login('pelanggan2@test.com', 'Pelanggan123'), A = await login('admin@jorental.local', 'Admin12345');
  const jalankan = (waktu) => call('POST', '/api/admin/jobs/pengingat', A, waktu ? { waktu } : {});
  const pengingat = async (jenis, idSewa) => Number((await q(`select count(*) n from notifikasi_whatsapp where jenis_notifikasi=$1 and id_sewa=$2`, [jenis, idSewa])).rows[0].n);
  const totalPengingat = async () => Number((await q(`select count(*) n from notifikasi_whatsapp where jenis_notifikasi in ('PENGINGAT_H1','PENGINGAT_H0')`)).rows[0].n);
  const bersihkan = async () => { await q(`delete from notifikasi_whatsapp where jenis_notifikasi in ('PENGINGAT_H1','PENGINGAT_H0')`); await q(`delete from scheduler_log where nama_job like 'pengingat%'`); };
  const logSelesai = (nama, sampai) => q(`insert into scheduler_log (nama_job, cakupan_sampai, status_job) values ($1, $2, 'SELESAI')`, [nama, sampai]);

  // s1: sewa demo, jatuh tempo besok 17.00. s2: sewa kedua, jatuh tempo HARI INI 17.00.
  const s1 = (await q(`select id_sewa from sewa order by id_sewa limit 1`)).rows[0].id_sewa;
  const idm = (await q(`select id_motor from motor where plat_nomor='DB 1002 JR'`)).rows[0].id_motor;
  const r2 = (await call('POST', '/api/reservasi', P, { id_motor: idm, mulai: D(0), selesai: D(1) })).d.data.id_reservasi;
  await call('POST', `/api/admin/reservasi/${r2}/konfirmasi`, A);
  const s2 = (await call('POST', `/api/admin/reservasi/${r2}/mulai-sewa`, A)).d.data.id_sewa;
  await q(`update reservasi set tanggal_selesai = $1::date + time '17:00' where id_reservasi = $2`, [D(0), r2]);
  await bersihkan();

  console.log(`\n[1] Pukul 08.00 hari ini (${D(0)}): pengingat H-0 untuk sewa yang jatuh tempo hari ini`);
  let r = await jalankan(`${D(0)} 08:00:30`);
  ok(r.s === 200, `job berjalan: ${r.d.pesan}`);
  ok(await pengingat('PENGINGAT_H0', s2) === 1, 'H-0 dibuat untuk sewa kedua (jatuh tempo hari ini 17.00)');
  ok(await pengingat('PENGINGAT_H0', s1) === 0 && await pengingat('PENGINGAT_H1', s1) === 0, 'sewa demo (jatuh tempo besok) belum mendapat pengingat pada pukul 08.00');
  const isiH0 = (await q(`select isi_pesan from notifikasi_whatsapp where id_sewa=$1 and jenis_notifikasi='PENGINGAT_H0'`, [s2])).rows[0].isi_pesan;
  ok(/hari ini pukul 17\.00 WITA/.test(isiH0), `isi pesan: "${isiH0.slice(0, 70)}..."`);

  console.log('\n[2] Dijalankan ulang pada waktu yang sama');
  r = await jalankan(`${D(0)} 08:00:30`);
  ok(r.s === 200 && r.d.data.slot.length === 0 && await totalPengingat() === 1, 'tidak ada jadwal baru, tidak ada pengingat ganda');

  console.log('\n[3] Pukul 17.00 hari ini: pengingat H-1 dan penandaan TERLAMBAT');
  const v2 = (await q('select version from sewa where id_sewa=$1', [s2])).rows[0].version;
  r = await jalankan(`${D(0)} 17:00:30`);
  ok(await pengingat('PENGINGAT_H1', s1) === 1, 'H-1 dibuat untuk sewa demo (jatuh tempo besok)');
  ok(await pengingat('PENGINGAT_H1', s2) === 0, 'sewa kedua tidak mendapat H-1');
  const st2 = (await q('select status_sewa, version from sewa where id_sewa=$1', [s2])).rows[0];
  ok(st2.status_sewa === 'TERLAMBAT' && st2.version === v2 + 1, `sewa kedua lewat 17.00 tanpa pengembalian -> TERLAMBAT (version ${v2} -> ${st2.version})`);
  const isiH1 = (await q(`select isi_pesan from notifikasi_whatsapp where id_sewa=$1 and jenis_notifikasi='PENGINGAT_H1'`, [s1])).rows[0].isi_pesan;
  ok(/besok/.test(isiH1), `isi pesan: "${isiH1.slice(0, 70)}..."`);

  console.log('\n[4] Catatan jadwal hilang lalu job diproses ulang: tetap tidak ada pengingat ganda');
  await q(`update scheduler_log set status_job = 'GAGAL' where nama_job like 'pengingat%'`); // catatan selesai dianggap hilang
  r = await jalankan(`${D(0)} 17:00:30`);
  ok(r.d.data.slot.length >= 2 && await totalPengingat() === 2, `${r.d.data.slot.length} jadwal diproses ulang, jumlah pengingat tetap 2 (dijaga batasan unik)`);

  console.log('\n[5] PEMULIHAN: server mati sebelum 17.00, hidup kembali pukul 19.30 di hari yang sama');
  await bersihkan(); await logSelesai('pengingat_h0', `${D(0)} 08:00:00`);
  r = await jalankan(`${D(0)} 19:30:00`);
  ok(r.d.data.slot.length === 1 && r.d.data.slot[0].jenis === 'H1' && r.d.data.slot[0].slot.startsWith(`${D(0)} 17:00`), `jadwal yang terlewat (${D(0)} 17.00) dijalankan saat server hidup`);
  ok(await pengingat('PENGINGAT_H1', s1) === 1, 'pengingat H-1 yang terlewat tetap dibuat');
  ok((await q(`select max(cakupan_sampai)::text t from scheduler_log where nama_job like 'pengingat%' and status_job='SELESAI'`)).rows[0].t.startsWith(`${D(0)} 17:00`), 'scheduler_log mencatat jadwal terakhir yang selesai');

  console.log('\n[6] PEMULIHAN lintas hari: server mati sejak 2 hari lalu, hidup pukul 09.00 hari ini');
  await bersihkan(); await q(`update sewa set status_sewa='AKTIF' where id_sewa=$1`, [s2]); await logSelesai('pengingat_h1', `${D(-2)} 17:00:00`);
  r = await jalankan(`${D(0)} 09:00:00`);
  ok(r.d.data.slot.length === 3, `3 jadwal terlewat diproses: ${r.d.data.slot.map((x) => x.slot.slice(5, 16) + ' ' + x.jenis).join(', ')}`);
  ok(await pengingat('PENGINGAT_H0', s2) === 1, 'H-0 hari ini tetap dikirim (masih relevan)');
  ok(await totalPengingat() === 1, 'jadwal dari hari kemarin tidak menghasilkan pesan yang sudah tidak relevan');

  console.log('\n[7] Batas pemulihan: catatan terakhir 10 hari lalu');
  await bersihkan(); await logSelesai('pengingat_h1', `${D(-10)} 17:00:00`);
  r = await jalankan(`${D(0)} 09:00:00`);
  ok(r.d.data.slot.length > 0 && r.d.data.slot.length <= 7, `hanya memeriksa paling lama 3 hari ke belakang (${r.d.data.slot.length} jadwal)`);

  console.log('\n[8] PARALEL: dua pemicu bersamaan (misalnya cron dan pemulihan saat server menyala)');
  await bersihkan(); await q(`update sewa set status_sewa='AKTIF' where id_sewa=$1`, [s2]);
  const [a, b] = await Promise.all([jalankan(`${D(0)} 08:00:30`), jalankan(`${D(0)} 08:00:30`)]);
  const lg = Number((await q(`select count(*) n from scheduler_log where nama_job like 'pengingat%' and cakupan_sampai = $1::date + time '08:00'`, [D(0)])).rows[0].n);
  ok(lg === 1 && await pengingat('PENGINGAT_H0', s2) === 1, `jadwal 08.00 diproses tepat sekali (respons: ${a.s} dan ${b.s})`);

  console.log('\n[9] Pengingat dikirim oleh worker (mode simulasi)');
  r = await call('POST', '/api/admin/jobs/pengirim', A);
  ok((await q(`select status_kirim from notifikasi_whatsapp where id_sewa=$1 and jenis_notifikasi='PENGINGAT_H0'`, [s2])).rows[0].status_kirim === 'TERKIRIM', `pengingat berstatus TERKIRIM (${r.d.pesan})`);

  console.log('\n[10] Hak akses dan masukan');
  ok((await call('POST', '/api/admin/jobs/pengingat', P, {})).s === 403, 'pelanggan -> 403');
  ok((await jalankan('besok pagi')).s === 400, 'format waktu salah -> 400');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
