// Format waktu dari backend ('YYYY-MM-DD' atau 'YYYY-MM-DD HH:MM:SS', waktu WITA) tanpa objek Date,
// supaya tidak bergeser oleh zona waktu perangkat pengguna.
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function tanggal(s) {
  if (!s) return "";
  const [y, m, d] = String(s).split(/[ T]/)[0].split("-");
  return `${Number(d)} ${BULAN[Number(m) - 1]} ${y}`;
}

// '17:00' atau '2026-11-14 17:00:00' -> '17.00'
export function jam(s) {
  const bagian = String(s).split(/[ T]/);
  const t = bagian.length > 1 ? bagian[1] : bagian[0];
  return t.slice(0, 5).replace(":", ".");
}

export function waktu(s) {
  return `${tanggal(s)}, pukul ${jam(s)} WITA`;
}

// Menambah n hari pada waktu 'YYYY-MM-DD HH:MM:SS' tanpa terpengaruh zona waktu perangkat
export function tambahHari(s, n) {
  const [d, t] = String(s).split(/[ T]/);
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return `${x.toISOString().slice(0, 10)} ${t || "00:00:00"}`;
}
