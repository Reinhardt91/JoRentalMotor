const jwt = require('jsonwebtoken');
const pool = require('../db');

// Memastikan request membawa token login yang valid.
// Peran (role) dan status aktif dibaca ulang dari database, bukan dipercaya dari token,
// sehingga akun yang dinonaktifkan langsung kehilangan akses.
async function authenticate(req, res, next) {
  const [skema, token] = (req.headers.authorization || '').split(' ');
  if (skema !== 'Bearer' || !token) {
    return res.status(401).json({ pesan: 'Token tidak ada. Silakan login.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    const pesan = e.name === 'TokenExpiredError'
      ? 'Sesi berakhir. Silakan login ulang.'
      : 'Token tidak valid.';
    return res.status(401).json({ pesan });
  }

  const r = await pool.query(
    `SELECT u.id_user, u.role, u.is_active, p.id_pelanggan
     FROM users u LEFT JOIN pelanggan p ON p.id_user = u.id_user
     WHERE u.id_user = $1`,
    [Number(payload.sub)]
  );
  const u = r.rows[0];
  if (!u || !u.is_active) {
    return res.status(401).json({ pesan: 'Akun tidak ditemukan atau dinonaktifkan.' });
  }

  req.user = { id_user: u.id_user, role: u.role, id_pelanggan: u.id_pelanggan };
  next();
}

// Membatasi akses berdasarkan peran, contoh: requireRole('ADMIN')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ pesan: 'Anda tidak memiliki akses ke fitur ini.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
