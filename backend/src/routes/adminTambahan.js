// Use case admin: Tinjau perpanjangan bermasalah dan Kelola armada motor
const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const wajibAdmin = [authenticate, requireRole('ADMIN')];
const idValid = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const angka = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// =====================================================================
// TINJAU PERPANJANGAN BERMASALAH
// =====================================================================
const STATUS_TINJAU = ['LUNAS_PERLU_TINDAKAN', 'DITANGANI'];

// ---------- GET /api/admin/perpanjangan?status=LUNAS_PERLU_TINDAKAN|DITANGANI ----------
router.get('/perpanjangan', ...wajibAdmin, async (req, res) => {
  const status = req.query.status || 'LUNAS_PERLU_TINDAKAN';
  if (!STATUS_TINJAU.includes(status)) return res.status(400).json({ pesan: 'Status tidak valid.' });
  const r = await pool.query(
    `SELECT p.id_perpanjangan, p.status_perpanjangan, p.jatuh_tempo_lama, p.jatuh_tempo_baru, p.tambahan_hari,
            p.biaya_perpanjangan, p.catatan_penanganan, p.ditangani_pada, p.updated_at,
            ua.email AS ditangani_oleh_email,
            b.order_id, b.gross_amount, b.settlement_time,
            s.id_sewa, s.status_sewa, m.plat_nomor, t.merek, t.nama_model, pl.nama_lengkap, pl.no_whatsapp
     FROM perpanjangan_sewa p
     JOIN sewa s ON s.id_sewa = p.id_sewa
     JOIN reservasi r ON r.id_reservasi = s.id_reservasi
     JOIN motor m ON m.id_motor = r.id_motor
     JOIN tipe_motor t ON t.id_tipe = m.id_tipe
     JOIN pelanggan pl ON pl.id_pelanggan = r.id_pelanggan
     LEFT JOIN users ua ON ua.id_user = p.ditangani_oleh
     LEFT JOIN LATERAL (SELECT * FROM pembayaran WHERE id_perpanjangan = p.id_perpanjangan AND is_processed
                        ORDER BY id_pembayaran DESC LIMIT 1) b ON TRUE
     WHERE p.status_perpanjangan = $1::status_perpanjangan
     ORDER BY p.updated_at DESC LIMIT 100`, [status]);
  res.json({ data: r.rows.map((x) => ({ ...x, biaya_perpanjangan: Number(x.biaya_perpanjangan), gross_amount: x.gross_amount === null ? null : Number(x.gross_amount) })) });
});

// ---------- POST /api/admin/perpanjangan/:id/tangani : catat penanganan oleh admin ----------
router.post('/perpanjangan/:id/tangani', ...wajibAdmin, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID perpanjangan tidak valid.' });
  const catatan = String((req.body || {}).catatan || '').trim();
  if (catatan.length < 5) return res.status(400).json({ pesan: 'Tulis catatan penanganan, misalnya "Dana dikembalikan via transfer" (minimal 5 karakter).' });
  const r = await pool.query(
    `UPDATE perpanjangan_sewa
     SET status_perpanjangan = 'DITANGANI', ditangani_oleh = $2, ditangani_pada = LOCALTIMESTAMP(0),
         catatan_penanganan = COALESCE(catatan_penanganan, '') || ' | Penanganan admin: ' || $3
     WHERE id_perpanjangan = $1 AND status_perpanjangan = 'LUNAS_PERLU_TINDAKAN'
     RETURNING id_perpanjangan`, [Number(req.params.id), req.user.id_user, catatan.slice(0, 500)]);
  if (!r.rowCount) {
    const ada = await pool.query('SELECT status_perpanjangan FROM perpanjangan_sewa WHERE id_perpanjangan = $1', [Number(req.params.id)]);
    if (!ada.rowCount) return res.status(404).json({ pesan: 'Perpanjangan tidak ditemukan.' });
    return res.status(409).json({ pesan: 'Perpanjangan ini tidak sedang menunggu tindakan admin.' });
  }
  res.json({ pesan: 'Penanganan dicatat.' });
});

// =====================================================================
// KELOLA ARMADA MOTOR
// =====================================================================
const TRANSMISI = ['MATIC', 'MANUAL', 'KOPLING'];
const KONDISI = ['SIAP', 'PERBAIKAN', 'TIDAK_TERSEDIA'];
const normalPlat = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

// ---------- GET /api/admin/armada ----------
router.get('/armada', ...wajibAdmin, async (req, res) => {
  const tipe = await pool.query(
    `SELECT t.*, (SELECT count(*)::int FROM motor m WHERE m.id_tipe = t.id_tipe) AS jumlah_unit
     FROM tipe_motor t ORDER BY t.merek, t.nama_model`);
  const motor = await pool.query(
    `SELECT m.id_motor, m.id_tipe, m.plat_nomor, m.warna, m.tahun_produksi, m.kondisi_unit,
            t.merek, t.nama_model,
            EXISTS (SELECT 1 FROM sewa s JOIN reservasi r ON r.id_reservasi = s.id_reservasi
                    WHERE r.id_motor = m.id_motor AND s.status_sewa IN ('AKTIF','TERLAMBAT')) AS sedang_disewa,
            (SELECT count(*)::int FROM reservasi r WHERE r.id_motor = m.id_motor
               AND r.status_reservasi IN ('MENUNGGU','DIKONFIRMASI') AND r.tanggal_mulai > LOCALTIMESTAMP) AS reservasi_mendatang
     FROM motor m JOIN tipe_motor t ON t.id_tipe = m.id_tipe ORDER BY m.plat_nomor`);
  const uang = (x) => ({ ...x, harga_harian: Number(x.harga_harian), harga_mingguan: x.harga_mingguan === null ? null : Number(x.harga_mingguan) });
  res.json({ data: { tipe: tipe.rows.map(uang), motor: motor.rows } });
});

function cekTipe(b, sebagian) {
  const g = [];
  const ada = (k) => b[k] !== undefined;
  if (!sebagian || ada('merek')) if (String(b.merek || '').trim().length < 2) g.push('Merek minimal 2 karakter.');
  if (!sebagian || ada('nama_model')) if (String(b.nama_model || '').trim().length < 1) g.push('Nama model wajib diisi.');
  if (!sebagian || ada('jenis_transmisi')) if (!TRANSMISI.includes(b.jenis_transmisi)) g.push('Jenis transmisi tidak valid.');
  if (!sebagian || ada('kapasitas_cc')) if (!(Number.isInteger(Number(b.kapasitas_cc)) && Number(b.kapasitas_cc) > 0)) g.push('Kapasitas mesin harus bilangan bulat positif.');
  if (!sebagian || ada('harga_harian')) if (!(Number(b.harga_harian) > 0)) g.push('Harga harian harus lebih dari 0.');
  if (ada('harga_mingguan') && angka(b.harga_mingguan) !== null && !(Number(b.harga_mingguan) > 0)) g.push('Harga mingguan harus lebih dari 0 atau dikosongkan.');
  return g;
}

// ---------- POST /api/admin/tipe-motor ----------
router.post('/tipe-motor', ...wajibAdmin, async (req, res) => {
  const b = req.body || {};
  const galat = cekTipe(b, false);
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });
  try {
    const r = await pool.query(
      `INSERT INTO tipe_motor (merek, nama_model, jenis_transmisi, kapasitas_cc, harga_harian, harga_mingguan)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_tipe`,
      [b.merek.trim(), b.nama_model.trim(), b.jenis_transmisi, Number(b.kapasitas_cc), Number(b.harga_harian), angka(b.harga_mingguan)]);
    res.status(201).json({ pesan: 'Tipe motor ditambahkan.', data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ pesan: 'Tipe dengan merek dan model yang sama sudah ada.' });
    throw e;
  }
});

// ---------- PATCH /api/admin/tipe-motor/:id ----------
router.patch('/tipe-motor/:id', ...wajibAdmin, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID tipe tidak valid.' });
  const b = req.body || {};
  const galat = cekTipe(b, true);
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });
  const kolom = [];
  const nilai = [Number(req.params.id)];
  for (const k of ['merek', 'nama_model', 'jenis_transmisi', 'kapasitas_cc', 'harga_harian', 'harga_mingguan']) {
    if (b[k] === undefined) continue;
    nilai.push(['kapasitas_cc', 'harga_harian'].includes(k) ? Number(b[k]) : k === 'harga_mingguan' ? angka(b[k]) : String(b[k]).trim());
    kolom.push(`${k} = $${nilai.length}`);
  }
  if (!kolom.length) return res.status(400).json({ pesan: 'Tidak ada data yang diubah.' });
  try {
    const r = await pool.query(`UPDATE tipe_motor SET ${kolom.join(', ')} WHERE id_tipe = $1`, nilai);
    if (!r.rowCount) return res.status(404).json({ pesan: 'Tipe motor tidak ditemukan.' });
    res.json({ pesan: 'Tipe motor diperbarui. Harga baru berlaku untuk pemesanan dan perpanjangan berikutnya.' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ pesan: 'Tipe dengan merek dan model yang sama sudah ada.' });
    throw e;
  }
});

// ---------- POST /api/admin/motor ----------
router.post('/motor', ...wajibAdmin, async (req, res) => {
  const b = req.body || {};
  const plat = normalPlat(b.plat_nomor);
  const galat = [];
  if (!idValid(b.id_tipe)) galat.push('Pilih tipe motor.');
  if (!/^[A-Z]{1,2} \d{1,4}( [A-Z]{1,3})?$/.test(plat)) galat.push('Format plat nomor tidak valid, contoh: DB 1234 JR.');
  if (b.tahun_produksi !== undefined && b.tahun_produksi !== '' && !(Number(b.tahun_produksi) >= 1990 && Number(b.tahun_produksi) <= 2100)) galat.push('Tahun produksi tidak valid.');
  if (b.kondisi_unit !== undefined && !KONDISI.includes(b.kondisi_unit)) galat.push('Kondisi unit tidak valid.');
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });
  try {
    const r = await pool.query(
      `INSERT INTO motor (id_tipe, plat_nomor, warna, tahun_produksi, kondisi_unit)
       VALUES ($1, $2, $3, $4, $5) RETURNING id_motor, plat_nomor`,
      [Number(b.id_tipe), plat, b.warna ? String(b.warna).trim().slice(0, 30) : null,
       b.tahun_produksi ? Number(b.tahun_produksi) : null, b.kondisi_unit || 'SIAP']);
    res.status(201).json({ pesan: 'Unit motor ditambahkan.', data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ pesan: `Plat nomor ${plat} sudah terdaftar.` });
    if (e.code === '23503') return res.status(400).json({ pesan: 'Tipe motor tidak ditemukan.' });
    throw e;
  }
});

// ---------- PATCH /api/admin/motor/:id ----------
router.patch('/motor/:id', ...wajibAdmin, async (req, res) => {
  if (!idValid(req.params.id)) return res.status(400).json({ pesan: 'ID motor tidak valid.' });
  const b = req.body || {};
  const galat = [];
  if (b.kondisi_unit !== undefined && !KONDISI.includes(b.kondisi_unit)) galat.push('Kondisi unit tidak valid.');
  if (b.id_tipe !== undefined && !idValid(b.id_tipe)) galat.push('Tipe motor tidak valid.');
  if (b.tahun_produksi !== undefined && b.tahun_produksi !== '' && !(Number(b.tahun_produksi) >= 1990 && Number(b.tahun_produksi) <= 2100)) galat.push('Tahun produksi tidak valid.');
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });
  const kolom = [];
  const nilai = [Number(req.params.id)];
  if (b.kondisi_unit !== undefined) { nilai.push(b.kondisi_unit); kolom.push(`kondisi_unit = $${nilai.length}::kondisi_unit`); }
  if (b.id_tipe !== undefined) { nilai.push(Number(b.id_tipe)); kolom.push(`id_tipe = $${nilai.length}`); }
  if (b.warna !== undefined) { nilai.push(String(b.warna).trim().slice(0, 30) || null); kolom.push(`warna = $${nilai.length}`); }
  if (b.tahun_produksi !== undefined) { nilai.push(b.tahun_produksi === '' ? null : Number(b.tahun_produksi)); kolom.push(`tahun_produksi = $${nilai.length}`); }
  if (!kolom.length) return res.status(400).json({ pesan: 'Tidak ada data yang diubah.' });
  try {
    const r = await pool.query(`UPDATE motor SET ${kolom.join(', ')} WHERE id_motor = $1 RETURNING plat_nomor`, nilai);
    if (!r.rowCount) return res.status(404).json({ pesan: 'Motor tidak ditemukan.' });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ pesan: 'Tipe motor tidak ditemukan.' });
    throw e;
  }
  // Peringatan jika unit tidak siap padahal masih ada jadwal yang harus dilayani
  let peringatan = null;
  if (b.kondisi_unit && b.kondisi_unit !== 'SIAP') {
    const x = (await pool.query(
      `SELECT count(*)::int n FROM reservasi WHERE id_motor = $1 AND status_reservasi IN ('MENUNGGU','DIKONFIRMASI')
         AND tanggal_selesai > LOCALTIMESTAMP`, [Number(req.params.id)])).rows[0].n;
    if (x > 0) peringatan = `Unit ini masih memiliki ${x} reservasi aktif atau mendatang. Hubungi pelanggan terkait atau alihkan ke unit lain.`;
  }
  res.json({ pesan: 'Data motor diperbarui.', peringatan });
});

module.exports = router;
