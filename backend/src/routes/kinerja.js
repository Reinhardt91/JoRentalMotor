// Rute bantu pengukuran kinerja (hanya tersedia bila UKUR_KINERJA=true)
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const kinerja = require('../lib/kinerja');

const router = express.Router();
const tersedia = (req, res, next) => (kinerja.aktif() ? next() : res.status(404).json({ pesan: 'Rute tidak ditemukan.' }));

// ---------- POST /api/admin/kinerja/mulai : mulai (ulang) pencatatan event loop delay ----------
router.post('/kinerja/mulai', tersedia, authenticate, requireRole('ADMIN'), (req, res) => {
  kinerja.mulai();
  res.json({ pesan: 'Pencatatan event loop delay dimulai.' });
});

// ---------- GET /api/admin/kinerja : baca hasil event loop delay ----------
router.get('/kinerja', tersedia, authenticate, requireRole('ADMIN'), (req, res) => {
  res.json({ data: kinerja.baca() });
});

module.exports = router;
