const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { signatureValid, prosesStatus } = require('../lib/pembayaran');
const { jalankanRekonsiliasi } = require('../jobs/rekonsiliasi');

const publik = express.Router();
const admin = express.Router();
const potong = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

// ---------- POST /api/webhook/midtrans : Proses webhook pembayaran ----------
publik.post('/midtrans', async (req, res) => {
  const n = req.body || {};
  // 1. Payload disimpan lebih dulu (tahan restart), sebelum apa pun diproses dan sebelum membalas
  const idLog = (await pool.query(
    `INSERT INTO webhook_log (order_id, status_code, transaction_status, gross_amount, signature_key, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_webhook`,
    [potong(n.order_id, 50), potong(n.status_code, 5), potong(n.transaction_status, 20),
     potong(n.gross_amount, 20), potong(n.signature_key, 128), n])).rows[0].id_webhook;
  const catat = (hasil, x = {}) => pool.query(
    `UPDATE webhook_log SET hasil_proses = $2, signature_valid = $3, id_pembayaran = $4, error_message = $5,
            processed_at = LOCALTIMESTAMP(0), jumlah_percobaan = jumlah_percobaan + 1
     WHERE id_webhook = $1`, [idLog, hasil, !!x.valid, x.idPembayaran || null, x.pesan || null]);

  // 2. Validasi signature_key
  if (!signatureValid(n)) {
    await catat('DITOLAK_SIGNATURE');
    return res.status(403).json({ pesan: 'Signature tidak valid.' });
  }

  // 3. Validasi data + pembaruan status dalam satu transaksi basis data, lalu membalas
  try {
    const h = await prosesStatus(pool, n);
    await catat(h.hasil, { valid: true, idPembayaran: h.id_pembayaran, pesan: h.keterangan });
    return res.status(200).json({ pesan: 'OK' });
  } catch (e) {
    await catat('GAGAL', { valid: true, pesan: e.message }).catch(() => {});
    console.error('Webhook gagal diproses:', e);
    // Balasan galat membuat Midtrans mengirim ulang; payload juga sudah tersimpan di webhook_log
    return res.status(500).json({ pesan: 'Gagal memproses, akan dicoba ulang.' });
  }
});

// ---------- POST /api/admin/rekonsiliasi : jalankan job rekonsiliasi sekarang ----------
admin.post('/rekonsiliasi', authenticate, requireRole('ADMIN'), async (req, res) => {
  const h = await jalankanRekonsiliasi();
  res.json({ pesan: `Rekonsiliasi selesai: ${h.diproses} diperiksa, ${h.berhasil} berhasil, ${h.gagal} gagal.`, data: h });
});

module.exports = { publik, admin };
