const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { MAKS_HARI_PERPANJANGAN, MENIT_BERLAKU_QRIS } = require('../config');
const { hitungBiaya } = require('../lib/tarif');
const midtrans = require('../lib/midtrans');

const router = express.Router();
const wajibPelanggan = [authenticate, requireRole('PELANGGAN')];
const idValid = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

// Data sewa milik pelanggan + celah hari sampai reservasi berikutnya pada unit yang sama
const SQL_SEWA = `
  SELECT s.id_sewa, s.status_sewa, r.id_reservasi, r.id_motor, r.tanggal_selesai AS jatuh_tempo,
         t.harga_harian, t.harga_mingguan, m.plat_nomor, t.merek, t.nama_model,
         (SELECT MIN(x.tanggal_mulai) FROM reservasi x
          WHERE x.id_motor = r.id_motor AND x.id_reservasi <> r.id_reservasi
            AND x.status_reservasi IN ('MENUNGGU','DIKONFIRMASI') AND x.tanggal_mulai >= r.tanggal_selesai) AS reservasi_berikutnya
  FROM sewa s
  JOIN reservasi r ON r.id_reservasi = s.id_reservasi
  JOIN motor m ON m.id_motor = r.id_motor
  JOIN tipe_motor t ON t.id_tipe = m.id_tipe
  WHERE s.id_sewa = $1 AND r.id_pelanggan = $2`;

// Batas maksimal tambahan hari: jatuh tempo baru tidak boleh melewati awal reservasi berikutnya
async function maksHari(db, s) {
  if (!['AKTIF', 'TERLAMBAT'].includes(s.status_sewa)) return 0;
  if (!s.reservasi_berikutnya) return MAKS_HARI_PERPANJANGAN;
  const r = await db.query(
    `SELECT floor(extract(epoch FROM ($1::timestamp - $2::timestamp)) / 86400)::int AS hari`,
    [s.reservasi_berikutnya, s.jatuh_tempo]);
  return Math.min(MAKS_HARI_PERPANJANGAN, Math.max(0, r.rows[0].hari));
}

const SQL_PERPANJANGAN = `
  SELECT p.id_perpanjangan, p.id_sewa, p.status_perpanjangan, p.jatuh_tempo_lama, p.jatuh_tempo_baru,
         p.tambahan_hari, p.biaya_perpanjangan, p.created_at,
         b.order_id, b.transaction_status, b.qr_url, b.expiry_time,
         (b.expiry_time IS NOT NULL AND b.expiry_time < LOCALTIMESTAMP) AS qr_kedaluwarsa
  FROM perpanjangan_sewa p
  LEFT JOIN LATERAL (SELECT * FROM pembayaran WHERE id_perpanjangan = p.id_perpanjangan ORDER BY id_pembayaran DESC LIMIT 1) b ON TRUE`;

const bentuk = (p) => p && ({ ...p, biaya_perpanjangan: Number(p.biaya_perpanjangan) });

// Pengajuan menunggu yang QR-nya sudah kedaluwarsa dibereskan dulu, setelah memastikan ke Midtrans
// bahwa pelanggan memang belum membayar. Mengembalikan 'LUNAS_DIPROSES' jika ternyata sudah dibayar.
async function bereskanTertunda(idSewa) {
  const lama = (await pool.query(
    `${SQL_PERPANJANGAN} WHERE p.id_sewa = $1 AND p.status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`, [idSewa])).rows[0];
  if (!lama || !lama.qr_kedaluwarsa) return null;
  if (lama.order_id) {
    const st = await midtrans.cekStatus(lama.order_id).catch(() => null);
    const status = st && st.data && st.data.transaction_status;
    if (status === 'settlement' || status === 'capture') return 'LUNAS_DIPROSES';
    if (status === 'pending') await midtrans.kedaluwarsakan(lama.order_id).catch(() => null);
  }
  await pool.query(
    `UPDATE perpanjangan_sewa SET status_perpanjangan = 'KEDALUWARSA'
     WHERE id_perpanjangan = $1 AND status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`, [lama.id_perpanjangan]);
  await pool.query(
    `UPDATE pembayaran SET transaction_status = 'EXPIRE' WHERE order_id = $1 AND transaction_status = 'PENDING'`, [lama.order_id]);
  return 'KEDALUWARSA';
}

// ---------- GET /api/sewa/:id/perpanjangan : info untuk form perpanjangan ----------
router.get('/sewa/:id/perpanjangan', ...wajibPelanggan, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID sewa tidak valid.' });
  const idSewa = Number(req.params.id);
  const s = (await pool.query(SQL_SEWA, [idSewa, req.user.id_pelanggan])).rows[0];
  if (!s) return res.status(404).json({ pesan: 'Sewa tidak ditemukan.' });
  await bereskanTertunda(idSewa);
  const menunggu = (await pool.query(
    `${SQL_PERPANJANGAN} WHERE p.id_sewa = $1 AND p.status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`, [idSewa])).rows[0];
  res.json({
    data: {
      id_sewa: s.id_sewa,
      status_sewa: s.status_sewa,
      jatuh_tempo: s.jatuh_tempo,
      reservasi_berikutnya: s.reservasi_berikutnya,
      maks_hari: await maksHari(pool, s),
      harga_harian: Number(s.harga_harian),
      harga_mingguan: s.harga_mingguan === null ? null : Number(s.harga_mingguan),
      menit_berlaku_qris: MENIT_BERLAKU_QRIS,
      mode: midtrans.mode(),
      menunggu: bentuk(menunggu) || null,
    },
  });
});

// ---------- POST /api/perpanjangan : Ajukan perpanjangan + buat QRIS ----------
router.post('/perpanjangan', ...wajibPelanggan, async (req, res) => {
  const b = req.body || {};
  const idSewa = Number(b.id_sewa);
  const tambahan = Number(b.tambahan_hari);
  if (!idValid(idSewa)) return res.status(400).json({ pesan: 'Sewa tidak valid.' });
  if (!Number.isInteger(tambahan) || tambahan < 1 || tambahan > MAKS_HARI_PERPANJANGAN) {
    return res.status(400).json({ pesan: `Tambahan hari harus 1 sampai ${MAKS_HARI_PERPANJANGAN}.` });
  }

  const beres = await bereskanTertunda(idSewa);
  if (beres === 'LUNAS_DIPROSES') {
    return res.status(409).json({ pesan: 'Pembayaran perpanjangan sebelumnya sudah diterima dan sedang diproses. Muat ulang halaman sebentar lagi.' });
  }

  const c = await pool.connect();
  let p = null;
  let tolakan = null;
  try {
    await c.query('BEGIN');
    const s = (await c.query(`${SQL_SEWA} FOR UPDATE OF s, r`, [idSewa, req.user.id_pelanggan])).rows[0];
    if (!s) tolakan = [404, { pesan: 'Sewa tidak ditemukan.' }];
    else if (!['AKTIF', 'TERLAMBAT'].includes(s.status_sewa)) tolakan = [409, { pesan: 'Hanya sewa yang sedang berjalan yang dapat diperpanjang.' }];
    else {
      // Lapis pertama pencegahan bentrok jadwal: batas maksimal hari sampai reservasi berikutnya
      const maks = await maksHari(c, s);
      const baru = (await c.query(
        `SELECT ($1::timestamp + make_interval(days => $2)) AS jt,
                ($1::timestamp + make_interval(days => $2)) > LOCALTIMESTAMP AS masa_depan`, [s.jatuh_tempo, tambahan])).rows[0];
      if (maks === 0) tolakan = [409, { pesan: 'Sewa ini tidak dapat diperpanjang karena unit sudah dipesan pelanggan lain tepat setelah jatuh tempo.', maks_hari: 0 }];
      else if (tambahan > maks) tolakan = [409, { pesan: `Unit sudah dipesan pelanggan lain. Perpanjangan maksimal ${maks} hari.`, maks_hari: maks }];
      else if (!baru.masa_depan) tolakan = [409, { pesan: 'Jatuh tempo baru sudah lewat. Tambah jumlah hari atau hubungi admin.' }];
      else {
        const biaya = hitungBiaya(tambahan, s.harga_harian, s.harga_mingguan);
        try {
          await c.query('SAVEPOINT sp');
          p = (await c.query(
            `INSERT INTO perpanjangan_sewa (id_sewa, jatuh_tempo_lama, jatuh_tempo_baru, tambahan_hari, biaya_perpanjangan)
             VALUES ($1, $2, $3, $4, $5) RETURNING id_perpanjangan`, [idSewa, s.jatuh_tempo, baru.jt, tambahan, biaya])).rows[0];
        } catch (e) {
          if (e.code !== '23505') throw e;
          tolakan = [409, { pesan: 'Masih ada perpanjangan yang menunggu pembayaran. Selesaikan atau batalkan dulu.' }];
        }
        if (p) {
          p.order_id = `JRM-${p.id_perpanjangan}-${crypto.randomBytes(3).toString('hex')}`;
          p.biaya = biaya;
          await c.query(
            `INSERT INTO pembayaran (id_perpanjangan, order_id, gross_amount, expiry_time)
             VALUES ($1, $2, $3, LOCALTIMESTAMP(0) + make_interval(mins => $4))`, [p.id_perpanjangan, p.order_id, biaya, MENIT_BERLAKU_QRIS]);
        }
      }
    }
    await c.query(tolakan ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  if (tolakan) return res.status(tolakan[0]).json(tolakan[1]);

  // Panggilan ke Midtrans dilakukan di luar transaksi agar baris basis data tidak terkunci selama menunggu jaringan
  try {
    const q = await midtrans.buatQris({ orderId: p.order_id, jumlah: Math.round(p.biaya), menitBerlaku: MENIT_BERLAKU_QRIS });
    await pool.query(
      // Waktu dari Midtrans memakai WIB (GMT+7); dikonversi ke WITA (lokasi usaha) sebelum disimpan
      `UPDATE pembayaran SET transaction_id = $2, qr_url = $3,
              transaction_time = COALESCE((($4::timestamp AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Makassar'), transaction_time),
              expiry_time = COALESCE((($5::timestamp AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Makassar'), expiry_time)
       WHERE order_id = $1`, [p.order_id, q.transaction_id, q.qr_url, q.transaction_time, q.expiry_time]);
  } catch (e) {
    await pool.query(`UPDATE perpanjangan_sewa SET status_perpanjangan = 'GAGAL', catatan_penanganan = $2 WHERE id_perpanjangan = $1`,
      [p.id_perpanjangan, 'QRIS gagal dibuat: ' + e.message]);
    await pool.query(`UPDATE pembayaran SET transaction_status = 'CANCEL' WHERE order_id = $1`, [p.order_id]);
    return res.status(502).json({ pesan: 'Kode QR gagal dibuat. Coba lagi beberapa saat.', detail: e.message });
  }

  const hasil = (await pool.query(`${SQL_PERPANJANGAN} WHERE p.id_perpanjangan = $1`, [p.id_perpanjangan])).rows[0];
  res.status(201).json({ pesan: 'Kode QR siap. Selesaikan pembayaran sebelum batas waktu.', data: bentuk(hasil) });
});

// Perpanjangan milik pelanggan yang sedang login
const SQL_MILIK = `${SQL_PERPANJANGAN}
  JOIN sewa s ON s.id_sewa = p.id_sewa JOIN reservasi rv ON rv.id_reservasi = s.id_reservasi
  WHERE p.id_perpanjangan = $1 AND rv.id_pelanggan = $2`;

// ---------- GET /api/perpanjangan/:id : status untuk halaman pembayaran (dipanggil berkala) ----------
router.get('/perpanjangan/:id', ...wajibPelanggan, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID perpanjangan tidak valid.' });
  const r = (await pool.query(SQL_MILIK, [Number(req.params.id), req.user.id_pelanggan])).rows[0];
  if (!r) return res.status(404).json({ pesan: 'Perpanjangan tidak ditemukan.' });
  res.json({ data: bentuk(r) });
});

// ---------- POST /api/perpanjangan/:id/batal : batalkan pengajuan yang belum dibayar ----------
router.post('/perpanjangan/:id/batal', ...wajibPelanggan, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID perpanjangan tidak valid.' });
  const id = Number(req.params.id);
  const r = (await pool.query(SQL_MILIK, [id, req.user.id_pelanggan])).rows[0];
  if (!r) return res.status(404).json({ pesan: 'Perpanjangan tidak ditemukan.' });
  if (r.status_perpanjangan !== 'MENUNGGU_PEMBAYARAN') return res.status(409).json({ pesan: 'Pengajuan ini sudah tidak menunggu pembayaran.' });

  // Pastikan ke Midtrans bahwa pelanggan belum membayar, lalu matikan kode QR-nya
  if (r.order_id) {
    const st = await midtrans.cekStatus(r.order_id).catch(() => null);
    const status = st && st.data && st.data.transaction_status;
    if (status === 'settlement' || status === 'capture') {
      return res.status(409).json({ pesan: 'Pembayaran sudah diterima, pengajuan tidak dapat dibatalkan. Muat ulang halaman sebentar lagi.' });
    }
    await midtrans.kedaluwarsakan(r.order_id).catch(() => null);
  }
  const u = await pool.query(
    `UPDATE perpanjangan_sewa SET status_perpanjangan = 'GAGAL', catatan_penanganan = 'Dibatalkan pelanggan'
     WHERE id_perpanjangan = $1 AND status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`, [id]);
  if (!u.rowCount) return res.status(409).json({ pesan: 'Pengajuan ini sudah tidak menunggu pembayaran.' });
  await pool.query(`UPDATE pembayaran SET transaction_status = 'CANCEL' WHERE order_id = $1 AND transaction_status = 'PENDING'`, [r.order_id]);
  res.json({ pesan: 'Pengajuan perpanjangan dibatalkan.' });
});

module.exports = router;
