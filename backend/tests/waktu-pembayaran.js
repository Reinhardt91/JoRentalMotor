// Mengambil waktu proses pembayaran perpanjangan yang sudah LUNAS (untuk subbab 4.2.1).
// Hanya MEMBACA basis data, tidak mengubah atau mereset apa pun.
//   node tests/waktu-pembayaran.js
// Hasil: tabel di layar dan berkas backend/hasil-uji/<tanggal-jam>-pembayaran/RINGKASAN-PEMBAYARAN.md
//
// Waktu bayar diambil dari settlement_time milik Midtrans (sudah dikonversi ke WITA).
// Catatan: jam server Midtrans dan jam laptop dapat berselisih beberapa detik.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
types.setTypeParser(1114, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar' });
const dtk = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 10) / 10);
const median = (xs) => { const u = [...xs].sort((a, b) => a - b); const m = Math.floor(u.length / 2); return u.length ? (u.length % 2 ? u[m] : (u[m - 1] + u[m]) / 2) : null; };

(async () => {
  const r = await pool.query(
    `SELECT p.id_perpanjangan, b.order_id, b.gross_amount, m.plat_nomor,
            b.settlement_time::text AS dibayar,
            w.received_at::text AS diterima, w.processed_at::text AS selesai,
            p.updated_at::text AS diterapkan,
            CASE WHEN w.id_webhook IS NULL THEN 'rekonsiliasi' ELSE 'webhook' END AS jalur,
            extract(epoch FROM (w.received_at - b.settlement_time)) AS bayar_ke_diterima,
            extract(epoch FROM (COALESCE(w.processed_at, p.updated_at) - b.settlement_time)) AS bayar_ke_selesai
     FROM perpanjangan_sewa p
     JOIN pembayaran b ON b.id_perpanjangan = p.id_perpanjangan AND b.is_processed
     JOIN sewa s ON s.id_sewa = p.id_sewa
     JOIN reservasi rv ON rv.id_reservasi = s.id_reservasi
     JOIN motor m ON m.id_motor = rv.id_motor
     LEFT JOIN LATERAL (
       SELECT * FROM webhook_log
       WHERE order_id = b.order_id AND transaction_status = 'settlement' AND hasil_proses = 'DIPROSES'
       ORDER BY id_webhook LIMIT 1) w ON TRUE
     WHERE p.status_perpanjangan = 'LUNAS'
     ORDER BY b.settlement_time`);
  await pool.end();

  if (r.rowCount === 0) {
    console.log('Belum ada perpanjangan LUNAS di basis data. Lakukan pembayaran lewat simulator Midtrans dulu.');
    process.exit(0);
  }

  const baris = r.rows.map((x, i) => ({
    no: i + 1, order_id: x.order_id, plat: x.plat_nomor, jalur: x.jalur, dibayar: x.dibayar,
    diterima: x.diterima ? x.diterima.slice(0, 19) : '-', selesai: (x.selesai || x.diterapkan || '').slice(0, 19),
    bayar_ke_diterima: dtk(x.bayar_ke_diterima), bayar_ke_selesai: dtk(x.bayar_ke_selesai),
  }));
  const viaWebhook = baris.filter((b) => b.jalur === 'webhook').map((b) => b.bayar_ke_selesai);
  const viaRekon = baris.filter((b) => b.jalur === 'rekonsiliasi').map((b) => b.bayar_ke_selesai);

  let md = `# Waktu proses pembayaran perpanjangan\n\n`;
  md += `- Diambil: ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')} WITA\n`;
  md += `- Waktu bayar = settlement_time dari Midtrans (dikonversi ke WITA). Jam Midtrans dan jam laptop dapat berselisih beberapa detik, dan waktu selesai tercatat per detik.\n\n`;
  md += `| No | Order ID | Unit | Jalur | Dibayar (Midtrans) | Webhook diterima | Selesai diproses | Bayar ke diterima (dtk) | Bayar ke jatuh tempo diperbarui (dtk) |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const b of baris) md += `| ${b.no} | ${b.order_id} | ${b.plat} | ${b.jalur} | ${b.dibayar} | ${b.diterima} | ${b.selesai} | ${b.bayar_ke_diterima ?? '-'} | ${b.bayar_ke_selesai} |\n`;
  md += `\n## Ringkasan\n\n| Jalur | Jumlah | Median (dtk) | Tercepat (dtk) | Terlama (dtk) |\n|---|---|---|---|---|\n`;
  if (viaWebhook.length) md += `| Webhook | ${viaWebhook.length} | ${dtk(median(viaWebhook))} | ${Math.min(...viaWebhook)} | ${Math.max(...viaWebhook)} |\n`;
  if (viaRekon.length) md += `| Rekonsiliasi (webhook tidak tiba) | ${viaRekon.length} | ${dtk(median(viaRekon))} | ${Math.min(...viaRekon)} | ${Math.max(...viaRekon)} |\n`;

  const folder = path.join(__dirname, '..', 'hasil-uji', new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '') + '-pembayaran');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'RINGKASAN-PEMBAYARAN.md'), md, 'utf8');
  console.log(md + `\nBerkas: ${folder}`);
})().catch((e) => { console.error('Galat: ' + e.message); process.exit(1); });
