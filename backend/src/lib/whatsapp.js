// Modul pengirim WhatsApp. Satu-satunya tempat yang tahu cara mengirim pesan, sehingga penyedia
// dapat diganti tanpa mengubah bagian lain. Mode diatur dengan WA_MODE di .env:
//   simulasi (bawaan) : tidak mengirim ke WhatsApp; dipakai selama pengembangan dan uji kinerja
//   fonnte / meta     : diisi nanti setelah nomor pengirim tersedia
const mode = () => (process.env.WA_MODE || 'simulasi').toLowerCase();
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function kirimSimulasi({ no }) {
  await tunggu(Number(process.env.WA_SIMULASI_LATENSI_MS ?? 100)); // meniru waktu tunggu jaringan
  // Nomor berakhiran 0000 sengaja dibuat selalu gagal, untuk menguji percobaan ulang
  if (String(no).endsWith('0000')) return { berhasil: false, galat: 'Simulasi: nomor tidak terdaftar di WhatsApp' };
  return { berhasil: true, respons: JSON.stringify({ mode: 'simulasi', id: `sim-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` }) };
}

// Mengirim satu pesan. Tidak pernah melempar galat: selalu mengembalikan { berhasil, respons?, galat? }
async function kirimPesan(pesan) {
  try {
    if (mode() === 'simulasi') return await kirimSimulasi(pesan);
    return { berhasil: false, galat: `Mode pengiriman "${mode()}" belum diaktifkan` };
  } catch (e) {
    return { berhasil: false, galat: e.message };
  }
}

module.exports = { kirimPesan, mode };
