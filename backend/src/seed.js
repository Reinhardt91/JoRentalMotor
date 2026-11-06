// Data awal (seed) untuk pengembangan dan pengujian.
//   npm run seed          -> admin, pelanggan uji, tipe dan unit motor
//   npm run seed:demo     -> ditambah data demo: sewa aktif yang jatuh tempo besok dan reservasi lain
// Aman dijalankan berulang (tidak menggandakan data).
// CATATAN: harga, plat nomor, dan data pelanggan adalah CONTOH. Ganti dengan data asli Jo Rental Motor.

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const pool = require('./db');

const DEMO = process.argv.includes('--demo');

const ADMIN = { email: 'admin@jorental.local', password: process.env.SEED_ADMIN_PASSWORD || 'Admin12345' };
const PELANGGAN = [
  { email: 'pelanggan@test.com',  password: 'Pelanggan123', nama: 'Pelanggan Uji',   wa: process.env.SEED_PELANGGAN_WA || '6281234567890', ktp: '3578000000000001', asal: 'Manado' },
  { email: 'pelanggan2@test.com', password: 'Pelanggan123', nama: 'Pelanggan Dua',   wa: '6281234567891',                                   ktp: '3578000000000002', asal: 'Jakarta' },
];
const TIPE = [
  ['Honda', 'Beat',      'MATIC', 110,  75000, 450000],
  ['Honda', 'Scoopy',    'MATIC', 110,  80000, 480000],
  ['Honda', 'Vario 125', 'MATIC', 125,  90000, 540000],
  ['Yamaha', 'NMAX',     'MATIC', 155, 150000, 900000],
];
// [merek, model, plat, warna, tahun, kondisi]
const MOTOR = [
  ['Honda', 'Beat',      'DB 1001 JR', 'Hitam',   2022, 'SIAP'],
  ['Honda', 'Beat',      'DB 1002 JR', 'Putih',   2021, 'SIAP'],
  ['Honda', 'Scoopy',    'DB 1003 JR', 'Coklat',  2022, 'SIAP'],
  ['Honda', 'Scoopy',    'DB 1004 JR', 'Merah',   2023, 'SIAP'],
  ['Honda', 'Vario 125', 'DB 1005 JR', 'Hitam',   2022, 'SIAP'],
  ['Honda', 'Vario 125', 'DB 1006 JR', 'Abu-abu', 2021, 'PERBAIKAN'],
  ['Yamaha', 'NMAX',     'DB 1007 JR', 'Hitam',   2023, 'SIAP'],
  ['Yamaha', 'NMAX',     'DB 1008 JR', 'Biru',    2022, 'TIDAK_TERSEDIA'], // dipinjam internal
];

async function buatUser(c, email, password, role) {
  const hash = await bcrypt.hash(password, 10);
  const r = await c.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO NOTHING RETURNING id_user`, [email, hash, role]);
  if (r.rows[0]) return { id: r.rows[0].id_user, baru: true };
  return { id: (await c.query('SELECT id_user FROM users WHERE email=$1', [email])).rows[0].id_user, baru: false };
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = await buatUser(c, ADMIN.email, ADMIN.password, 'ADMIN');
    console.log(`Admin      : ${ADMIN.email} ${a.baru ? '(dibuat)' : '(sudah ada)'}`);

    const daftar = DEMO ? PELANGGAN : PELANGGAN.slice(0, 1);
    for (const p of daftar) {
      const u = await buatUser(c, p.email, p.password, 'PELANGGAN');
      await c.query(
        `INSERT INTO pelanggan (id_user, nama_lengkap, no_whatsapp, no_ktp, asal_daerah)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_user) DO NOTHING`, [u.id, p.nama, p.wa, p.ktp, p.asal]);
      console.log(`Pelanggan  : ${p.email} ${u.baru ? '(dibuat)' : '(sudah ada)'}`);
    }

    for (const [merek, model, trans, cc, harian, mingguan] of TIPE) {
      await c.query(
        `INSERT INTO tipe_motor (merek, nama_model, jenis_transmisi, kapasitas_cc, harga_harian, harga_mingguan)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (merek, nama_model) DO NOTHING`,
        [merek, model, trans, cc, harian, mingguan]);
    }
    for (const [merek, model, plat, warna, tahun, kondisi] of MOTOR) {
      await c.query(
        `INSERT INTO motor (id_tipe, plat_nomor, warna, tahun_produksi, kondisi_unit)
         SELECT id_tipe, $3, $4, $5, $6::kondisi_unit FROM tipe_motor WHERE merek=$1 AND nama_model=$2
         ON CONFLICT (plat_nomor) DO NOTHING`, [merek, model, plat, warna, tahun, kondisi]);
    }

    if (DEMO) {
      const ada = (await c.query('SELECT count(*)::int n FROM reservasi')).rows[0].n;
      if (ada === 0) {
        // 1) Sewa aktif pelanggan 1 pada DB 1001 JR: mulai 2 hari lalu, jatuh tempo BESOK pukul 17.00
        const r1 = await c.query(
          `INSERT INTO reservasi (id_pelanggan, id_motor, tanggal_mulai, tanggal_selesai, total_biaya, status_reservasi)
           SELECT p.id_pelanggan, m.id_motor,
                  date_trunc('day', LOCALTIMESTAMP) - interval '2 days' + interval '9 hours',
                  date_trunc('day', LOCALTIMESTAMP) + interval '1 day' + interval '17 hours', 225000, 'DIKONFIRMASI'
           FROM pelanggan p JOIN users u USING (id_user), motor m
           WHERE u.email = 'pelanggan@test.com' AND m.plat_nomor = 'DB 1001 JR' RETURNING id_reservasi`);
        await c.query(`INSERT INTO sewa (id_reservasi, tanggal_serah)
                       SELECT id_reservasi, tanggal_mulai FROM reservasi WHERE id_reservasi = $1`, [r1.rows[0].id_reservasi]);
        // 2) Reservasi pelanggan 2 pada unit yang sama, mulai 4 hari lagi => batas maksimal perpanjangan sewa di atas = 3 hari
        await c.query(
          `INSERT INTO reservasi (id_pelanggan, id_motor, tanggal_mulai, tanggal_selesai, total_biaya, status_reservasi)
           SELECT p.id_pelanggan, m.id_motor,
                  date_trunc('day', LOCALTIMESTAMP) + interval '4 days' + interval '9 hours',
                  date_trunc('day', LOCALTIMESTAMP) + interval '6 days' + interval '17 hours', 150000, 'DIKONFIRMASI'
           FROM pelanggan p JOIN users u USING (id_user), motor m
           WHERE u.email = 'pelanggan2@test.com' AND m.plat_nomor = 'DB 1001 JR'`);
        // 3) Reservasi menunggu konfirmasi pada DB 1003 JR, 10 sampai 12 hari lagi
        await c.query(
          `INSERT INTO reservasi (id_pelanggan, id_motor, tanggal_mulai, tanggal_selesai, total_biaya, status_reservasi)
           SELECT p.id_pelanggan, m.id_motor,
                  date_trunc('day', LOCALTIMESTAMP) + interval '10 days' + interval '9 hours',
                  date_trunc('day', LOCALTIMESTAMP) + interval '12 days' + interval '17 hours', 160000, 'MENUNGGU'
           FROM pelanggan p JOIN users u USING (id_user), motor m
           WHERE u.email = 'pelanggan2@test.com' AND m.plat_nomor = 'DB 1003 JR'`);
        console.log('Demo       : 1 sewa aktif (jatuh tempo besok 17.00), 1 reservasi terkonfirmasi, 1 reservasi menunggu');
      } else {
        console.log('Demo       : dilewati (sudah ada data reservasi)');
      }
    }

    await c.query('COMMIT');
    const n = (await c.query(`SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM tipe_motor) t,
      (SELECT count(*) FROM motor) m, (SELECT count(*) FROM reservasi) r, (SELECT count(*) FROM sewa) s`)).rows[0];
    console.log(`Total      : ${n.u} akun, ${n.t} tipe, ${n.m} unit, ${n.r} reservasi, ${n.s} sewa`);
    console.log('Seed selesai.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Seed gagal:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}
main();
