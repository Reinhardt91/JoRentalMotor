const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Hash palsu agar waktu respons login tetap mirip walau email tidak terdaftar
const DUMMY_HASH = bcrypt.hashSync('kata-sandi-palsu', 10);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 0812xxxx / 812xxxx / +62812xxxx -> 62812xxxx
function normalisasiWA(nomor) {
  let n = String(nomor || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return /^62\d{8,13}$/.test(n) ? n : null;
}

// ---------- POST /api/auth/register (use case: Registrasi akun) ----------
router.post('/register', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const nama = String(b.nama_lengkap || '').trim();
  const noKtp = String(b.no_ktp || '').trim();
  const asal = b.asal_daerah ? String(b.asal_daerah).trim().slice(0, 100) : null;
  const wa = normalisasiWA(b.no_whatsapp);

  const galat = [];
  if (!EMAIL_RE.test(email) || email.length > 100) galat.push('Email tidak valid.');
  if (password.length < 8 || password.length > 72) galat.push('Password harus 8 sampai 72 karakter.');
  if (nama.length < 2 || nama.length > 100) galat.push('Nama lengkap harus 2 sampai 100 karakter.');
  if (!wa) galat.push('Nomor WhatsApp tidak valid (contoh: 081234567890).');
  if (!/^\d{16}$/.test(noKtp)) galat.push('Nomor KTP harus 16 digit angka.');
  if (galat.length) return res.status(400).json({ pesan: 'Data tidak valid.', galat });

  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Peran SELALU PELANGGAN; tidak pernah diambil dari input pengguna
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'PELANGGAN')
       RETURNING id_user`,
      [email, hash]
    );
    const p = await client.query(
      `INSERT INTO pelanggan (id_user, nama_lengkap, no_whatsapp, no_ktp, asal_daerah)
       VALUES ($1, $2, $3, $4, $5) RETURNING id_pelanggan`,
      [u.rows[0].id_user, nama, wa, noKtp, asal]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      pesan: 'Registrasi berhasil. Silakan login.',
      data: { id_user: u.rows[0].id_user, id_pelanggan: p.rows[0].id_pelanggan, email, nama_lengkap: nama },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      const pesan = String(e.constraint).includes('no_ktp')
        ? 'Nomor KTP sudah terdaftar.'
        : 'Email sudah terdaftar.';
      return res.status(409).json({ pesan });
    }
    throw e;
  } finally {
    client.release();
  }
});

// ---------- POST /api/auth/login (use case: Login) ----------
router.post('/login', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!email || !password) {
    return res.status(400).json({ pesan: 'Email dan password wajib diisi.' });
  }

  const r = await pool.query(
    `SELECT u.id_user, u.email, u.password_hash, u.role, u.is_active,
            p.id_pelanggan, p.nama_lengkap
     FROM users u LEFT JOIN pelanggan p ON p.id_user = u.id_user
     WHERE u.email = $1`,
    [email]
  );
  const u = r.rows[0];
  const cocok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);

  // Pesan sengaja sama untuk "email tidak ada" dan "password salah"
  if (!u || !cocok) return res.status(401).json({ pesan: 'Email atau password salah.' });
  if (!u.is_active) return res.status(403).json({ pesan: 'Akun Anda dinonaktifkan. Hubungi admin.' });

  const token = jwt.sign({ role: u.role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(u.id_user),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

  res.json({
    pesan: 'Login berhasil.',
    token,
    user: {
      id_user: u.id_user,
      email: u.email,
      role: u.role,
      id_pelanggan: u.id_pelanggan,
      nama_lengkap: u.nama_lengkap,
    },
  });
});

// ---------- GET /api/auth/me : data pengguna yang sedang login ----------
router.get('/me', authenticate, async (req, res) => {
  const r = await pool.query(
    `SELECT u.id_user, u.email, u.role, p.id_pelanggan, p.nama_lengkap, p.no_whatsapp
     FROM users u LEFT JOIN pelanggan p ON p.id_user = u.id_user
     WHERE u.id_user = $1`,
    [req.user.id_user]
  );
  res.json({ user: r.rows[0] });
});

module.exports = router;
