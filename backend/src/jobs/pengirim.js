// Worker pengirim: mengambil pesan berstatus PENDING dari antrean di basis data dan mengirimnya
// satu per satu. Gagal -> dicoba ulang maksimal 3 kali dengan jeda 15 menit, lalu GAGAL.
// Sesuai rancangan subbab 3.2.5.3 dan Gambar 3.6.
const pool = require('../db');
const { kirimPesan } = require('../lib/whatsapp');

const MAKS_PERCOBAAN = 3;
const JEDA_ULANG_MENIT = 15;
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function prosesAntrean({ batas = 20 } = {}) {
  const jedaAntarPesan = Number(process.env.WA_JEDA_ANTAR_PESAN_MS ?? 3000);
  // Ambil pesan yang sudah waktunya dikirim dan "pesan" barisnya selama 5 menit (lease),
  // sehingga dua worker yang berjalan bersamaan tidak mengirim pesan yang sama.
  const ambil = await pool.query(
    `UPDATE notifikasi_whatsapp SET coba_lagi_pada = LOCALTIMESTAMP + interval '5 minutes'
     WHERE id_notifikasi IN (
       SELECT id_notifikasi FROM notifikasi_whatsapp
       WHERE status_kirim = 'PENDING' AND (coba_lagi_pada IS NULL OR coba_lagi_pada <= LOCALTIMESTAMP)
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id_notifikasi, no_tujuan, isi_pesan, jenis_notifikasi, jumlah_percobaan`, [batas]);

  const hasil = { diproses: 0, terkirim: 0, dicoba_ulang: 0, gagal: 0 };
  if (ambil.rowCount === 0) return hasil;
  const idLog = (await pool.query(
    `INSERT INTO scheduler_log (nama_job, cakupan_sampai) VALUES ('pengirim_whatsapp', LOCALTIMESTAMP(0)) RETURNING id_scheduler_log`))
    .rows[0].id_scheduler_log;

  for (let i = 0; i < ambil.rows.length; i++) {
    const n = ambil.rows[i];
    hasil.diproses++;
    const k = await kirimPesan({ no: n.no_tujuan, isi: n.isi_pesan, jenis: n.jenis_notifikasi });
    const percobaan = n.jumlah_percobaan + 1;
    if (k.berhasil) {
      hasil.terkirim++;
      await pool.query(
        `UPDATE notifikasi_whatsapp SET status_kirim = 'TERKIRIM', jumlah_percobaan = $2, dikirim_pada = LOCALTIMESTAMP(0),
                fonnte_response = $3, error_message = NULL, coba_lagi_pada = NULL WHERE id_notifikasi = $1`,
        [n.id_notifikasi, percobaan, k.respons || null]);
    } else if (percobaan >= MAKS_PERCOBAAN) {
      hasil.gagal++;
      await pool.query(
        `UPDATE notifikasi_whatsapp SET status_kirim = 'GAGAL', jumlah_percobaan = $2, error_message = $3, coba_lagi_pada = NULL
         WHERE id_notifikasi = $1`, [n.id_notifikasi, percobaan, k.galat]);
    } else {
      hasil.dicoba_ulang++;
      await pool.query(
        `UPDATE notifikasi_whatsapp SET jumlah_percobaan = $2, error_message = $3,
                coba_lagi_pada = LOCALTIMESTAMP(0) + make_interval(mins => $4) WHERE id_notifikasi = $1`,
        [n.id_notifikasi, percobaan, k.galat, JEDA_ULANG_MENIT]);
    }
    if (i < ambil.rows.length - 1 && jedaAntarPesan > 0) await tunggu(jedaAntarPesan); // jeda antarpesan
  }

  await pool.query(
    `UPDATE scheduler_log SET status_job = 'SELESAI', waktu_selesai = LOCALTIMESTAMP(0),
            jumlah_diproses = $2, jumlah_berhasil = $3, jumlah_gagal = $4 WHERE id_scheduler_log = $1`,
    [idLog, hasil.diproses, hasil.terkirim, hasil.dicoba_ulang + hasil.gagal]);
  return hasil;
}

module.exports = { prosesAntrean, MAKS_PERCOBAAN, JEDA_ULANG_MENIT };
