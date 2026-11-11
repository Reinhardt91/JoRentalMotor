// Uji logika service worker (public/sw.js) tanpa browser: lingkungan service worker ditiru,
// lalu permintaan disimulasikan saat online dan offline.
//   node tests/uji-sw.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let gagal = 0;
const ok = (k, n) => { console.log((k ? '  OK    ' : '  GAGAL ') + n); if (!k) gagal++; };

function lingkungan() {
  const handler = {};
  const simpanan = new Map(); // nama cache -> Map(url -> Response)
  const kunciUrl = (r) => (typeof r === 'string' ? new URL(r, 'http://localhost:3001').href : r.url);
  const caches = {
    async open(n) {
      if (!simpanan.has(n)) simpanan.set(n, new Map());
      const m = simpanan.get(n);
      return {
        async put(r, res) { m.set(kunciUrl(r), res); },
        async addAll(list) { for (const u of list) m.set(kunciUrl(u), new Response('isi ' + u, { status: 200 })); },
      };
    },
    async match(r, opsi = {}) {
      const tanpaQuery = (u) => u.split('?')[0];
      for (const m of simpanan.values()) {
        for (const [k, x] of m) if (k === kunciUrl(r) || (opsi.ignoreSearch && tanpaQuery(k) === tanpaQuery(kunciUrl(r)))) return x.clone();
      }
      return undefined;
    },
    async keys() { return [...simpanan.keys()]; },
    async delete(n) { return simpanan.delete(n); },
  };
  const env = {
    online: true, panggilan: [],
    fetch: async (r) => {
      env.panggilan.push(r.url);
      if (!env.online) throw new TypeError('Failed to fetch');
      return new Response('jaringan ' + r.url, { status: 200 });
    },
  };
  const self = {
    location: { origin: 'http://localhost:3001' },
    addEventListener: (t, f) => { handler[t] = f; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const ctx = vm.createContext({ self, caches, fetch: (...a) => env.fetch(...a), URL, Response, JSON, Promise, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), ctx);
  const jalankan = async (t) => { let p; handler[t]({ waitUntil: (x) => { p = x; } }); await p; };
  const minta = async (url, method = 'GET', mode = 'cors') => {
    let jawab = null;
    handler.fetch({ request: { url, method, mode }, respondWith: (p) => { jawab = p; } });
    return jawab ? await jawab : 'TIDAK_DISENTUH';
  };
  return { env, simpanan, jalankan, minta };
}

(async () => {
  const L = lingkungan();
  const W = 'http://localhost:3001', API = 'http://localhost:3000';

  console.log('\n[1] Pemasangan dan aktivasi');
  await L.jalankan('install');
  ok(['/offline', '/manifest.webmanifest', '/icons/icon-192.png'].every((u) => L.simpanan.get('jr-statis-v1').has(W + u)), 'halaman /offline, manifest, dan ikon disimpan saat pemasangan');
  L.simpanan.set('jr-api-v0', new Map()); L.simpanan.set('cache-lain', new Map());
  await L.jalankan('activate');
  ok(!L.simpanan.has('jr-api-v0') && L.simpanan.has('cache-lain'), 'aktivasi menghapus cache versi lama milik aplikasi saja');

  console.log('\n[2] Halaman (Network-First)');
  let r = await L.minta(W + '/sewa', 'GET', 'navigate');
  ok((await r.text()).startsWith('jaringan'), 'online: halaman diambil dari jaringan');
  L.env.online = false;
  r = await L.minta(W + '/sewa', 'GET', 'navigate');
  ok((await r.text()).startsWith('jaringan'), 'offline: halaman yang pernah dibuka diambil dari simpanan');
  r = await L.minta(W + '/admin/armada', 'GET', 'navigate');
  ok((await r.text()) === 'isi /offline', 'offline: halaman yang belum pernah dibuka diganti halaman /offline');
  L.env.online = true;

  console.log('\n[3] Aset statis (Cache-First)');
  const aset = W + '/_next/static/chunks/app-1a2b3c.js';
  await L.minta(aset);
  const sebelum = L.env.panggilan.length;
  L.env.online = false;
  r = await L.minta(aset);
  ok(r.status === 200 && L.env.panggilan.length === sebelum, 'aset yang sudah tersimpan langsung dari simpanan tanpa menyentuh jaringan');
  r = await L.minta(W + '/manifest.webmanifest');
  ok(r.status === 200 && L.env.panggilan.length === sebelum, 'offline: manifest dilayani dari simpanan');
  r = await L.minta(W + '/favicon.ico?favicon.117ezoe8m31dk.ico');
  ok(r !== 'TIDAK_DISENTUH' && r.status === 200, 'offline: favicon (dengan tambahan ?kode) dilayani dari simpanan');
  r = await L.minta(W + '/_next/static/chunks/belum-pernah-dibuka.js');
  ok(r.status === 504, 'offline: aset yang belum tersimpan dijawab 504, tidak membuat service worker galat');
  L.env.online = true;

  console.log('\n[4] Data API yang boleh dibaca offline (Network-First)');
  await L.minta(API + '/api/reservasi/saya');
  L.env.online = false;
  r = await L.minta(API + '/api/reservasi/saya');
  ok(r.status === 200 && (await r.text()).startsWith('jaringan'), 'offline: Sewa saya menampilkan data terakhir');
  r = await L.minta(API + '/api/motor');
  const isi = await r.json();
  ok(r.status === 503 && /offline/.test(isi.pesan), `offline tanpa simpanan: pesan jelas (${r.status})`);
  L.env.online = true;

  console.log('\n[5] Yang tidak boleh disentuh service worker');
  ok(await L.minta(API + '/api/perpanjangan', 'POST') === 'TIDAK_DISENTUH', 'POST (mengajukan perpanjangan) tidak disentuh');
  ok(await L.minta(API + '/api/reservasi', 'POST') === 'TIDAK_DISENTUH', 'POST (memesan motor) tidak disentuh');
  ok(await L.minta(API + '/api/perpanjangan/5') === 'TIDAK_DISENTUH', 'status pembayaran tidak pernah dari simpanan');
  ok(await L.minta(API + '/api/admin/sewa') === 'TIDAK_DISENTUH', 'data admin tidak disimpan');
  ok(await L.minta('https://api.sandbox.midtrans.com/v2/qris/x/qr-code') === 'TIDAK_DISENTUH', 'gambar QR Midtrans tidak disimpan');
  ok(!L.simpanan.get('jr-api-v1').has(API + '/api/perpanjangan/5'), 'simpanan API hanya berisi data yang diizinkan');

  console.log(`\n=== ${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} ===`);
  process.exit(gagal ? 1 : 0);
})();
