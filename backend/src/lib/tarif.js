const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;

function tanggalValid(s) {
  if (!TGL_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Lama sewa dalam hari = selisih tanggal ambil dan tanggal kembali (minimal 1)
function hitungHari(mulai, selesai) {
  const ms = Date.parse(selesai + 'T00:00:00Z') - Date.parse(mulai + 'T00:00:00Z');
  return Math.max(1, Math.round(ms / 86400000));
}

// Paket mingguan dipakai untuk tiap 7 hari penuh, sisanya dihitung harian
function hitungBiaya(hari, harian, mingguan) {
  harian = Number(harian);
  if (mingguan === null || mingguan === undefined) return hari * harian;
  return Math.floor(hari / 7) * Number(mingguan) + (hari % 7) * harian;
}

module.exports = { tanggalValid, hitungHari, hitungBiaya };