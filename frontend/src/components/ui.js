"use client";

import { useId, useState } from "react";

export function PanelMerek() {
  return (
    <aside className="bg-aspal text-white md:flex md:flex-col md:justify-center md:px-14">
      <div className="px-6 pt-10 pb-8 md:p-0">
        <p className="font-display text-5xl font-bold leading-none md:text-7xl">Jo Rental Motor</p>
        <p className="mt-4 max-w-sm text-base leading-relaxed text-white/80 md:text-lg">
          Pantau masa sewa, perpanjang, dan bayar QRIS dari satu tempat.
        </p>
      </div>
    </aside>
  );
}

export function Pemisah() {
  return (
    <>
      <div className="marka-h md:hidden" aria-hidden="true" />
      <div className="marka-v hidden md:block" aria-hidden="true" />
    </>
  );
}

export function Field({ label, hint, error, type = "text", ...props }) {
  const id = useId();
  const [tampil, setTampil] = useState(false);
  const sandi = type === "password";
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-sm text-aspal/70">{hint}</p>}
      <div className="relative mt-1.5">
        <input
          id={id}
          type={sandi && tampil ? "text" : type}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`block w-full rounded-md border-2 bg-white px-3 py-2.5 text-base ${
            error ? "border-rem" : "border-garis"
          } ${sandi ? "pr-24" : ""}`}
          {...props}
        />
        {sandi && (
          <button
            type="button"
            onClick={() => setTampil((t) => !t)}
            className="absolute inset-y-0 right-0 px-3 text-sm font-semibold underline underline-offset-2"
          >
            {tampil ? "Sembunyikan" : "Tampilkan"}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-sm font-medium text-rem">{error}</p>}
    </div>
  );
}

export function Tombol({ sibuk, children, ...props }) {
  return (
    <button
      disabled={sibuk}
      className="w-full rounded-md bg-marka px-4 py-3 text-base font-bold text-aspal hover:bg-marka-tua disabled:opacity-60"
      {...props}
    >
      {children}
    </button>
  );
}

export function Peringatan({ judul, daftar }) {
  if (!judul) return null;
  return (
    <div role="alert" className="rounded-md border-2 border-rem bg-white p-3 text-sm">
      <p className="font-bold text-rem">{judul}</p>
      {daftar?.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {daftar.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}
