// Data awal (seed) untuk pengembangan dan pengujian.
// Jalankan dari folder backend:  npm run seed
// Aman dijalankan berulang kali (data yang sudah ada tidak diduplikasi).
// CATATAN: harga, plat nomor, dan data pelanggan di bawah adalah CONTOH.
// Ganti dengan data asli Jo Rental Motor sebelum demo/pengujian akhir.

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const pool = require('./db');

const ADMIN = {
  email: 'admin@jorental.local',
  password: process.env.SEED_ADMIN_PASSWORD || 'Admin12345',
};

const PELANGGAN_DEMO = {
  email: 'pelanggan@test.com',
  password: 'Pelanggan123',
  nama_lengkap: 'Pelanggan Uji',
  // GANTI dengan nomor WhatsApp Anda sendiri agar notifikasi uji masuk ke HP Anda
  no_whatsapp: process.env.SEED_PELANGGAN_WA || '6281234567890',
  no_ktp: '3578000000000001',
  asal_daerah: 'Surabaya',
};

const TIPE = [
  ['Honda', 'Beat',    'MATIC', 110,  75000, 450000],
  ['Honda', 'Scoopy',  'MATIC', 110,  80000, 480000],
  ['Honda', 'Vario 125', 'MATIC', 125, 90000, 540000],
  ['Yamaha', 'NMAX',   'MATIC', 155, 150000, 900000],
];

// [merek, model, plat, warna, tahun, status]
const MOTOR = [
  ['Honda', 'Beat',      'L 1001 JR', 'Hitam',  2022, 'TERSEDIA'],
  ['Honda', 'Beat',      'L 1002 JR', 'Putih',  2021, 'TERSEDIA'],
  ['Honda', 'Scoopy',    'L 1003 JR', 'Coklat', 2022, 'TERSEDIA'],
  ['Honda', 'Scoopy',    'L 1004 JR', 'Merah',  2023, 'TERSEDIA'],
  ['Honda', 'Vario 125', 'L 1005 JR', 'Hitam',  2022, 'TERSEDIA'],
  ['Honda', 'Vario 125', 'L 1006 JR', 'Abu-abu', 2021, 'PERBAIKAN'],
  ['Yamaha', 'NMAX',     'L 1007 JR', 'Hitam',  2023, 'TERSEDIA'],
  ['Yamaha', 'NMAX',     'L 1008 JR', 'Biru',   2022, 'TIDAK_TERSEDIA'],
];

async function buatUser(client, email, password, role) {
  const hash = await bcrypt.hash(password, 10);
  const r = await client.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id_user`,
    [email, hash, role]
  );
  if (r.rows[0]) return { id: r.rows[0].id_user, baru: true };
  const e = await client.query('SELECT id_user FROM users WHERE email = $1', [email]);
  return { id: e.rows[0].id_user, baru: false };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const admin = await buatUser(client, ADMIN.email, ADMIN.password, 'ADMIN');
    console.log(`Admin      : ${ADMIN.email} ${admin.baru ? '(dibuat)' : '(sudah ada)'}`);

    const pel = await buatUser(client, PELANGGAN_DEMO.email, PELANGGAN_DEMO.password, 'PELANGGAN');
    await client.query(
      `INSERT INTO pelanggan (id_user, nama_lengkap, no_whatsapp, no_ktp, asal_daerah)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_user) DO NOTHING`,
      [pel.id, PELANGGAN_DEMO.nama_lengkap, PELANGGAN_DEMO.no_whatsapp,
       PELANGGAN_DEMO.no_ktp, PELANGGAN_DEMO.asal_daerah]
    );
    console.log(`Pelanggan  : ${PELANGGAN_DEMO.email} ${pel.baru ? '(dibuat)' : '(sudah ada)'}`);

    for (const [merek, model, trans, cc, harian, mingguan] of TIPE) {
      await client.query(
        `INSERT INTO tipe_motor (merek, nama_model, jenis_transmisi, kapasitas_cc, harga_harian, harga_mingguan)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (merek, nama_model) DO NOTHING`,
        [merek, model, trans, cc, harian, mingguan]
      );
    }

    for (const [merek, model, plat, warna, tahun, status] of MOTOR) {
      await client.query(
        `INSERT INTO motor (id_tipe, plat_nomor, warna, tahun_produksi, status_unit)
         SELECT id_tipe, $3, $4, $5, $6::status_unit
         FROM tipe_motor WHERE merek = $1 AND nama_model = $2
         ON CONFLICT (plat_nomor) DO NOTHING`,
        [merek, model, plat, warna, tahun, status]
      );
    }

    await client.query('COMMIT');

    const n = await client.query(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM tipe_motor) AS tipe,
              (SELECT COUNT(*) FROM motor) AS motor`
    );
    console.log(`Total      : ${n.rows[0].users} akun, ${n.rows[0].tipe} tipe motor, ${n.rows[0].motor} unit motor`);
    console.log('Seed selesai.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed gagal:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
