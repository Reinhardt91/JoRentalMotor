"use client";

import { useAuth, useWajibLogin } from "@/lib/auth";

// Sementara: halaman sambutan. Dasbor admin dibuat pada tahap berikutnya.
export default function HalamanAdmin() {
  const { keluar } = useAuth();
  const { user, siap } = useWajibLogin("ADMIN");
  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;
  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Dasbor admin</h1>
      <p className="mt-3">Masuk sebagai {user.email}. Sewa aktif dan verifikasi perpanjangan akan tampil di sini.</p>
      <button onClick={keluar} className="mt-8 rounded-md border-2 border-aspal px-4 py-2 font-bold">Keluar</button>
    </main>
  );
}
