"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, berandaUntuk } from "@/lib/auth";

// Pintu masuk: arahkan ke halaman masuk atau ke beranda sesuai peran
export default function Page() {
  const { user, status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "keluar") router.replace("/masuk");
    if (status === "masuk") router.replace(berandaUntuk(user.role));
  }, [status, user, router]);
  return <p className="p-6 text-aspal/70">Memuat…</p>;
}
