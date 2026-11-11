// Halaman cadangan saat offline (disimpan service worker sejak pemasangan)
export const metadata = { title: "Offline | Jo Rental Motor" };

export default function HalamanOffline() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <p className="font-display text-2xl font-bold text-aspal/70">Jo Rental Motor</p>
      <h1 className="mt-2 font-display text-4xl font-bold">Anda sedang offline</h1>
      <p className="mt-3">
        Halaman ini belum tersimpan di perangkat. Sambungkan internet, lalu buka kembali aplikasi.
        Halaman yang pernah dibuka, seperti daftar motor dan Sewa saya, tetap bisa dilihat saat offline.
      </p>
      <p className="mt-2 text-sm text-aspal/75">Pemesanan, perpanjangan, dan pembayaran memerlukan koneksi internet.</p>
      <a href="/" className="mt-6 self-start rounded-md bg-marka px-4 py-2.5 font-bold text-aspal hover:bg-marka-tua">Coba lagi</a>
    </main>
  );
}
