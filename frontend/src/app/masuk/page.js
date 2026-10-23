"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, berandaUntuk } from "@/lib/auth";
import { Field, Tombol, Peringatan, PanelMerek, Pemisah } from "@/components/ui";

export default function HalamanMasuk() {
  const { masuk } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");

  async function kirim(e) {
    e.preventDefault();
    setGalat("");
    setSibuk(true);
    try {
      const user = await masuk(email, password);
      router.replace(berandaUntuk(user.role));
    } catch (err) {
      setGalat(err.message);
      setSibuk(false);
    }
  }

  return (
    <main className="min-h-dvh md:grid md:grid-cols-[minmax(0,5fr)_6px_minmax(0,6fr)]">
      <PanelMerek />
      <Pemisah />
      <section className="px-6 py-10 md:flex md:items-center md:justify-center">
        <form onSubmit={kirim} className="mx-auto w-full max-w-sm space-y-5" noValidate>
          <h1 className="font-display text-4xl font-bold">Masuk</h1>
          <Peringatan judul={galat} />
          <Field label="Email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Kata sandi" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <Tombol type="submit" sibuk={sibuk}>{sibuk ? "Memeriksa…" : "Masuk"}</Tombol>
          <p className="text-sm">
            Belum punya akun?{" "}
            <Link href="/daftar" className="font-bold underline underline-offset-2">Daftar</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
