// Use case admin: Lihat log notifikasi gagal, beserta ringkasan pengiriman dan eksekusi scheduler.
const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { mode } = require('../lib/whatsapp');

const router = express.Router();
const wajibAdmin = [authenticate, requireRole('ADMIN')];
const STATUS = ['GAGAL', 'PENDING', 'TERKIRIM'];

// ---------- GET /api/admin/notifikasi?status=GAGAL|PENDING|TERKIRIM ----------
router.get('/notifikasi', ...wajibAdmin, async (req, res) => {
  const status = req.query.status || 'GAGAL';
  if (!STATUS.includes(status)) return res.status(400).json({ pesan: 'Status tidak valid.' });
  const r = await pool.query(
    `SELECT n.id_notifikasi, n.jenis_notifikasi, n.no_tujuan, n.isi_pesan, n.status_kirim, n.jumlah_percobaan,
            n.error_message, n.coba_lagi_pada, n.dikirim_pada, n.tanggal_jadwal, n.created_at,
            m.plat_nomor, p.nama_lengkap
     FROM notifikasi_whatsapp n
     JOIN sewa s ON s.id_sewa = n.id_sewa
     JOIN reservasi r ON r.id_reservasi = s.id_reservasi
     JOIN motor m ON m.id_motor = r.id_motor
     JOIN pelanggan p ON p.id_pelanggan = r.id_pelanggan
     WHERE n.status_kirim = $1::status_kirim
     ORDER BY COALESCE(n.dikirim_pada, n.created_at) DESC
     LIMIT 100`, [status]);
  res.json({ data: r.rows });
});

// ---------- GET /api/admin/notifikasi/ringkasan ----------
router.get('/notifikasi/ringkasan', ...wajibAdmin, async (req, res) => {
  const k = (await pool.query(
    `SELECT
       count(*) FILTER (WHERE status_kirim = 'PENDING')::int AS menunggu,
       count(*) FILTER (WHERE status_kirim = 'TERKIRIM' AND dikirim_pada >= LOCALTIMESTAMP - interval '7 days')::int AS terkirim_7_hari,
       count(*) FILTER (WHERE status_kirim = 'GAGAL' AND created_at >= LOCALTIMESTAMP - interval '7 days')::int AS gagal_7_hari,
       count(*) FILTER (WHERE status_kirim = 'GAGAL')::int AS gagal_total
     FROM notifikasi_whatsapp`)).rows[0];
  const selesai = k.terkirim_7_hari + k.gagal_7_hari;
  const job = (await pool.query(
    `SELECT DISTINCT ON (nama_job) nama_job, waktu_mulai, waktu_selesai, status_job, cakupan_sampai,
            jumlah_diproses, jumlah_berhasil, jumlah_gagal, error_message
     FROM scheduler_log ORDER BY nama_job, id_scheduler_log DESC`)).rows;
  res.json({
    data: {
      mode_pengiriman: mode(),
      ...k,
      tingkat_keberhasilan_7_hari: selesai ? Math.round((k.terkirim_7_hari / selesai) * 1000) / 10 : null,
      eksekusi_terakhir: job,
    },
  });
});

module.exports = router;
