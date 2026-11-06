// Uji worker pengirim WhatsApp (mode simulasi): pengiriman, percobaan ulang 3 kali, status GAGAL, dan pengiriman tepat sekali.
// Butuh: backend menyala dengan WA_MODE=simulasi (bawaan), data segar (schema.sql + npm run seed:demo).
//   node tests/alur-pengirim.js
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
const antre = (idSewa, no, isi) => pool.query(
  `INSERT INTO notifikasi_whatsapp (id_sewa, jenis_notifikasi, no_tujuan, isi_pesan, tanggal_jadwal)
   VALUES ($1, 'KONFIRMASI_PERPANJANGAN', $2, $3, CURRENT_DATE) RETURNING id_notifikasi`, [idSewa, no, isi]).then((r) => r.rows[0].id_notifikasi);
const baca = (id) => pool.query(
  `SELECT status_kirim, jumlah_percobaan, error_message, fonnte_response, dikirim_pada::text,
          round(extract(epoch FROM (coba_lagi_pada - LOCALTIMESTAMP)) / 60) AS menit_lagi
   FROM notifikasi_whatsapp WHERE id_notifikasi = $1`, [id]).then((r) => r.rows[0]);
const majukanWaktu = (id) => pool.query(`UPDATE notifikasi_whatsapp SET coba_lagi_pada = LOCALTIMESTAMP - interval '1 minute' WHERE id_notifikasi = $1`, [id]);

(async () => {
  const A = (await call('POST', '/api/auth/login', null, { email: 'admin@jorental.local', password: 'Admin12345' })).d.token;
  const P = (await call('POST', '/api/auth/login', null, { email: 'pelanggan@test.com', password: 'Pelanggan123' })).d.token;
  const idSewa = (await pool.query(`SELECT id_sewa FROM sewa ORDER BY id_sewa LIMIT 1`)).rows[0].id_sewa;
  await pool.query(`UPDATE notifikasi_whatsapp SET status_kirim = 'TERKIRIM' WHERE status_kirim = 'PENDING'`); // bersihkan antrean lama
  const jalankan = () => call('POST', '/api/admin/jobs/pengirim', A);

  console.log('\n[1] Pengiriman pertama (mode simulasi; nomor berakhiran 0000 sengaja selalu gagal)');
  const n1 = await antre(idSewa, '6281234567890', 'Pesan uji 1');
  const n2 = await antre(idSewa, '628111110000', 'Pesan uji ke nomor gagal');
  const n3 = await antre(idSewa, '6281234567891', 'Pesan uji 3');
  let r = await jalankan();
  ok(r.s === 200 && r.d.data.terkirim === 2 && r.d.data.dicoba_ulang === 1, `hasil: ${r.d.pesan}`);
  const s1 = await baca(n1);
  ok(s1.status_kirim === 'TERKIRIM' && s1.jumlah_percobaan === 1 && !!s1.dikirim_pada && /simulasi/.test(s1.fonnte_response), 'pesan 1 TERKIRIM, waktu kirim dan respons tercatat');
  let s2 = await baca(n2);
  ok(s2.status_kirim === 'PENDING' && s2.jumlah_percobaan === 1 && Number(s2.menit_lagi) === 15, `pesan gagal dijadwalkan ulang 15 menit lagi (percobaan ${s2.jumlah_percobaan}, ${s2.menit_lagi} menit)`);
  ok(/tidak terdaftar/.test(s2.error_message), `alasan gagal tercatat: "${s2.error_message}"`);

  console.log('\n[2] Belum waktunya dicoba ulang');
  r = await jalankan(); ok(r.d.data.diproses === 0, 'putaran berikutnya tidak memproses apa pun sebelum 15 menit');

  console.log('\n[3] Percobaan ulang sampai batas 3 kali');
  await majukanWaktu(n2); r = await jalankan(); s2 = await baca(n2);
  ok(s2.status_kirim === 'PENDING' && s2.jumlah_percobaan === 2, 'percobaan ke-2 gagal, masih PENDING');
  await majukanWaktu(n2); r = await jalankan(); s2 = await baca(n2);
  ok(s2.status_kirim === 'GAGAL' && s2.jumlah_percobaan === 3 && s2.menit_lagi === null, 'percobaan ke-3 gagal, status GAGAL, tidak dijadwalkan lagi');
  await pool.query(`UPDATE notifikasi_whatsapp SET coba_lagi_pada = LOCALTIMESTAMP - interval '1 minute' WHERE id_notifikasi = $1`, [n2]);
  r = await jalankan(); ok(r.d.data.diproses === 0 && (await baca(n2)).jumlah_percobaan === 3, 'pesan GAGAL tidak pernah diambil lagi');

  console.log('\n[4] PARALEL: dua worker berjalan bersamaan, setiap pesan dikirim tepat satu kali');
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await antre(idSewa, '62812345678' + (10 + i), `Pesan paralel ${i}`));
  const [a, b] = await Promise.all([jalankan(), jalankan()]);
  const total = a.d.data.diproses + b.d.data.diproses;
  const per = (await pool.query(`SELECT jumlah_percobaan, status_kirim FROM notifikasi_whatsapp WHERE id_notifikasi = ANY($1)`, [ids])).rows;
  ok(total === 6, `total diproses kedua worker = ${total} (worker A ${a.d.data.diproses}, worker B ${b.d.data.diproses})`);
  ok(per.every((x) => x.jumlah_percobaan === 1 && x.status_kirim === 'TERKIRIM'), 'setiap pesan: tepat satu percobaan, TERKIRIM');

  console.log('\n[5] Pencatatan dan hak akses');
  const lg = (await pool.query(`SELECT count(*)::int n, sum(jumlah_berhasil)::int b FROM scheduler_log WHERE nama_job = 'pengirim_whatsapp' AND status_job = 'SELESAI'`)).rows[0];
  ok(lg.n >= 4 && lg.b >= 8, `setiap putaran yang memproses pesan tercatat di scheduler_log (${lg.n} putaran, ${lg.b} terkirim)`);
  ok((await call('POST', '/api/admin/jobs/pengirim', P)).s === 403, 'pelanggan menjalankan job -> 403');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  await pool.end();
})().catch((e) => { console.error('galat uji:', e); process.exit(1); });
