// Sama dengan perhitungan di backend (hanya untuk pratinjau; nilai resmi dihitung server)
export function hitungBiaya(hari, harian, mingguan) {
  if (mingguan === null || mingguan === undefined) return hari * harian;
  return Math.floor(hari / 7) * mingguan + (hari % 7) * harian;
}
