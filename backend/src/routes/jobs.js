// Menjalankan job secara manual oleh admin (untuk pengujian dan demonstrasi)
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { prosesAntrean } = require('../jobs/pengirim');
const { pulihkanJadwal } = require('../jobs/pengingat');

const router = express.Router();

// ---------- POST /api/admin/jobs/pengirim : proses antrean WhatsApp sekarang ----------
router.post('/jobs/pengirim', authenticate, requireRole('ADMIN'), async (req, res) => {
  const h = await prosesAntrean();
  res.json({ pesan: `Antrean diproses: ${h.terkirim} terkirim, ${h.dicoba_ulang} dijadwalkan ulang, ${h.gagal} gagal.`, data: h });
});

// ---------- POST /api/admin/jobs/pengingat : jalankan pengingat dan pemulihan jadwal sekarang ----------
// Body { waktu: 'YYYY-MM-DD HH:MM:SS' } hanya diterima jika IZINKAN_WAKTU_UJI=true di .env (khusus pengujian).
router.post('/jobs/pengingat', authenticate, requireRole('ADMIN'), async (req, res) => {
  const waktu = (req.body || {}).waktu;
  if (waktu !== undefined) {
    if (process.env.IZINKAN_WAKTU_UJI !== 'true') return res.status(403).json({ pesan: 'Waktu buatan hanya untuk pengujian (IZINKAN_WAKTU_UJI belum diaktifkan).' });
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(waktu))) return res.status(400).json({ pesan: 'Format waktu: YYYY-MM-DD HH:MM:SS' });
  }
  const h = await pulihkanJadwal({ waktu });
  if (!h.berjalan) return res.status(409).json({ pesan: 'Job pengingat sedang berjalan. Coba lagi sebentar.' });
  const dibuat = h.slot.reduce((a, x) => a + x.pengingat_dibuat, 0);
  res.json({ pesan: `${h.slot.length} jadwal diproses, ${dibuat} pengingat dibuat.`, data: h });
});

module.exports = router;
