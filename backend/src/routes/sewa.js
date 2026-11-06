const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const midtrans = require('../lib/midtrans');

const router = express.Router();
const wajibAdmin = [authenticate, requireRole('ADMIN')];
const idValid = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const STATUS_SEWA = ['AKTIF', 'TERLAMBAT', 'SELESAI'];

// ---------- GET /api/admin/sewa?status= : Pantau status sewa ----------
router.get('/sewa', ...wajibAdmin, async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !STATUS_SEWA.includes(String(status))) {
    return res.status(400).json({ pesan: 'Status tidak valid.' });
  }
  const daftar = status ? [status] : ['AKTIF', 'TERLAMBAT'];
  const r = await pool.query(
    `SELECT s.id_sewa, s.status_sewa, s.version, s.tanggal_serah, s.tanggal_kembali,
            r.id_reservasi, r.tanggal_mulai, r.tanggal_selesai AS jatuh_tempo, r.total_biaya,
            r.metode_serah, r.lokasi_serah,
            m.plat_nomor, t.merek, t.nama_model, p.nama_lengkap, p.no_whatsapp,
            (r.tanggal_selesai < LOCALTIMESTAMP) AS lewat_jatuh_tempo,
            (r.tanggal_selesai::date = CURRENT_DATE) AS jatuh_tempo_hari_ini
     FROM sewa s
     JOIN reservasi r ON r.id_reservasi = s.id_reservasi
     JOIN motor m ON m.id_motor = r.id_motor
     JOIN tipe_motor t ON t.id_tipe = m.id_tipe
     JOIN pelanggan p ON p.id_pelanggan = r.id_pelanggan
     WHERE s.status_sewa = ANY($1::status_sewa[])
     ORDER BY r.tanggal_selesai ${status === 'SELESAI' ? 'DESC LIMIT 50' : ''}`, [daftar]);
  res.json({ data: r.rows.map((x) => ({ ...x, total_biaya: Number(x.total_biaya) })) });
});

// ---------- POST /api/admin/reservasi/:id/mulai-sewa : Mulai sewa (serah terima) ----------
router.post('/reservasi/:id/mulai-sewa', ...wajibAdmin, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID reservasi tidak valid.' });
  const id = Number(req.params.id);
  const c = await pool.connect();
  const tolak = async (kode, pesan) => { await c.query('ROLLBACK'); return res.status(kode).json({ pesan }); };
  try {
    await c.query('BEGIN');
    // Kunci baris reservasi agar dua klik "Mulai sewa" diproses bergiliran
    const r = (await c.query(
      `SELECT r.id_reservasi, r.id_motor, r.status_reservasi, r.tanggal_mulai,
              (r.tanggal_mulai::date <= CURRENT_DATE) AS sudah_waktunya,
              (r.tanggal_selesai <= LOCALTIMESTAMP) AS sudah_lewat, m.kondisi_unit
       FROM reservasi r JOIN motor m ON m.id_motor = r.id_motor
       WHERE r.id_reservasi = $1 FOR UPDATE OF r`, [id])).rows[0];
    if (!r) return tolak(404, 'Reservasi tidak ditemukan.');
    const sudah = await c.query('SELECT 1 FROM sewa WHERE id_reservasi = $1', [id]);
    if (sudah.rowCount) return tolak(409, 'Sewa untuk reservasi ini sudah dimulai.');
    if (r.status_reservasi !== 'DIKONFIRMASI') return tolak(409, 'Sewa hanya dapat dimulai dari reservasi yang sudah dikonfirmasi.');
    if (!r.sudah_waktunya) return tolak(409, `Serah terima baru dapat dilakukan mulai tanggal ${r.tanggal_mulai.slice(0, 10)}.`);
    if (r.sudah_lewat) return tolak(409, 'Periode reservasi ini sudah berakhir. Batalkan reservasi atau buat reservasi baru.');
    if (r.kondisi_unit !== 'SIAP') return tolak(409, 'Unit sedang dalam perbaikan atau tidak tersedia.');
    const masih = await c.query(
      `SELECT 1 FROM sewa s JOIN reservasi x ON x.id_reservasi = s.id_reservasi
       WHERE x.id_motor = $1 AND s.status_sewa IN ('AKTIF','TERLAMBAT')`, [r.id_motor]);
    if (masih.rowCount) return tolak(409, 'Unit masih disewa pelanggan sebelumnya dan belum dikembalikan.');

    const s = await c.query(
      `INSERT INTO sewa (id_reservasi, tanggal_serah) VALUES ($1, LOCALTIMESTAMP(0))
       RETURNING id_sewa, tanggal_serah, status_sewa, version`, [id]);
    await c.query('COMMIT');
    return res.status(201).json({ pesan: 'Sewa dimulai. Motor sudah diserahkan kepada pelanggan.', data: s.rows[0] });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ pesan: 'Sewa untuk reservasi ini sudah dimulai.' });
    throw e;
  } finally {
    c.release();
  }
});

// ---------- POST /api/admin/sewa/:id/akhiri : Akhiri sewa (pengembalian) ----------
// Optimistic Locking: admin mengirim version yang dibaca saat halaman dimuat.
router.post('/sewa/:id/akhiri', ...wajibAdmin, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID sewa tidak valid.' });
  const id = Number(req.params.id);
  const versi = Number((req.body || {}).version);
  if (!Number.isInteger(versi) || versi < 0) return res.status(400).json({ pesan: 'Versi data tidak valid. Muat ulang halaman.' });

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = await c.query(
      `UPDATE sewa SET status_sewa = 'SELESAI', tanggal_kembali = LOCALTIMESTAMP(0), version = version + 1
       WHERE id_sewa = $1 AND version = $2 AND status_sewa IN ('AKTIF','TERLAMBAT')
       RETURNING id_reservasi, version, tanggal_kembali`, [id, versi]);
    if (u.rowCount === 0) {
      await c.query('ROLLBACK');
      const e = (await pool.query('SELECT status_sewa FROM sewa WHERE id_sewa = $1', [id])).rows[0];
      if (!e) return res.status(404).json({ pesan: 'Sewa tidak ditemukan.' });
      if (e.status_sewa === 'SELESAI') return res.status(409).json({ pesan: 'Sewa ini sudah diakhiri.' });
      return res.status(409).json({
        pesan: 'Data sewa telah berubah sejak halaman dimuat, misalnya perpanjangan baru saja dibayar. Muat ulang halaman, periksa jatuh tempo terbaru, lalu ulangi.',
      });
    }
    // Jadwal unit dilepas: reservasi SELESAI tidak lagi dihitung oleh constraint overlap
    await c.query(`UPDATE reservasi SET status_reservasi = 'SELESAI' WHERE id_reservasi = $1`, [u.rows[0].id_reservasi]);
    // Pengajuan perpanjangan yang belum dibayar tidak lagi berlaku
    await c.query(
      `UPDATE perpanjangan_sewa SET status_perpanjangan = 'GAGAL', catatan_penanganan = 'Sewa diakhiri sebelum pembayaran'
       WHERE id_sewa = $1 AND status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`, [id]);
    const qr = await c.query(
      `SELECT b.order_id FROM pembayaran b JOIN perpanjangan_sewa p ON p.id_perpanjangan = b.id_perpanjangan
       WHERE p.id_sewa = $1 AND b.transaction_status = 'PENDING' AND b.is_processed = false`, [id]);
    await c.query('COMMIT');
    // QR yang belum dibayar dimatikan di Midtrans (jika tetap terbayar, webhook menandainya perlu tindakan admin)
    for (const { order_id } of qr.rows) midtrans.kedaluwarsakan(order_id).catch(() => {});
    return res.json({ pesan: 'Sewa diakhiri. Unit kembali tersedia.', data: u.rows[0] });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
});

module.exports = router;
