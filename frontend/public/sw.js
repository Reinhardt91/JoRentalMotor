// Service worker Jo Rental Motor (PWA)
// Strategi:
//   Cache-First   : aset statis (berkas /_next/static, ikon) yang namanya berubah bila isinya berubah
//   Network-First : halaman, dengan cadangan halaman tersimpan atau halaman /offline
//   Network-First : data API yang aman dibaca saat offline (daftar motor, Sewa saya)
// Tidak pernah disimpan: permintaan selain GET, pembayaran, data admin, dan API lainnya.
const VERSI = 'v1';
const STATIS = `jr-statis-${VERSI}`;
const HALAMAN = `jr-halaman-${VERSI}`;
const API = `jr-api-${VERSI}`;
const PRECACHE = ['/offline', '/manifest.webmanifest', '/favicon.ico', '/icons/icon-192.png', '/icons/icon-512.png'];
const API_BOLEH = [/^\/api\/motor$/, /^\/api\/reservasi\/saya$/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIS).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('jr-') && !k.endsWith(`-${VERSI}`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function strategi(req) {
  if (req.method !== 'GET') return null;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) return 'statis';
    if (url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/favicon.ico')) return 'statis';
    if (req.mode === 'navigate') return 'halaman';
    return null;
  }
  if (API_BOLEH.some((r) => r.test(url.pathname))) return 'api';
  return null;
}

async function cacheFirst(req) {
  // ignoreSearch: berkas seperti favicon diminta dengan tambahan ?kode, tetapi isinya sama
  const ada = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
  if (ada) return ada;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(STATIS)).put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' }); // belum tersimpan dan sedang offline
  }
}

async function networkFirst(req, namaCache, cadangan) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(namaCache)).put(req, res.clone());
    return res;
  } catch {
    const ada = await caches.match(req);
    if (ada) return ada;
    return cadangan();
  }
}

const offlineHalaman = async () => (await caches.match('/offline')) ||
  new Response('Anda sedang offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const offlineApi = () => new Response(
  JSON.stringify({ pesan: 'Anda sedang offline dan data ini belum pernah dibuka sebelumnya. Sambungkan internet lalu coba lagi.' }),
  { status: 503, headers: { 'Content-Type': 'application/json' } });

self.addEventListener('fetch', (e) => {
  const s = strategi(e.request);
  if (s === 'statis') e.respondWith(cacheFirst(e.request));
  else if (s === 'halaman') e.respondWith(networkFirst(e.request, HALAMAN, offlineHalaman));
  else if (s === 'api') e.respondWith(networkFirst(e.request, API, offlineApi));
  // selain itu: tidak disentuh, browser memproses seperti biasa
});
