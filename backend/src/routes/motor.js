const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
function tanggalValid(s) {
  if (!TGL_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function bentukMotor(r, adaPeriode) {
  const fisikBisaDisewa = !['PERBAIKAN', 'TIDAK_TERSEDIA'].includes(r.status_unit);
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
    status_unit: r.status_unit,
    // Tanpa periode: tersedia = unit sedang berstatus TERSEDIA.
    // Dengan periode: tersedia = unit layak sewa dan tidak bertabrakan dengan reservasi/sewa lain.
    tersedia: adaPeriode ? fisikBisaDisewa && !r.bentrok : r.status_unit === 'TERSEDIA',
  };
}

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

  const kolomBentrok = adaPeriode
    ? `, (EXISTS (SELECT 1 FROM reservasi r
                  WHERE r.id_motor = m.id_motor
                    AND r.status_reservasi IN ('MENUNGGU','DIKONFIRMASI')
                    AND r.tanggal_mulai < $2::timestamp AND r.tanggal_selesai > $1::timestamp)
         OR EXISTS (SELECT 1 FROM sewa s
                    WHERE s.id_motor = m.id_motor
                      AND s.status_sewa IN ('AKTIF','TERLAMBAT')
                      AND s.tanggal_mulai < $2::timestamp AND s.tanggal_jatuh_tempo > $1::timestamp)
        ) AS bentrok`
    : '';

  const r = await pool.query(
    `SELECT m.id_motor, m.plat_nomor, m.warna, m.tahun_produksi, m.status_unit, m.foto_url,
            t.merek, t.nama_model, t.jenis_transmisi, t.kapasitas_cc, t.harga_harian, t.harga_mingguan
            ${kolomBentrok}
     FROM motor m JOIN tipe_motor t USING (id_tipe)
     ORDER BY t.merek, t.nama_model, m.plat_nomor`,
    adaPeriode ? [mulai, selesai] : []
  );

  res.json({
    periode: adaPeriode ? { mulai, selesai } : null,
    data: r.rows.map((row) => bentukMotor(row, adaPeriode)),
  });
});

// ---------- GET /api/motor/:id ----------
router.get('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ pesan: 'ID motor tidak valid.' });
  const r = await pool.query(
    `SELECT m.id_motor, m.plat_nomor, m.warna, m.tahun_produksi, m.status_unit, m.foto_url,
            t.merek, t.nama_model, t.jenis_transmisi, t.kapasitas_cc, t.harga_harian, t.harga_mingguan
     FROM motor m JOIN tipe_motor t USING (id_tipe) WHERE m.id_motor = $1`,
    [id]
  );
  if (!r.rows[0]) return res.status(404).json({ pesan: 'Motor tidak ditemukan.' });
  res.json({ data: bentukMotor(r.rows[0], false) });
});

module.exports = router;
