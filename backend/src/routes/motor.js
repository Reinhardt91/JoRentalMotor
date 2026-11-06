const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { JAM_AMBIL, JAM_KEMBALI } = require('../config');
const { tanggalValid, hitungHari, hitungBiaya } = require('../lib/tarif');

const router = express.Router();

// Ketersediaan TIDAK disimpan sebagai status; selalu diturunkan dari kondisi fisik unit dan jadwal reservasi/sewa.
function bentukMotor(r, adaPeriode, periode) {
  const siap = r.kondisi_unit === 'SIAP';
  let status;
  if (!siap) status = r.kondisi_unit;                                     // PERBAIKAN / TIDAK_TERSEDIA
  else if (!adaPeriode && r.sedang_disewa) status = 'DISEWA';
  else if (r.bentrok) status = r.sedang_disewa ? 'DISEWA' : 'DIPESAN';
  else status = 'TERSEDIA';

  return {
    id_motor: r.id_motor,
    plat_nomor: r.plat_nomor,
    merek: r.merek,
    nama_model: r.nama_model,
    jenis_transmisi: r.jenis_transmisi,
    kapasitas_cc: r.kapasitas_cc,
    warna: r.warna,
    tahun_produksi: r.tahun_produksi,
    harga_harian: Number(r.harga_harian),
    harga_mingguan: r.harga_mingguan === null ? null : Number(r.harga_mingguan),
    foto_url: r.foto_url,
    kondisi_unit: r.kondisi_unit,
    status_unit: status,   // status tampilan turunan (bukan kolom basis data)
    tersedia: siap && !r.bentrok && (adaPeriode || !r.sedang_disewa),
    ...(adaPeriode ? { hari: hitungHari(periode.mulai, periode.selesai), estimasi_biaya: hitungBiaya(hitungHari(periode.mulai, periode.selesai), r.harga_harian, r.harga_mingguan) } : {}),
  };
}

const KOLOM_MOTOR = `m.id_motor, m.plat_nomor, m.warna, m.tahun_produksi, m.kondisi_unit, m.foto_url,
  t.merek, t.nama_model, t.jenis_transmisi, t.kapasitas_cc, t.harga_harian, t.harga_mingguan`;

// ---------- GET /api/motor?mulai=YYYY-MM-DD&selesai=YYYY-MM-DD ----------
// Use case: Lihat ketersediaan motor
router.get('/', authenticate, async (req, res) => {
  const { mulai, selesai } = req.query;
  const adaPeriode = mulai !== undefined || selesai !== undefined;

  if (adaPeriode) {
    if (!tanggalValid(String(mulai)) || !tanggalValid(String(selesai))) {
      return res.status(400).json({ pesan: 'Isi tanggal mulai dan selesai dengan format YYYY-MM-DD.' });
    }
    if (String(selesai) <= String(mulai)) {
      return res.status(400).json({ pesan: 'Tanggal selesai harus setelah tanggal mulai.' });
    }
  }

  // Tanpa periode: jendela = saat ini. Dengan periode: jendela = [mulai, selesai).
  const bawah = adaPeriode ? '($1::date + $3::time)' : 'LOCALTIMESTAMP';
  const atas = adaPeriode ? '($2::date + $4::time)' : "(LOCALTIMESTAMP + interval '1 minute')";

  const r = await pool.query(
    `SELECT ${KOLOM_MOTOR},
       EXISTS (SELECT 1 FROM sewa s JOIN reservasi rs ON rs.id_reservasi = s.id_reservasi
               WHERE rs.id_motor = m.id_motor AND s.status_sewa IN ('AKTIF','TERLAMBAT')) AS sedang_disewa,
       EXISTS (SELECT 1 FROM reservasi rs
               WHERE rs.id_motor = m.id_motor
                 AND rs.status_reservasi IN ('MENUNGGU','DIKONFIRMASI')
                 AND rs.tanggal_mulai < ${atas} AND rs.tanggal_selesai > ${bawah}) AS bentrok
     FROM motor m JOIN tipe_motor t USING (id_tipe)
     ORDER BY t.merek, t.nama_model, m.plat_nomor`,
    adaPeriode ? [mulai, selesai, JAM_AMBIL, JAM_KEMBALI] : []
  );

  const periode = adaPeriode ? { mulai, selesai, jam_ambil: JAM_AMBIL, jam_kembali: JAM_KEMBALI } : null;
  res.json({
    periode,
    data: r.rows.map((row) => bentukMotor(row, adaPeriode, periode)),
  });
});

// ---------- GET /api/motor/:id ----------
router.get('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ pesan: 'ID motor tidak valid.' });
  const r = await pool.query(
    `SELECT ${KOLOM_MOTOR},
       EXISTS (SELECT 1 FROM sewa s JOIN reservasi rs ON rs.id_reservasi = s.id_reservasi
               WHERE rs.id_motor = m.id_motor AND s.status_sewa IN ('AKTIF','TERLAMBAT')) AS sedang_disewa,
       EXISTS (SELECT 1 FROM reservasi rs
               WHERE rs.id_motor = m.id_motor AND rs.status_reservasi IN ('MENUNGGU','DIKONFIRMASI')
                 AND rs.tanggal_mulai < (LOCALTIMESTAMP + interval '1 minute') AND rs.tanggal_selesai > LOCALTIMESTAMP) AS bentrok
     FROM motor m JOIN tipe_motor t USING (id_tipe) WHERE m.id_motor = $1`,
    [id]
  );
  if (!r.rows[0]) return res.status(404).json({ pesan: 'Motor tidak ditemukan.' });
  res.json({ data: bentukMotor(r.rows[0], false) });
});

module.exports = router;
