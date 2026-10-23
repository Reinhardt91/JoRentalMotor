require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const motorRoutes = require('./routes/motor');
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
