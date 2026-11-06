// Jam standar pengambilan dan pengembalian motor (WITA). Ubah di sini jika kebiasaan pemilik berbeda.
module.exports = {
  JAM_AMBIL: '09:00',
  JAM_KEMBALI: '17:00',
  MAKS_HARI_SEWA: 60,
  MAKS_HARI_PERPANJANGAN: 30,
  MENIT_BERLAKU_QRIS: 15, // masa berlaku kode QR perpanjangan
  JAM_PENGINGAT_H1: '17:00', // pengingat sehari sebelum jatuh tempo (WITA)
  JAM_PENGINGAT_H0: '08:00', // pengingat pada hari jatuh tempo (WITA)
  MAKS_HARI_PEMULIHAN: 3,    // jadwal terlewat paling lama sekian hari ke belakang yang diperiksa
};
