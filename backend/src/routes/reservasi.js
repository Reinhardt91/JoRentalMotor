const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { JAM_AMBIL, JAM_KEMBALI, MAKS_HARI_SEWA } = require('../config');
const { tanggalValid, hitungHari, hitungBiaya } = require('../lib/tarif');

const pelanggan = express.Router();
const admin = express.Router();

const STATUS = ['MENUNGGU', 'DIKONFIRMASI', 'DIBATALKAN', 'SELESAI'];

const SELECT = (extra = '', join = '') => `
  SELECT r.id_reservasi, r.tanggal_mulai, r.tanggal_selesai, r.metode_serah, r.lokasi_serah,
         r.total_biaya, r.status_reservasi, r.created_at,
         m.id_motor, m.plat_nomor, t.merek, t.nama_model,
         s.id_sewa, s.status_sewa ${extra}
  FROM reservasi r
  JOIN motor m ON m.id_motor = r.id_motor
  JOIN tipe_motor t ON t.id_tipe = m.id_tipe
  LEFT JOIN sewa s ON s.id_reservasi = r.id_reservasi ${join}`;

const bentuk = (r) => ({ ...r, total_biaya: Number(r.total_biaya) });
const idValid = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

// =====================================================================
// PELANGGAN
// =====================================================================

// ---------- POST /api/reservasi : Booking motor ----------
pelanggan.post('/', authenticate, requireRole('PELANGGAN'), async (req, res) => {
  const b = req.body || {};
  const idMotor = Number(b.id_motor);
  const mulai = String(b.mulai || '');
  const selesai = String(b.selesai || '');
  const metode = b.metode_serah === 'ANTAR' ? 'ANTAR' : 'AMBIL';
  const lokasi = String(b.lokasi_serah || '').trim().slice(0, 255);

  const galat = [];
  if (!idValid(idMotor)) galat.push('Motor tidak valid.');
  if (b.metode_serah && !['AMBIL', 'ANTAR'].includes(b.metode_serah)) galat.push('Cara serah tidak valid.');
  if (!tanggalValid(mulai) || !tanggalValid(selesai)) galat.push('Isi tanggal ambil dan tanggal kembali dengan benar.');
  else if (selesai <= mulai) galat.push('Tanggal kembali harus setelah tanggal ambil.');
  else if (hitungHari(mulai, selesai) > MAKS_HARI_SEWA) galat.push(`Lama sewa maksimal ${MAKS_HARI_SEWA} hari.`);
  if (metode === 'ANTAR' && lokasi.length < 5) galat.push('Isi lokasi pengantaran dengan jelas.');
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });

  const lewat = (await pool.query('SELECT $1::date < CURRENT_DATE AS lewat', [mulai])).rows[0].lewat;
  if (lewat) return res.status(400).json({ pesan: 'Tanggal ambil tidak boleh sebelum hari ini.' });

  const mt = (await pool.query(
    `SELECT m.kondisi_unit, t.harga_harian, t.harga_mingguan
     FROM motor m JOIN tipe_motor t ON t.id_tipe = m.id_tipe WHERE m.id_motor = $1`, [idMotor])).rows[0];
  if (!mt) return res.status(404).json({ pesan: 'Motor tidak ditemukan.' });
  if (mt.kondisi_unit !== 'SIAP') return res.status(409).json({ pesan: 'Motor ini sedang tidak dapat disewa.' });

  const total = hitungBiaya(hitungHari(mulai, selesai), mt.harga_harian, mt.harga_mingguan);

  try {
    // Penjaga tumpang tindih ada di basis data (exclusion constraint), bukan di kode ini
    const r = await pool.query(
      `INSERT INTO reservasi (id_pelanggan, id_motor, tanggal_mulai, tanggal_selesai, metode_serah, lokasi_serah, total_biaya)
       VALUES ($1, $2, $3::date + $4::time, $5::date + $6::time, $7::metode_serah, $8, $9)
       RETURNING id_reservasi, tanggal_mulai, tanggal_selesai, total_biaya, status_reservasi`,
      [req.user.id_pelanggan, idMotor, mulai, JAM_AMBIL, selesai, JAM_KEMBALI, metode, metode === 'ANTAR' ? lokasi : null, total]);
    return res.status(201).json({ pesan: 'Reservasi dibuat. Menunggu konfirmasi admin.', data: bentuk(r.rows[0]) });
  } catch (e) {
    if (e.code === '23P01') {
      return res.status(409).json({ pesan: 'Motor ini sudah dipesan atau disewa pada tanggal tersebut. Pilih tanggal atau motor lain.' });
    }
    throw e;
  }
});

// ---------- GET /api/reservasi/saya : reservasi dan sewa milik sendiri ----------
pelanggan.get('/saya', authenticate, requireRole('PELANGGAN'), async (req, res) => {
  const r = await pool.query(`${SELECT()} WHERE r.id_pelanggan = $1 ORDER BY r.tanggal_mulai DESC`, [req.user.id_pelanggan]);
  res.json({ data: r.rows.map(bentuk) });
});

// ---------- POST /api/reservasi/:id/batal : hanya yang masih menunggu konfirmasi ----------
pelanggan.post('/:id/batal', authenticate, requireRole('PELANGGAN'), async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID reservasi tidak valid.' });
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE reservasi SET status_reservasi = 'DIBATALKAN'
     WHERE id_reservasi = $1 AND id_pelanggan = $2 AND status_reservasi = 'MENUNGGU' RETURNING id_reservasi`,
    [id, req.user.id_pelanggan]);
  if (r.rowCount === 0) {
    const ada = await pool.query('SELECT 1 FROM reservasi WHERE id_reservasi = $1 AND id_pelanggan = $2', [id, req.user.id_pelanggan]);
    if (!ada.rowCount) return res.status(404).json({ pesan: 'Reservasi tidak ditemukan.' });
    return res.status(409).json({ pesan: 'Hanya reservasi yang menunggu konfirmasi yang dapat dibatalkan. Hubungi admin untuk perubahan lain.' });
  }
  res.json({ pesan: 'Reservasi dibatalkan.' });
});

// =====================================================================
// ADMIN : Kelola reservasi
// =====================================================================

// ---------- GET /api/admin/reservasi?status= ----------
admin.get('/', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !STATUS.includes(String(status))) {
    return res.status(400).json({ pesan: 'Status tidak valid.' });
  }
  const r = await pool.query(
    `${SELECT(', p.nama_lengkap, p.no_whatsapp, (r.tanggal_mulai::date <= CURRENT_DATE) AS bisa_diserahkan', 'JOIN pelanggan p ON p.id_pelanggan = r.id_pelanggan')}
     ${status ? 'WHERE r.status_reservasi = $1::status_reservasi' : ''}
     ORDER BY r.tanggal_mulai`, status ? [status] : []);
  res.json({ data: r.rows.map(bentuk) });
});

async function ubahStatus(req, res, dari, ke, pesanOk, pesanGagal) {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID reservasi tidak valid.' });
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE reservasi SET status_reservasi = $3::status_reservasi
     WHERE id_reservasi = $1 AND status_reservasi = ANY($2::status_reservasi[])
       AND NOT EXISTS (SELECT 1 FROM sewa WHERE sewa.id_reservasi = reservasi.id_reservasi)
     RETURNING id_reservasi`, [id, dari, ke]);
  if (r.rowCount === 0) {
    const ada = await pool.query('SELECT 1 FROM reservasi WHERE id_reservasi = $1', [id]);
    if (!ada.rowCount) return res.status(404).json({ pesan: 'Reservasi tidak ditemukan.' });
    return res.status(409).json({ pesan: pesanGagal });
  }
  res.json({ pesan: pesanOk });
}

// ---------- POST /api/admin/reservasi/:id/konfirmasi ----------
admin.post('/:id/konfirmasi', authenticate, requireRole('ADMIN'), (req, res) =>
  ubahStatus(req, res, ['MENUNGGU'], 'DIKONFIRMASI', 'Reservasi dikonfirmasi.', 'Hanya reservasi yang menunggu konfirmasi yang dapat dikonfirmasi.'));

// ---------- POST /api/admin/reservasi/:id/batalkan ----------
admin.post('/:id/batalkan', authenticate, requireRole('ADMIN'), (req, res) =>
  ubahStatus(req, res, ['MENUNGGU', 'DIKONFIRMASI'], 'DIBATALKAN', 'Reservasi dibatalkan.', 'Reservasi ini tidak dapat dibatalkan (sudah dibatalkan, selesai, atau sudah menjadi sewa).'));

module.exports = { pelanggan, admin };
