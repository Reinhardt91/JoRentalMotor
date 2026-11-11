// Modul pengirim WhatsApp. Satu-satunya tempat yang tahu cara mengirim pesan, sehingga penyedia
// dapat diganti tanpa mengubah bagian lain. Mode diatur dengan WA_MODE di .env:
//   simulasi (bawaan) : tidak mengirim ke WhatsApp; dipakai selama pengembangan dan pengujian
//   fonnte            : mengirim melalui Fonnte (butuh FONNTE_TOKEN di .env)
const mode = () => (process.env.WA_MODE || 'simulasi').toLowerCase();
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function kirimSimulasi({ no }) {
  await tunggu(Number(process.env.WA_SIMULASI_LATENSI_MS ?? 100)); // meniru waktu tunggu jaringan
  // Nomor berakhiran 0000 sengaja dibuat selalu gagal, untuk menguji percobaan ulang
  if (String(no).endsWith('0000')) return { berhasil: false, galat: 'Simulasi: nomor tidak terdaftar di WhatsApp' };
  return { berhasil: true, respons: JSON.stringify({ mode: 'simulasi', id: `sim-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` }) };
}

// Fonnte: https://docs.fonnte.com (POST /send, token di header Authorization)
async function kirimFonnte({ no, isi }) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return { berhasil: false, galat: 'FONNTE_TOKEN belum diisi di .env' };
  const form = new FormData();
  form.append('target', String(no));
  form.append('message', String(isi));
  form.append('countryCode', '62');
  form.append('typing', 'true');      // indikator "sedang mengetik" agar pengiriman terlihat wajar
  form.append('connectOnly', 'true'); // tolak bila perangkat terputus; worker akan mencoba ulang
  const r = await fetch((process.env.FONNTE_API_URL || 'https://api.fonnte.com') + '/send', {
    method: 'POST', headers: { Authorization: token }, body: form, signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  // status true berarti pesan diterima Fonnte untuk dikirim; status sampai di ponsel dilihat di riwayat pesan Fonnte
  if (r.ok && d.status === true) return { berhasil: true, respons: JSON.stringify(d).slice(0, 1000) };
  return { berhasil: false, galat: `Fonnte: ${d.reason || d.detail || 'HTTP ' + r.status}` };
}

// Mengirim satu pesan. Tidak pernah melempar galat: selalu mengembalikan { berhasil, respons?, galat? }
async function kirimPesan(pesan) {
  try {
    if (mode() === 'simulasi') return await kirimSimulasi(pesan);
    if (mode() === 'fonnte') return await kirimFonnte(pesan);
    return { berhasil: false, galat: `Mode pengiriman "${mode()}" belum tersedia` };
  } catch (e) {
    return { berhasil: false, galat: e.name === 'TimeoutError' ? 'Gateway tidak menjawab dalam 20 detik' : e.message };
  }
}

module.exports = { kirimPesan, mode, kirimFonnte };
