// Mengirim SATU pesan uji melalui Fonnte ke nomor yang ditentukan, lalu menampilkan jawaban Fonnte.
// Tidak memakai antrean dan tidak mengubah basis data. Butuh FONNTE_TOKEN di .env dan perangkat berstatus connect.
//   node tests/kirim-uji-whatsapp.js 6285xxxxxxxxx --yes
require('dotenv').config({ quiet: true });
const { kirimFonnte } = require('../src/lib/whatsapp');
const no = process.argv[2];
if (!no || !/^62\d{8,13}$/.test(no)) { console.log('Pakai: node tests/kirim-uji-whatsapp.js 62xxxxxxxxxx --yes   (nomor diawali 62, tanpa + dan tanpa 0)'); process.exit(1); }
if (!process.argv.includes('--yes')) { console.log(`Akan mengirim SATU pesan WhatsApp sungguhan melalui Fonnte ke ${no}.\nJika yakin, tambahkan --yes`); process.exit(0); }
(async () => {
  const t = Date.now();
  const h = await kirimFonnte({ no, isi: 'Uji coba pengiriman dari sistem Jo Rental Motor. Pesan ini dapat diabaikan.' });
  console.log(h.berhasil ? 'BERHASIL: pesan diterima Fonnte untuk dikirim' : 'GAGAL: ' + h.galat);
  if (h.respons) console.log('Jawaban Fonnte: ' + h.respons);
  console.log(`Waktu: ${Date.now() - t} ms`);
  console.log('Periksa WhatsApp di nomor tujuan, dan menu Message History di dashboard Fonnte.');
})();
