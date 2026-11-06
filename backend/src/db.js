require('dotenv').config({ quiet: true });
const { Pool, types } = require('pg');

// Waktu disimpan sebagai TIMESTAMP tanpa zona (waktu dinding WITA, lokasi usaha di Manado).
// Dikembalikan sebagai teks 'YYYY-MM-DD HH:MM:SS' supaya tidak bergeser oleh zona waktu komputer server.
types.setTypeParser(1114, (v) => v); // timestamp
types.setTypeParser(1082, (v) => v); // date

module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=Asia/Makassar', // zona waktu sesi ditetapkan saat koneksi dibuka
});
