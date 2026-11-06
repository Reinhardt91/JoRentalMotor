// Pemrosesan status pembayaran (dipakai webhook Midtrans dan job rekonsiliasi).
// Sesuai rancangan subbab 3.2.5.1 dan 3.2.5.2.
const crypto = require('crypto');

const MAKS_ULANG_OL = 3; // berapa kali membaca ulang saat version sewa berubah (Optimistic Locking)
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const teksWaktu = (s) => { const [d, t] = String(s).split(' '); const [y, m, dd] = d.split('-'); return `${Number(dd)} ${BULAN[Number(m) - 1]} ${y} pukul ${t.slice(0, 5).replace(':', '.')} WITA`; };
const rupiah = (n) => 'Rp' + new Intl.NumberFormat('id-ID').format(Number(n));

// signature_key = SHA512(order_id + status_code + gross_amount + kunci rahasia).
// Dibandingkan dengan perbandingan waktu konstan (crypto.timingSafeEqual).
// Kunci yang dicoba: Signature Secret Key, lalu Server Key (dashboard Midtrans baru memisahkan keduanya).
function signatureValid(n) {
  const terima = String(n.signature_key || '').toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(terima)) return false;
  const bTerima = Buffer.from(terima, 'utf8');
  const kunci = [process.env.MIDTRANS_SIGNATURE_SECRET, process.env.MIDTRANS_SERVER_KEY].filter(Boolean);
  let cocok = false;
  for (const k of kunci) {
    const harap = crypto.createHash('sha512').update(`${n.order_id}${n.status_code}${n.gross_amount}${k}`).digest('hex');
    const bHarap = Buffer.from(harap, 'utf8');
    if (bHarap.length === bTerima.length && crypto.timingSafeEqual(bHarap, bTerima)) cocok = true;
  }
  return cocok;
}

async function tandaiPerluTindakan(c, b, alasan) {
  await c.query(
    `UPDATE perpanjangan_sewa SET status_perpanjangan = 'LUNAS_PERLU_TINDAKAN', catatan_penanganan = $2 WHERE id_perpanjangan = $1`,
    [b.id_perpanjangan, alasan]);
  return 'LUNAS_PERLU_TINDAKAN';
}

// Menerapkan jatuh tempo baru. Uang sudah masuk, jadi proses ini tidak boleh gagal hanya karena version berubah:
// jika admin mengubah sewa bersamaan, baca ulang lalu ulangi. Jika konflik substansial, tandai perlu tindakan admin.
async function terapkanPerpanjangan(c, b) {
  for (let i = 0; i < MAKS_ULANG_OL; i++) {
    const s = (await c.query(
      `SELECT s.id_sewa, s.version, s.status_sewa, r.id_reservasi, r.tanggal_selesai
       FROM sewa s JOIN reservasi r ON r.id_reservasi = s.id_reservasi WHERE s.id_sewa = $1`, [b.id_sewa])).rows[0];
    if (!['AKTIF', 'TERLAMBAT'].includes(s.status_sewa)) return tandaiPerluTindakan(c, b, 'Sewa sudah diakhiri sebelum pembayaran diterima');
    if (s.tanggal_selesai !== b.jatuh_tempo_lama) return tandaiPerluTindakan(c, b, 'Jatuh tempo sewa sudah berubah sejak pengajuan');

    await c.query('SAVEPOINT terapkan');
    const u = await c.query(
      `UPDATE sewa SET version = version + 1,
              status_sewa = CASE WHEN $3::timestamp > LOCALTIMESTAMP THEN 'AKTIF'::status_sewa ELSE status_sewa END
       WHERE id_sewa = $1 AND version = $2 AND status_sewa IN ('AKTIF','TERLAMBAT')`, [s.id_sewa, s.version, b.jatuh_tempo_baru]);
    if (u.rowCount === 0) { await c.query('ROLLBACK TO SAVEPOINT terapkan'); continue; } // version berubah: baca ulang
    try {
      // Penjaga terakhir bentrok jadwal: exclusion constraint pada reservasi
      await c.query('UPDATE reservasi SET tanggal_selesai = $2 WHERE id_reservasi = $1', [s.id_reservasi, b.jatuh_tempo_baru]);
    } catch (e) {
      if (e.code !== '23P01') throw e;
      await c.query('ROLLBACK TO SAVEPOINT terapkan');
      return tandaiPerluTindakan(c, b, 'Jadwal bentrok dengan reservasi lain yang dibuat selama menunggu pembayaran');
    }
    await c.query(`UPDATE perpanjangan_sewa SET status_perpanjangan = 'LUNAS' WHERE id_perpanjangan = $1`, [b.id_perpanjangan]);
    return 'LUNAS';
  }
  return tandaiPerluTindakan(c, b, 'Data sewa terus berubah sehingga tidak dapat diterapkan otomatis');
}

// Konfirmasi WhatsApp dimasukkan ke antrean di basis data (dikirim worker secara asynchronous)
async function antreKonfirmasi(c, b, akhir) {
  const d = (await c.query(
    `SELECT p.no_whatsapp, p.nama_lengkap, m.plat_nomor
     FROM sewa s JOIN reservasi r ON r.id_reservasi = s.id_reservasi
     JOIN pelanggan p ON p.id_pelanggan = r.id_pelanggan JOIN motor m ON m.id_motor = r.id_motor
     WHERE s.id_sewa = $1`, [b.id_sewa])).rows[0];
  const isi = akhir === 'LUNAS'
    ? `Halo ${d.nama_lengkap}, pembayaran perpanjangan sewa motor ${d.plat_nomor} sebesar ${rupiah(b.gross_amount)} sudah diterima. Jatuh tempo baru: ${teksWaktu(b.jatuh_tempo_baru)}. Terima kasih. Jo Rental Motor`
    : `Halo ${d.nama_lengkap}, pembayaran perpanjangan sewa motor ${d.plat_nomor} sebesar ${rupiah(b.gross_amount)} sudah kami terima, tetapi perpanjangan belum dapat diterapkan otomatis. Admin Jo Rental Motor akan segera menghubungi Anda.`;
  await c.query(
    `INSERT INTO notifikasi_whatsapp (id_sewa, id_perpanjangan, jenis_notifikasi, no_tujuan, isi_pesan, tanggal_jadwal)
     VALUES ($1, $2, 'KONFIRMASI_PERPANJANGAN', $3, $4, CURRENT_DATE)`, [b.id_sewa, b.id_perpanjangan, d.no_whatsapp, isi]);
}

const PETA_STATUS = { pending: 'PENDING', settlement: 'SETTLEMENT', capture: 'SETTLEMENT', expire: 'EXPIRE', cancel: 'CANCEL', deny: 'DENY' };

// Memproses satu status transaksi dalam SATU transaksi basis data.
// Hasil: { hasil: 'DIPROSES' | 'DUPLIKAT_DIABAIKAN' | 'DITOLAK_DATA', id_pembayaran, keterangan }
async function prosesStatus(pool, n) {
  const status = String(n.transaction_status || '').toLowerCase();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const b = (await c.query(
      `SELECT b.id_pembayaran, b.order_id, b.gross_amount, b.id_perpanjangan,
              p.id_sewa, p.jatuh_tempo_lama, p.jatuh_tempo_baru, p.status_perpanjangan
       FROM pembayaran b JOIN perpanjangan_sewa p ON p.id_perpanjangan = b.id_perpanjangan
       WHERE b.order_id = $1`, [String(n.order_id || '')])).rows[0];
    if (!b) { await c.query('ROLLBACK'); return { hasil: 'DITOLAK_DATA', keterangan: 'order_id tidak terdaftar' }; }

    const lunas = status === 'settlement' || (status === 'capture' && (n.fraud_status || 'accept') === 'accept');
    if (lunas) {
      // Idempotency atomik: hanya satu notifikasi yang berhasil mengubah is_processed dari false ke true
      const u = await c.query(
        `UPDATE pembayaran SET is_processed = true, transaction_status = 'SETTLEMENT',
                transaction_id = COALESCE($2, transaction_id), fraud_status = $3,
                settlement_time = COALESCE((($4::timestamp AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Makassar'), LOCALTIMESTAMP(0)) -- WIB dari Midtrans -> WITA
         WHERE order_id = $1 AND is_processed = false RETURNING id_pembayaran`,
        [b.order_id, n.transaction_id || null, n.fraud_status || null, n.settlement_time || n.transaction_time || null]);
      if (u.rowCount === 0) { await c.query('COMMIT'); return { hasil: 'DUPLIKAT_DIABAIKAN', id_pembayaran: b.id_pembayaran }; }

      const akhir = Number(n.gross_amount) === Number(b.gross_amount)
        ? await terapkanPerpanjangan(c, b)
        : await tandaiPerluTindakan(c, b, `Nominal tidak cocok: diterima ${n.gross_amount}, seharusnya ${b.gross_amount}`);
      await antreKonfirmasi(c, b, akhir);
      await c.query('COMMIT');
      return { hasil: 'DIPROSES', id_pembayaran: b.id_pembayaran, keterangan: akhir };
    }

    if (['expire', 'cancel', 'deny'].includes(status)) {
      await c.query(
        `UPDATE pembayaran SET transaction_status = $2 WHERE order_id = $1 AND is_processed = false AND transaction_status <> 'SETTLEMENT'`,
        [b.order_id, PETA_STATUS[status]]);
      await c.query(
        `UPDATE perpanjangan_sewa SET status_perpanjangan = $2 WHERE id_perpanjangan = $1 AND status_perpanjangan = 'MENUNGGU_PEMBAYARAN'`,
        [b.id_perpanjangan, status === 'expire' ? 'KEDALUWARSA' : 'GAGAL']);
      await c.query('COMMIT');
      return { hasil: 'DIPROSES', id_pembayaran: b.id_pembayaran, keterangan: status };
    }

    await c.query('COMMIT'); // pending dan status lain: dicatat tanpa perubahan data
    return { hasil: 'DIPROSES', id_pembayaran: b.id_pembayaran, keterangan: `status ${status || 'kosong'} tanpa perubahan` };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { signatureValid, prosesStatus };
