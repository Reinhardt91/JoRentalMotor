"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const MENU = [
  { href: "/motor", label: "Motor" },
  { href: "/sewa", label: "Sewa saya" },
];

export default function NavPelanggan() {
  const { keluar } = useAuth();
  const path = usePathname();
  return (
    <header className="bg-aspal text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <p className="font-display text-2xl font-bold">Jo Rental Motor</p>
        <nav aria-label="Menu utama" className="flex items-center gap-5">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              aria-current={path === m.href ? "page" : undefined}
              className={`py-1 font-semibold underline-offset-8 ${
                path === m.href ? "text-marka underline decoration-2" : "text-white/85 hover:text-white"
              }`}
            >
              {m.label}
            </Link>
          ))}
          <button onClick={keluar} className="py-1 font-semibold text-white/85 hover:text-white">
            Keluar
          </button>
        </nav>
      </div>
      <div className="marka-h" aria-hidden="true" />
    </header>
  );
}
