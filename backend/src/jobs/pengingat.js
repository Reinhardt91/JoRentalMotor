// Job pengingat jatuh tempo (H-1 pukul 17.00 dan H-0 pukul 08.00 WITA) beserta pemulihan jadwal yang terlewat
// dan penandaan sewa TERLAMBAT. Sesuai rancangan subbab 3.2.5.3 dan Gambar 3.6.
//
// Setiap "slot" adalah satu waktu jadwal (misalnya 5 Nov 17.00 untuk H-1). Slot terakhir yang selesai dicatat
// pada scheduler_log.cakupan_sampai. Saat dijalankan, semua slot setelah itu sampai sekarang diproses,
// sehingga jadwal yang terlewat selama server mati ikut dijalankan.
const pool = require('../db');
const { JAM_PENGINGAT_H1, JAM_PENGINGAT_H0, MAKS_HARI_PEMULIHAN } = require('../config');

const KUNCI_JOB = 730901; // advisory lock: hanya satu proses pengingat yang berjalan pada satu waktu
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tgl = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${Number(d)} ${BULAN[Number(m) - 1]} ${y}`; };
const jam = (s) => String(s).slice(11, 16).replace(':', '.');

const isiPesan = (jenis, x) => (jenis === 'H1'
  ? `Halo ${x.nama_lengkap}, sewa motor ${x.plat_nomor} di Jo Rental Motor akan jatuh tempo besok, ${tgl(x.jatuh_tempo)} pukul ${jam(x.jatuh_tempo)} WITA. Jika ingin memperpanjang, ajukan perpanjangan melalui aplikasi Jo Rental Motor sebelum jatuh tempo. Terima kasih.`
  : `Halo ${x.nama_lengkap}, sewa motor ${x.plat_nomor} di Jo Rental Motor jatuh tempo hari ini pukul ${jam(x.jatuh_tempo)} WITA. Mohon kembalikan motor tepat waktu atau ajukan perpanjangan melalui aplikasi Jo Rental Motor. Terima kasih.`);

// Memproses satu slot. Pengingat hanya dibuat jika masih relevan: hari ini sama dengan hari slot
// dan jatuh tempo belum lewat. Slot dari hari sebelumnya tetap dicatat, tetapi tidak menghasilkan pesan,
// supaya pelanggan tidak menerima pesan "besok" pada hari jatuh tempo (pengingat H-0 yang menggantikan).
async function prosesSlot(c, { slot, jenis, sebelumnya, sekarang }) {
  const idLog = (await c.query(
    `INSERT INTO scheduler_log (nama_job, cakupan_dari, cakupan_sampai) VALUES ($1, $2, $3) RETURNING id_scheduler_log`,
    [jenis === 'H1' ? 'pengingat_h1' : 'pengingat_h0', sebelumnya, slot])).rows[0].id_scheduler_log;

  const sasaran = (await c.query(
    `SELECT s.id_sewa, r.tanggal_selesai AS jatuh_tempo, p.nama_lengkap, p.no_whatsapp, m.plat_nomor
     FROM sewa s
     JOIN reservasi r ON r.id_reservasi = s.id_reservasi
     JOIN pelanggan p ON p.id_pelanggan = r.id_pelanggan
     JOIN motor m ON m.id_motor = r.id_motor
     WHERE s.status_sewa = 'AKTIF'
       AND $1::timestamp::date = $2::timestamp::date                        -- slot masih hari ini
       AND r.tanggal_selesai::date = $1::timestamp::date + $3::int          -- H-1: besok, H-0: hari ini
       AND r.tanggal_selesai > $2::timestamp                               -- jatuh tempo belum lewat
    `,
    [slot, sekarang, jenis === 'H1' ? 1 : 0])).rows;

  let dibuat = 0;
  for (const x of sasaran) {
    // Batasan unik (id_sewa, jenis, tanggal_jadwal) mencegah pengingat ganda, termasuk saat slot diproses ulang
    const r = await c.query(
      `INSERT INTO notifikasi_whatsapp (id_sewa, id_scheduler_log, jenis_notifikasi, no_tujuan, isi_pesan, tanggal_jadwal)
       VALUES ($1, $2, $3, $4, $5, $6::timestamp::date)
       ON CONFLICT (id_sewa, jenis_notifikasi, tanggal_jadwal)
         WHERE jenis_notifikasi IN ('PENGINGAT_H1', 'PENGINGAT_H0') DO NOTHING`,
      [x.id_sewa, idLog, jenis === 'H1' ? 'PENGINGAT_H1' : 'PENGINGAT_H0', x.no_whatsapp, isiPesan(jenis, x), slot]);
    dibuat += r.rowCount;
  }

  // Sewa yang sudah melewati jatuh tempo tanpa pengembalian ditandai TERLAMBAT (version ikut naik)
  const telat = await c.query(
    `UPDATE sewa s SET status_sewa = 'TERLAMBAT', version = s.version + 1
     FROM reservasi r WHERE r.id_reservasi = s.id_reservasi AND s.status_sewa = 'AKTIF' AND r.tanggal_selesai < $1::timestamp`,
    [sekarang]);

  await c.query(
    `UPDATE scheduler_log SET status_job = 'SELESAI', waktu_selesai = LOCALTIMESTAMP(0),
            jumlah_diproses = $2, jumlah_berhasil = $3, jumlah_gagal = 0 WHERE id_scheduler_log = $1`,
    [idLog, sasaran.length, dibuat]);
  return { slot, jenis, sewa_sasaran: sasaran.length, pengingat_dibuat: dibuat, ditandai_terlambat: telat.rowCount };
}

// Menjalankan semua slot yang jatuh tempo sejak slot terakhir yang selesai sampai "sekarang".
// Dipanggil oleh cron pada pukul 17.00 dan 08.00, dan sekali saat server dinyalakan (pemulihan).
// Parameter waktu hanya untuk pengujian (lihat routes/jobs.js).
async function pulihkanJadwal({ waktu } = {}) {
  const c = await pool.connect();
  try {
    const kunci = (await c.query('SELECT pg_try_advisory_lock($1) AS dapat', [KUNCI_JOB])).rows[0].dapat;
    if (!kunci) return { berjalan: false, slot: [] };
    try {
      const sekarang = (await c.query(`SELECT COALESCE($1::timestamp, LOCALTIMESTAMP(0))::text AS t`, [waktu || null])).rows[0].t;
      const terakhir = (await c.query(
        `SELECT GREATEST(
           COALESCE(MAX(cakupan_sampai), $1::timestamp - interval '1 day'),
           $1::timestamp - make_interval(days => $2))::text AS t
         FROM scheduler_log WHERE nama_job IN ('pengingat_h1', 'pengingat_h0') AND status_job = 'SELESAI'`,
        [sekarang, MAKS_HARI_PEMULIHAN])).rows[0].t;
      const slot = (await c.query(
        `SELECT slot::text, jenis FROM (
           SELECT (d::date + $3::time) AS slot, 'H0' AS jenis FROM generate_series($1::timestamp::date, $2::timestamp::date, interval '1 day') d
           UNION ALL
           SELECT (d::date + $4::time), 'H1' FROM generate_series($1::timestamp::date, $2::timestamp::date, interval '1 day') d
         ) x WHERE slot > $1::timestamp AND slot <= $2::timestamp ORDER BY slot`,
        [terakhir, sekarang, JAM_PENGINGAT_H0, JAM_PENGINGAT_H1])).rows;

      const hasil = [];
      let sebelumnya = terakhir;
      for (const s of slot) {
        hasil.push(await prosesSlot(c, { slot: s.slot, jenis: s.jenis, sebelumnya, sekarang }));
        sebelumnya = s.slot;
      }
      return { berjalan: true, sekarang, terakhir_sebelumnya: terakhir, slot: hasil };
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [KUNCI_JOB]);
    }
  } finally {
    c.release();
  }
}

module.exports = { pulihkanJadwal };
