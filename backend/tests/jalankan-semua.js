// Menjalankan seluruh rangkaian uji berurutan dan menyimpan bukti pengujian untuk Bab 4.
//
// PERINGATAN: skrip ini MERESET database (menghapus semua data lalu memuat schema.sql dan data demo).
// Matikan dulu backend yang berjalan di terminal lain, karena worker dan job-nya dapat mengganggu pengujian.
//
// Pakai (dari folder backend):
//   node tests/jalankan-semua.js --yes                 uji dengan Midtrans Sandbox sungguhan (butuh internet)
//   node tests/jalankan-semua.js --yes --tiruan        uji dengan server Midtrans tiruan (tanpa internet; menjalankan bagian tambahan
//                                                      seperti rekonsiliasi dan gangguan Midtrans)
//   node tests/jalankan-semua.js --yes --hanya=alur-webhook,alur-pengingat     hanya sebagian rangkaian uji
//
// Hasil disimpan di backend/hasil-uji/<tanggal-jam>/ : satu berkas .txt per rangkaian uji, backend.log, dan RINGKASAN.md
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const TIRUAN = argv.includes('--tiruan');
const hanyaArg = argv.find((a) => a.startsWith('--hanya='));
const HANYA = hanyaArg ? hanyaArg.slice(8).split(',').map((s) => s.trim()).filter(Boolean) : null;
const PORT = '3100';
const ROOT = path.join(__dirname, '..');
const SCHEMA = process.env.SCHEMA_PATH || path.join(ROOT, '..', 'database', 'schema.sql');

const SUITES = [
  { nama: 'alur-reservasi',       rumusan: '3',     judul: 'Pemesanan dan jadwal bertumpang tindih' },
  { nama: 'alur-admin',           rumusan: '3',     judul: 'Konfirmasi, mulai sewa, akhiri sewa, Optimistic Locking' },
  { nama: 'alur-perpanjangan',    rumusan: '1 dan 3', judul: 'Pengajuan perpanjangan dan pembuatan QRIS' },
  { nama: 'alur-webhook',         rumusan: '1 dan 2', judul: 'Webhook: signature, duplikat, status, rekonsiliasi' },
  { nama: 'alur-admin-tambahan',  rumusan: '3',     judul: 'Perpanjangan bermasalah dan kelola armada' },
  { nama: 'alur-pengirim',        rumusan: '4',     judul: 'Antrean WhatsApp, percobaan ulang (mode simulasi)' },
  { nama: 'alur-pengingat',       rumusan: '4',     judul: 'Pengingat H-1/H-0, pemulihan jadwal, TERLAMBAT' },
];

if (!argv.includes('--yes')) {
  const nama = (process.env.DATABASE_URL || '').split('/').pop().split('?')[0] || '(belum diatur)';
  console.log(`Skrip ini akan MERESET database "${nama}" (semua data dihapus, lalu schema.sql dan data demo dimuat ulang),
menyalakan backend sendiri di port ${PORT}, dan menjalankan ${HANYA ? HANYA.length : SUITES.length} rangkaian uji.
Matikan dulu backend lain yang memakai database ini.

Jika sudah yakin, jalankan ulang dengan penanda --yes:
  node tests/jalankan-semua.js --yes${TIRUAN ? ' --tiruan' : ''}`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL belum diisi di .env'); process.exit(1); }
if (!fs.existsSync(SCHEMA)) { console.error('schema.sql tidak ditemukan di: ' + SCHEMA + '\nAtur lokasinya dengan variabel SCHEMA_PATH.'); process.exit(1); }
for (const h of HANYA || []) if (!SUITES.some((s) => s.nama === h)) { console.error('Rangkaian uji tidak dikenal: ' + h); process.exit(1); }

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
const stempel = new Date(new Date().getTime() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', '-').replace(/:/g, ''); // WITA
const FOLDER = path.join(ROOT, 'hasil-uji', stempel + (TIRUAN ? '-tiruan' : ''));
fs.mkdirSync(FOLDER, { recursive: true });

const ENV_UJI = {
  ...process.env,
  PORT, JOB_AKTIF: 'false', IZINKAN_WAKTU_UJI: 'true', WA_MODE: 'simulasi',
  WA_JEDA_ANTAR_PESAN_MS: '0', WA_SIMULASI_LATENSI_MS: '20',
  ...(TIRUAN ? { MIDTRANS_API_URL: 'http://localhost:4010' } : { MIDTRANS_API_URL: '' }),
};
if (!TIRUAN) delete ENV_UJI.MIDTRANS_API_URL;

async function resetDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar', max: 1 });
  try {
    await pool.query(fs.readFileSync(SCHEMA, 'utf8'));
  } finally { await pool.end(); }
  await jalankanProses('node', ['src/seed.js', '--demo'], ENV_UJI, null);
}

function jalankanProses(cmd, args, env, berkas) {
  return new Promise((resolve) => {
    const out = berkas ? fs.createWriteStream(berkas, { flags: 'a' }) : null;
    const p = spawn(cmd === 'node' ? process.execPath : cmd, args, { cwd: ROOT, env, windowsHide: true });
    let teks = '';
    const tangkap = (d) => { const s = d.toString(); teks += s; if (out) out.write(s); };
    p.stdout.on('data', tangkap); p.stderr.on('data', tangkap);
    p.on('close', (kode) => { if (out) out.end(); resolve({ kode, teks }); });
  });
}

async function nyalakanBackend() {
  const log = fs.createWriteStream(path.join(FOLDER, 'backend.log'), { flags: 'a' });
  const p = spawn(process.execPath, ['src/index.js'], { cwd: ROOT, env: ENV_UJI, windowsHide: true });
  p.stdout.on('data', (d) => log.write(d)); p.stderr.on('data', (d) => log.write(d));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return p; } catch {}
    await tunggu(500);
  }
  p.kill(); throw new Error('Backend tidak menyala di port ' + PORT + '. Lihat backend.log di ' + FOLDER);
}
async function nyalakanTiruan() {
  const p = spawn(process.execPath, ['tests/midtrans-tiruan.js'], { cwd: ROOT, env: ENV_UJI, windowsHide: true });
  await tunggu(800); return p;
}

(async () => {
  const mulaiSemua = Date.now();
  const daftar = SUITES.filter((s) => !HANYA || HANYA.includes(s.nama));
  let tiruan = null;
  const hasil = [];
  try {
    if (TIRUAN) tiruan = await nyalakanTiruan();
    console.log(`Hasil disimpan di: ${FOLDER}\nMode Midtrans: ${TIRUAN ? 'server tiruan' : 'Sandbox sungguhan'}\n`);

    for (const s of daftar) {
      process.stdout.write(`${s.nama.padEnd(22)} reset data... `);
      await resetDatabase();
      const backend = await nyalakanBackend();
      process.stdout.write('menjalankan... ');
      const mulai = Date.now();
      const r = await jalankanProses('node', [`tests/${s.nama}.js`], ENV_UJI, path.join(FOLDER, `${s.nama}.txt`));
      const detik = ((Date.now() - mulai) / 1000).toFixed(1);
      backend.kill();
      await tunggu(500);
      const ok = (r.teks.match(/^ {2}OK /gm) || []).length;
      const salah = (r.teks.match(/^ {2}GAGAL /gm) || []).length;
      const penutup = (r.teks.match(/=== (.+?) ===/g) || []).pop() || '';
      const lulus = r.kode === 0 && salah === 0 && /SEMUA LULUS/.test(penutup) && ok > 0;
      hasil.push({ ...s, ok, salah, detik, lulus, galat: r.kode !== 0 && salah === 0 });
      console.log(`${lulus ? 'LULUS' : 'GAGAL'}  (${ok} OK, ${salah} gagal, ${detik} dtk)`);
    }
  } finally {
    if (tiruan) tiruan.kill();
  }

  // Kembalikan database ke keadaan segar agar aplikasi siap dipakai lagi
  process.stdout.write('\nMengembalikan data demo yang segar... ');
  await resetDatabase(); console.log('selesai.');

  // Ringkasan
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let versiPg = '?';
  try { versiPg = (await pool.query('show server_version')).rows[0].server_version; } catch {} finally { await pool.end(); }
  const totalOk = hasil.reduce((a, x) => a + x.ok, 0), totalSalah = hasil.reduce((a, x) => a + x.salah, 0);
  const wita = new Date(new Date().getTime() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  let md = `# Ringkasan pengujian otomatis\n\n`;
  md += `- Waktu: ${wita} WITA\n- Mode Midtrans: ${TIRUAN ? 'server tiruan (tanpa internet)' : 'Midtrans Sandbox sungguhan'}\n`;
  md += `- Lingkungan: Node.js ${process.version}, PostgreSQL ${versiPg}, ${process.platform}\n`;
  md += `- Total waktu: ${((Date.now() - mulaiSemua) / 1000).toFixed(0)} detik\n\n`;
  md += `| Rangkaian uji | Rumusan | Fokus | Pemeriksaan lulus | Gagal | Waktu (dtk) | Hasil |\n|---|---|---|---|---|---|---|\n`;
  for (const x of hasil) md += `| ${x.nama} | ${x.rumusan} | ${x.judul} | ${x.ok} | ${x.salah} | ${x.detik} | ${x.lulus ? 'LULUS' : x.galat ? 'GALAT' : 'GAGAL'} |\n`;
  md += `| **Total** | | | **${totalOk}** | **${totalSalah}** | | **${hasil.every((x) => x.lulus) ? 'SEMUA LULUS' : 'ADA YANG GAGAL'}** |\n`;
  fs.writeFileSync(path.join(FOLDER, 'RINGKASAN.md'), md, 'utf8');
  console.log('\n' + md);
  console.log(`Berkas bukti ada di: ${FOLDER}`);
  process.exit(hasil.every((x) => x.lulus) ? 0 : 1);
})().catch((e) => { console.error('\nGalat: ' + e.message); process.exit(1); });
