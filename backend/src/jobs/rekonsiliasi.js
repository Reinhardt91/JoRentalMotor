// Job rekonsiliasi: menanyakan status ke Midtrans (Get Status API) untuk pembayaran yang masih pending,
// sehingga perubahan status tetap diterima walaupun notifikasi webhook tidak pernah tiba.
const pool = require('../db');
const midtrans = require('../lib/midtrans');
const { prosesStatus } = require('../lib/pembayaran');

async function jalankanRekonsiliasi() {
  const idLog = (await pool.query(
    `INSERT INTO scheduler_log (nama_job, cakupan_sampai) VALUES ('rekonsiliasi_pembayaran', LOCALTIMESTAMP(0))
     RETURNING id_scheduler_log`)).rows[0].id_scheduler_log;
  let diproses = 0, berhasil = 0, gagal = 0;
  try {
    const daftar = (await pool.query(
      `SELECT order_id, gross_amount FROM pembayaran
       WHERE transaction_status = 'PENDING' AND is_processed = false AND transaction_id IS NOT NULL
         AND created_at < LOCALTIMESTAMP - interval '1 minute'
       ORDER BY created_at LIMIT 50`)).rows;
    for (const p of daftar) {
      diproses++;
      try {
        const { http, data } = await midtrans.cekStatus(p.order_id);
        await pool.query('UPDATE pembayaran SET terakhir_direkonsiliasi = LOCALTIMESTAMP(0) WHERE order_id = $1', [p.order_id]);
        if (http >= 400 || !data.transaction_status) { gagal++; continue; }
        if (data.transaction_status !== 'pending') {
          await prosesStatus(pool, { ...data, order_id: p.order_id, gross_amount: data.gross_amount ?? String(p.gross_amount) });
        }
        berhasil++;
      } catch {
        gagal++;
      }
    }
    await pool.query(
      `UPDATE scheduler_log SET status_job = 'SELESAI', waktu_selesai = LOCALTIMESTAMP(0),
              jumlah_diproses = $2, jumlah_berhasil = $3, jumlah_gagal = $4 WHERE id_scheduler_log = $1`,
      [idLog, diproses, berhasil, gagal]);
  } catch (e) {
    await pool.query(
      `UPDATE scheduler_log SET status_job = 'GAGAL', waktu_selesai = LOCALTIMESTAMP(0), error_message = $2 WHERE id_scheduler_log = $1`,
      [idLog, e.message]).catch(() => {});
    throw e;
  }
  return { diproses, berhasil, gagal };
}

module.exports = { jalankanRekonsiliasi };
