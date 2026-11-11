"use client";

import { useEffect, useState } from "react";

// Mendaftarkan service worker dan menampilkan penanda saat perangkat offline.
// Service worker hanya aktif pada build produksi (npm run build lalu npm start), karena pada mode
// pengembangan ia dapat menyimpan berkas lama. Untuk mencobanya di mode pengembangan, isi
// NEXT_PUBLIC_SW_DEV=true di .env.local.
export default function PWA() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const aktif = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_DEV === "true";
    if (aktif && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const perbarui = () => setOffline(!navigator.onLine);
    perbarui();
    window.addEventListener("online", perbarui);
    window.addEventListener("offline", perbarui);
    return () => {
      window.removeEventListener("online", perbarui);
      window.removeEventListener("offline", perbarui);
    };
  }, []);

  if (!offline) return null;
  return (
    <p role="status" className="fixed inset-x-0 bottom-0 z-50 bg-aspal px-4 py-3 text-center text-sm font-semibold text-white">
      Anda sedang offline. Data yang tampil mungkin bukan yang terbaru, dan pemesanan atau pembayaran belum dapat dilakukan.
    </p>
  );
}
