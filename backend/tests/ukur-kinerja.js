// Pengukuran kinerja (Rumusan 4): dampak pemrosesan notifikasi WhatsApp terhadap backend.
// Mengukur latensi API dari sisi pengguna (median, p95, p99) dan event loop delay dari dalam backend,
// pada tiga skenario: tanpa beban notifikasi, beban realistis (30 pesan), dan beban ekstrem (300 pesan).
//
// PERINGATAN: skrip ini MERESET database. Matikan dulu backend lain yang memakai database ini.
// Pakai (dari folder backend):
//   node tests/ukur-kinerja.js --yes
//   node tests/ukur-kinerja.js --yes --pengguna=10 --durasi=20 --putaran=3
//      (jumlah pengguna tiruan, lama minimal per skenario dalam detik, jumlah putaran dengan urutan skenario digilir)
// Hasil: backend/hasil-uji/<tanggal-jam>-kinerja/RINGKASAN-KINERJA.md dan kinerja-mentah.json
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const arg = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? Number(a.split('=')[1]) : d; };
const PENGGUNA = arg('pengguna', 10);
const DURASI_MIN = arg('durasi', 20) * 1000;
const PEMANASAN = 2000;
const PUTARAN = arg('putaran', 3); // tiap skenario diulang, urutan digilir agar tidak ada yang selalu pertama
const PEMANASAN_AWAL = 10000;
const LATENSI_WA = 150; // jeda tiruan per pesan WhatsApp (meniru panggilan jaringan ke gateway)
const PORT = '3100';
const B = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const SCHEMA = process.env.SCHEMA_PATH || path.join(ROOT, '..', 'database', 'schema.sql');
const TARGET_P95 = 500, TARGET_ELD_P99 = 100;
const SKENARIO = [
  { nama: 'Tanpa beban notifikasi', pesan: 0 },
  { nama: 'Beban realistis', pesan: 30 },
  { nama: 'Beban ekstrem', pesan: 300 },
];

if (!argv.includes('--yes')) {
  console.log(`Skrip ini MERESET database, menyalakan backend sendiri di port ${PORT}, lalu mengukur kinerja
pada ${SKENARIO.length} skenario x ${PUTARAN} putaran dengan ${PENGGUNA} pengguna tiruan. Matikan dulu backend lain.
Jika sudah yakin: node tests/ukur-kinerja.js --yes
Perkiraan waktu dengan pengaturan bawaan: sekitar 5 menit.`);
  process.exit(0);
}
if (!fs.existsSync(SCHEMA)) { console.error('schema.sql tidak ditemukan di: ' + SCHEMA); process.exit(1); }

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
const wita = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const FOLDER = path.join(ROOT, 'hasil-uji', wita().replace(' ', '-').replace(/:/g, '') + '-kinerja');
fs.mkdirSync(FOLDER, { recursive: true });
const ENV = { ...process.env, PORT, JOB_AKTIF: 'false', UKUR_KINERJA: 'true', WA_MODE: 'simulasi',
  WA_JEDA_ANTAR_PESAN_MS: '0', WA_SIMULASI_LATENSI_MS: String(LATENSI_WA) };
delete ENV.MIDTRANS_API_URL;

function proses(args, log) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, env: ENV, windowsHide: true });
    if (log) { p.stdout.on('data', (d) => log.write(d)); p.stderr.on('data', (d) => log.write(d)); }
    p.on('close', resolve);
  });
}
async function resetDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await pool.query(fs.readFileSync(SCHEMA, 'utf8')); } finally { await pool.end(); }
  await proses(['src/seed.js', '--demo']);
}
async function nyalakanBackend() {
  const log = fs.createWriteStream(path.join(FOLDER, 'backend.log'), { flags: 'a' });
  const p = spawn(process.execPath, ['src/index.js'], { cwd: ROOT, env: ENV, windowsHide: true });
  p.stdout.on('data', (d) => log.write(d)); p.stderr.on('data', (d) => log.write(d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${B}/health`)).ok) return p; } catch {} await tunggu(500); }
  p.kill(); throw new Error('Backend tidak menyala di port ' + PORT);
}
const call = async (method, p, token, body) => {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {} return { s: r.status, d };
};
const persentil = (urut, p) => (urut.length ? urut[Math.min(urut.length - 1, Math.ceil((p / 100) * urut.length) - 1)] : null);
const bulat = (x) => (x === null ? null : Math.round(x * 10) / 10);

(async () => {
  console.log(`Hasil disimpan di: ${FOLDER}`);
  await resetDatabase();
  const backend = await nyalakanBackend();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Makassar', max: 2 });
  const hasil = [];
  try {
    const A = (await call('POST', '/api/auth/login', null, { email: 'admin@jorental.local', password: 'Admin12345' })).d.token;
    const P = (await call('POST', '/api/auth/login', null, { email: 'pelanggan@test.com', password: 'Pelanggan123' })).d.token;
    const hari = (await pool.query('select (localtimestamp::date + 3)::text a, (localtimestamp::date + 5)::text b')).rows[0];
    const idSewa = (await pool.query('SELECT id_sewa FROM sewa ORDER BY id_sewa LIMIT 1')).rows[0].id_sewa;
    const RUTE = ['/api/motor', `/api/motor?mulai=${hari.a}&selesai=${hari.b}`, '/api/reservasi/saya'];

    // Pemanasan bersama (tidak dihitung): agar skenario pertama tidak dirugikan oleh kompilasi JIT
    // dan cache basis data yang masih dingin tepat setelah backend menyala
    process.stdout.write(`Pemanasan ${PEMANASAN_AWAL / 1000} detik (tidak dihitung)... `);
    {
      let lanjut = true;
      const vu = Array.from({ length: PENGGUNA }, (_, i) => (async () => {
        let k = i;
        while (lanjut) { try { const r = await fetch(B + RUTE[k++ % RUTE.length], { headers: { Authorization: 'Bearer ' + P } }); await r.arrayBuffer(); } catch {} }
      })());
      await tunggu(PEMANASAN_AWAL); lanjut = false; await Promise.all(vu);
    }
    console.log('selesai.');

    async function ukur(sk) {
      await pool.query('DELETE FROM notifikasi_whatsapp');
      await call('POST', '/api/admin/kinerja/mulai', A);
      const sampel = [];
      const t0 = performance.now();
      let jalan = true;
      // Pengguna tiruan: masing-masing mengirim permintaan berikutnya segera setelah jawaban diterima
      const pengguna = Array.from({ length: PENGGUNA }, (_, i) => (async () => {
        let k = i;
        while (jalan) {
          const rute = RUTE[k++ % RUTE.length];
          const m = performance.now();
          let okk = false;
          try { const r = await fetch(B + rute, { headers: { Authorization: 'Bearer ' + P } }); await r.arrayBuffer(); okk = r.ok; } catch {}
          sampel.push({ t: m - t0, ms: performance.now() - m, ok: okk });
        }
      })());

      // Masukkan pesan ke antrean lalu proses sampai habis (sambil pengguna tiruan terus mengirim permintaan)
      await tunggu(PEMANASAN);
      let lamaProses = 0;
      if (sk.pesan > 0) {
        await pool.query(
          `INSERT INTO notifikasi_whatsapp (id_sewa, jenis_notifikasi, no_tujuan, isi_pesan, tanggal_jadwal)
           SELECT $1, 'KONFIRMASI_PERPANJANGAN', '62812' || lpad(g::text, 8, '0'), 'Pesan uji kinerja ' || g, CURRENT_DATE
           FROM generate_series(1, $2) g`, [idSewa, sk.pesan]);
        const mulaiProses = performance.now();
        for (;;) { const r = await call('POST', '/api/admin/jobs/pengirim', A); if (!r.d || !r.d.data || r.d.data.diproses === 0) break; }
        lamaProses = performance.now() - mulaiProses;
      }
      while (performance.now() - t0 < DURASI_MIN) await tunggu(100);
      jalan = false;
      await Promise.all(pengguna);
      const eld = (await call('GET', '/api/admin/kinerja', A)).d.data;
      const terkirim = Number((await pool.query(`SELECT count(*) n FROM notifikasi_whatsapp WHERE status_kirim = 'TERKIRIM'`)).rows[0].n);

      const dipakai = sampel.filter((x) => x.t >= PEMANASAN);
      const ms = dipakai.filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
      const durasiDtk = (Math.max(...dipakai.map((x) => x.t + x.ms)) - PEMANASAN) / 1000;
      const bersih = (v) => bulat(Math.max(0, v - eld.resolusi_ms)); // nilai histogram dikurangi resolusi pengukur
      const h = {
        skenario: sk.nama, pesan: sk.pesan, terkirim, lama_proses_dtk: bulat(lamaProses / 1000),
        permintaan: dipakai.length, galat: dipakai.length - ms.length, throughput: bulat(dipakai.length / durasiDtk),
        median: bulat(persentil(ms, 50)), p95: bulat(persentil(ms, 95)), p99: bulat(persentil(ms, 99)), maks: bulat(ms[ms.length - 1]),
        eld_p50: bersih(eld.p50), eld_p99: bersih(eld.p99), eld_maks: bersih(eld.maks), eld_mentah: eld,
      };
      h.memenuhi = h.p95 < TARGET_P95 && h.eld_p99 < TARGET_ELD_P99 && h.galat === 0 && h.terkirim === sk.pesan;
      return h;
    }

    for (let r = 0; r < PUTARAN; r++) {
      const urutan = SKENARIO.map((_, i) => SKENARIO[(i + r) % SKENARIO.length]);
      console.log(`Putaran ${r + 1} dari ${PUTARAN}`);
      for (const sk of urutan) {
        process.stdout.write(`  ${sk.nama.padEnd(24)} `);
        const h = await ukur(sk);
        h.putaran = r + 1;
        hasil.push(h);
        console.log(`p95 ${h.p95} ms, ELD p99 ${h.eld_p99} ms, ${h.permintaan} permintaan, ${h.terkirim}/${sk.pesan} pesan -> ${h.memenuhi ? 'memenuhi' : 'TIDAK MEMENUHI'}`);
      }
    }
  } finally {
    await pool.end();
    backend.kill();
    await tunggu(500);
  }
  process.stdout.write('Mengembalikan data demo yang segar... '); await resetDatabase(); console.log('selesai.');

  const pool2 = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let versiPg = '?'; try { versiPg = (await pool2.query('show server_version')).rows[0].server_version; } catch {} finally { await pool2.end(); }
  let md = `# Ringkasan pengukuran kinerja\n\n`;
  md += `- Waktu: ${wita()} WITA\n- Lingkungan: Node.js ${process.version}, PostgreSQL ${versiPg}, ${process.platform}, ${require('os').cpus().length} CPU\n`;
  md += `- Beban API: ${PENGGUNA} pengguna tiruan bersamaan, tanpa jeda berpikir, bergiliran memanggil ${['GET /api/motor', 'GET /api/motor?mulai&selesai', 'GET /api/reservasi/saya'].join(', ')}\n`;
  md += `- Notifikasi: mode simulasi, ${LATENSI_WA} ms per pesan (meniru panggilan ke gateway), tanpa jeda antarpesan (lebih berat dari pemakaian sebenarnya)\n`;
  md += `- Pemanasan bersama ${PEMANASAN_AWAL / 1000} detik sebelum skenario pertama; lama minimal tiap skenario ${DURASI_MIN / 1000} detik, ${PEMANASAN / 1000} detik pertama tiap skenario tidak dihitung\n`;
  md += `- Event loop delay: perf_hooks.monitorEventLoopDelay, resolusi 10 ms; nilai yang dilaporkan sudah dikurangi resolusi\n`;
  md += `- Target: latensi p95 < ${TARGET_P95} ms dan event loop delay p99 < ${TARGET_ELD_P99} ms\n\n`;
  md += `- Putaran: ${PUTARAN}, urutan skenario digilir tiap putaran; tabel utama memakai MEDIAN antarputaran, kolom "terburuk" memakai nilai paling buruk\n\n`;
  const med = (xs) => { const u = [...xs].sort((a, b) => a - b); const m = Math.floor(u.length / 2); return bulat(u.length % 2 ? u[m] : (u[m - 1] + u[m]) / 2); };
  md += `## Hasil (median antarputaran)\n\n`;
  md += `| Skenario | Pesan terkirim | Lama proses antrean (dtk) | Throughput (req/dtk) | Galat | Latensi median (ms) | p95 (ms) | p95 terburuk (ms) | p99 (ms) | ELD p99 (ms) | ELD p99 terburuk (ms) | ELD maks terburuk (ms) | Target (semua putaran) |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const sk of SKENARIO) {
    const xs = hasil.filter((h) => h.skenario === sk.nama);
    const f = (k) => xs.map((h) => h[k]);
    md += `| ${sk.nama} | ${f('terkirim').reduce((a, b) => a + b, 0)} dari ${sk.pesan * xs.length} | ${med(f('lama_proses_dtk'))} | ${med(f('throughput'))} | ${f('galat').reduce((a, b) => a + b, 0)} | ${med(f('median'))} | ${med(f('p95'))} | ${Math.max(...f('p95'))} | ${med(f('p99'))} | ${med(f('eld_p99'))} | ${Math.max(...f('eld_p99'))} | ${Math.max(...f('eld_maks'))} | ${xs.every((h) => h.memenuhi) ? 'Memenuhi' : 'Tidak memenuhi'} |\n`;
  }
  md += `\n## Rincian per putaran\n\n| Putaran | Skenario | Pesan (terkirim) | Lama proses (dtk) | Permintaan | Throughput | Galat | Median | p95 | p99 | ELD p50 | ELD p99 | ELD maks |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const h of hasil) md += `| ${h.putaran} | ${h.skenario} | ${h.pesan} (${h.terkirim}) | ${h.lama_proses_dtk} | ${h.permintaan} | ${h.throughput} | ${h.galat} | ${h.median} | ${h.p95} | ${h.p99} | ${h.eld_p50} | ${h.eld_p99} | ${h.eld_maks} |\n`;
  fs.writeFileSync(path.join(FOLDER, 'RINGKASAN-KINERJA.md'), md, 'utf8');
  fs.writeFileSync(path.join(FOLDER, 'kinerja-mentah.json'), JSON.stringify(hasil, null, 2), 'utf8');
  console.log('\n' + md + `\nBerkas ada di: ${FOLDER}`);
  process.exit(hasil.every((h) => h.memenuhi) ? 0 : 1);
})().catch((e) => { console.error('\nGalat: ' + e.message); process.exit(1); });