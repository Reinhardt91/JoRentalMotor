require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const motorRoutes = require('./routes/motor');
const reservasiRoutes = require('./routes/reservasi');
const sewaRoutes = require('./routes/sewa');
const perpanjanganRoutes = require('./routes/perpanjangan');
const webhookRoutes = require('./routes/webhook');
const adminTambahanRoutes = require('./routes/adminTambahan');
const jobsRoutes = require('./routes/jobs');
const notifikasiRoutes = require('./routes/notifikasi');
const kinerjaRoutes = require('./routes/kinerja');
const { prosesAntrean } = require('./jobs/pengirim');
const { pulihkanJadwal } = require('./jobs/pengingat');
const { JAM_PENGINGAT_H1, JAM_PENGINGAT_H0 } = require('./config');
const cron = require('node-cron');
const { jalankanRekonsiliasi } = require('./jobs/rekonsiliasi');
const { authenticate, requireRole } = require('./middleware/auth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET belum diisi atau kurang dari 32 karakter. Periksa file .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/motor', motorRoutes);
app.use('/api/reservasi', reservasiRoutes.pelanggan);
app.use('/api/admin/reservasi', reservasiRoutes.admin);
app.use('/api/admin', sewaRoutes);
app.use('/api', perpanjanganRoutes);
app.use('/api/webhook', webhookRoutes.publik);
app.use('/api/admin', webhookRoutes.admin);
app.use('/api/admin', adminTambahanRoutes);
app.use('/api/admin', jobsRoutes);
app.use('/api/admin', notifikasiRoutes);
app.use('/api/admin', kinerjaRoutes);

// Rute contoh untuk menguji pembatasan peran (boleh dihapus nanti)
app.get('/api/admin/ping', authenticate, requireRole('ADMIN'), (req, res) => {
  res.json({ pesan: 'Halo admin, akses diterima.' });
});

// Rute tidak dikenal
app.use((req, res) => res.status(404).json({ pesan: 'Rute tidak ditemukan.' }));

// Penanganan galat terpusat
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ pesan: 'Format JSON tidak valid.' });
  }
  console.error(err);
  res.status(500).json({ pesan: 'Terjadi kesalahan pada server.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server berjalan di port ' + PORT));

// Job rekonsiliasi pembayaran setiap 5 menit (WITA). Set JOB_AKTIF=false di .env untuk menonaktifkan saat pengujian.
if (process.env.JOB_AKTIF !== 'false') {
  cron.schedule('*/5 * * * *', () => {
    jalankanRekonsiliasi().catch((e) => console.error('Rekonsiliasi gagal:', e.message));
  }, { timezone: 'Asia/Makassar' });

  // Worker pengirim WhatsApp setiap menit (pesan baru dan percobaan ulang).
  // Penanda mencegah dua putaran berjalan tumpang tindih.
  let pengirimBerjalan = false;
  cron.schedule('* * * * *', async () => {
    if (pengirimBerjalan) return;
    pengirimBerjalan = true;
    try { await prosesAntrean(); } catch (e) { console.error('Pengirim WhatsApp gagal:', e.message); }
    finally { pengirimBerjalan = false; }
  }, { timezone: 'Asia/Makassar' });

  // Pengingat jatuh tempo pada pukul 17.00 (H-1) dan 08.00 (H-0) WITA
  const cronJam = (j) => { const [h, m] = j.split(':').map(Number); return `${m} ${h} * * *`; };
  for (const j of [JAM_PENGINGAT_H1, JAM_PENGINGAT_H0]) {
    cron.schedule(cronJam(j), () => {
      pulihkanJadwal().catch((e) => console.error('Pengingat gagal:', e.message));
    }, { timezone: 'Asia/Makassar' });
  }

  // Pemulihan saat server dinyalakan: jalankan jadwal yang terlewat selama server mati
  pulihkanJadwal()
    .then((h) => { if (h.slot && h.slot.length) console.log(`Pemulihan jadwal: ${h.slot.length} jadwal terlewat diproses.`); })
    .catch((e) => console.error('Pemulihan jadwal gagal:', e.message));
}
