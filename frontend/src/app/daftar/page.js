"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, berandaUntuk } from "@/lib/auth";
import { Field, Tombol, Peringatan, PanelMerek, Pemisah } from "@/components/ui";

export default function HalamanDaftar() {
  const { daftar } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({
    nama_lengkap: "", email: "", no_whatsapp: "", no_ktp: "", password: "", asal_daerah: "",
  });
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState({ judul: "", daftar: [] });
  const [salah, setSalah] = useState({});

  const ubah = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  function periksa() {
    const s = {};
    if (f.nama_lengkap.trim().length < 2) s.nama_lengkap = "Isi nama sesuai KTP.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) s.email = "Format email belum benar, contoh: nama@email.com.";
    if (f.no_whatsapp.replace(/\D/g, "").length < 9) s.no_whatsapp = "Isi nomor WhatsApp yang aktif, contoh: 081234567890.";
    if (!/^\d{16}$/.test(f.no_ktp.trim())) s.no_ktp = "Nomor KTP harus 16 digit angka.";
    if (f.password.length < 8) s.password = "Kata sandi minimal 8 karakter.";
    return s;
  }

  async function kirim(e) {
    e.preventDefault();
    setGalat({ judul: "", daftar: [] });
    const s = periksa();
    setSalah(s);
    if (Object.keys(s).length) return;

    setSibuk(true);
    try {
      const user = await daftar({
        ...f,
        email: f.email.trim(),
        nama_lengkap: f.nama_lengkap.trim(),
        no_ktp: f.no_ktp.trim(),
        asal_daerah: f.asal_daerah.trim() || undefined,
      });
      router.replace(berandaUntuk(user.role));
    } catch (err) {
      setGalat({ judul: err.message, daftar: err.galat });
      setSibuk(false);
    }
  }

  return (
    <main className="min-h-dvh md:grid md:grid-cols-[minmax(0,5fr)_6px_minmax(0,6fr)]">
      <PanelMerek />
      <Pemisah />
      <section className="px-6 py-10 md:flex md:items-center md:justify-center">
        <form onSubmit={kirim} className="mx-auto w-full max-w-sm space-y-5" noValidate>
          <h1 className="font-display text-4xl font-bold">Buat akun</h1>
          <Peringatan judul={galat.judul} daftar={galat.daftar} />
          <Field label="Nama lengkap" autoComplete="name" error={salah.nama_lengkap}
            value={f.nama_lengkap} onChange={ubah("nama_lengkap")} />
          <Field label="Email" type="email" autoComplete="email" error={salah.email}
            value={f.email} onChange={ubah("email")} />
          <Field label="Nomor WhatsApp" type="tel" inputMode="tel" autoComplete="tel"
            hint="Pengingat jatuh tempo dikirim ke nomor ini."
            error={salah.no_whatsapp} value={f.no_whatsapp} onChange={ubah("no_whatsapp")} />
          <Field label="Nomor KTP" inputMode="numeric" maxLength={16}
            error={salah.no_ktp} value={f.no_ktp} onChange={ubah("no_ktp")} />
          <Field label="Kata sandi" type="password" autoComplete="new-password"
            hint="Minimal 8 karakter." error={salah.password}
            value={f.password} onChange={ubah("password")} />
          <Field label="Asal daerah (boleh dikosongkan)" autoComplete="address-level2"
            value={f.asal_daerah} onChange={ubah("asal_daerah")} />
          <Tombol type="submit" sibuk={sibuk}>{sibuk ? "Membuat akun…" : "Buat akun"}</Tombol>
          <p className="text-sm">
            Sudah punya akun?{" "}
            <Link href="/masuk" className="font-bold underline underline-offset-2">Masuk</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
