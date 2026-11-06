"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import { waktu } from "@/lib/format";
import NavAdmin from "@/components/NavAdmin";
import { PlatNomor, rupiah } from "@/components/motor";

// Use case: Tinjau perpanjangan bermasalah (pembayaran sudah diterima tetapi perpanjangan tidak dapat diterapkan)
function Kasus({ k, onSelesai }) {
  const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const [alasan, penanganan] = String(k.catatan_penanganan || "").split(" | Penanganan admin: ");

  async function tangani(e) {
    e.preventDefault();
    if (catatan.trim().length < 5) return setGalat("Tulis catatan penanganan, minimal 5 karakter.");
    if (!window.confirm("Tandai kasus ini sudah ditangani?")) return;
    setSibuk(true);
    setGalat("");
    try {
      const res = await api(`/api/admin/perpanjangan/${k.id_perpanjangan}/tangani`, { method: "POST", body: { catatan: catatan.trim() } });
      onSelesai(res.pesan);
    } catch (err) {
      setGalat(err.message);
      setSibuk(false);
    }
  }

  return (
    <li className="border-b-2 border-aspal/15 py-5">
      <div className="grid gap-x-6 gap-y-2 md:grid-cols-[10rem_1fr]">
        <div><PlatNomor plat={k.plat_nomor} /></div>
        <div className="text-sm">
          <p className="font-display text-xl font-bold leading-tight">{k.merek} {k.nama_model}</p>
          <p>
            <span className="text-aspal/70">Pelanggan:</span> {k.nama_lengkap}{" "}
            <a href={`https://wa.me/${k.no_whatsapp}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
              ({k.no_whatsapp})
            </a>
          </p>
          <p>
            <span className="text-aspal/70">Sudah dibayar:</span>{" "}
            <span className="font-semibold">{k.gross_amount !== null ? rupiah(k.gross_amount) : rupiah(k.biaya_perpanjangan)}</span>
            {k.settlement_time && <> pada {waktu(k.settlement_time)}</>}
          </p>
          <p><span className="text-aspal/70">Order ID:</span> {k.order_id || "-"}</p>
          <p>
            <span className="text-aspal/70">Permintaan:</span> {k.tambahan_hari} hari, dari {waktu(k.jatuh_tempo_lama)} menjadi {waktu(k.jatuh_tempo_baru)}
          </p>
          <p className="mt-1 font-bold text-rem">Alasan: {alasan}</p>
          {k.status_perpanjangan === "DITANGANI" && (
            <p className="mt-1">
              <span className="text-aspal/70">Ditangani {k.ditangani_oleh_email} pada {waktu(k.ditangani_pada)}:</span> {penanganan}
            </p>
          )}
        </div>
      </div>
      {k.status_perpanjangan === "LUNAS_PERLU_TINDAKAN" && (
        <form onSubmit={tangani} noValidate className="mt-4 md:ml-[11.5rem]">
          <label htmlFor={`catatan-${k.id_perpanjangan}`} className="block text-sm font-semibold">Catatan penanganan</label>
          <p className="text-sm text-aspal/70">Misalnya dana dikembalikan, jadwal diatur ulang, atau pelanggan dialihkan ke unit lain.</p>
          <textarea id={`catatan-${k.id_perpanjangan}`} rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)}
            className="mt-1.5 block w-full rounded-md border-2 border-garis bg-white px-3 py-2" />
          {galat && <p role="alert" className="mt-2 text-sm font-semibold text-rem">{galat}</p>}
          <button type="submit" disabled={sibuk}
            className="mt-3 rounded-md bg-marka px-4 py-2 font-bold text-aspal hover:bg-marka-tua disabled:opacity-60">
            {sibuk ? "Menyimpan…" : "Tandai sudah ditangani"}
          </button>
        </form>
      )}
    </li>
  );
}

export default function HalamanBermasalah() {
  const { siap } = useWajibLogin("ADMIN");
  const [status, setStatus] = useState("LUNAS_PERLU_TINDAKAN");
  const [data, setData] = useState(null);
  const [info, setInfo] = useState("");
  const [galat, setGalat] = useState("");

  const muat = useCallback(async (st) => {
    setData(null);
    try {
      setData((await api(`/api/admin/perpanjangan?status=${st}`)).data);
    } catch (e) {
      setGalat(e.message);
    }
  }, []);

  useEffect(() => {
    if (siap) muat(status);
  }, [siap, status, muat]);

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  return (
    <>
      <NavAdmin />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Perpanjangan bermasalah</h1>
        <p className="mt-1 text-aspal/75">Pembayaran sudah diterima, tetapi perpanjangan tidak dapat diterapkan otomatis.</p>

        <div role="tablist" aria-label="Status" className="mt-5 flex gap-2">
          {[["LUNAS_PERLU_TINDAKAN", "Perlu tindakan"], ["DITANGANI", "Sudah ditangani"]].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => { setInfo(""); setStatus(v); }}
              className={`rounded-md border-2 px-3 py-1.5 text-sm font-bold ${status === v ? "border-aspal bg-aspal text-white" : "border-aspal"}`}>
              {l}
            </button>
          ))}
        </div>

        {info && <p role="status" className="mt-4 rounded-md border-2 border-rambu bg-white p-3 text-sm font-semibold text-rambu">{info}</p>}
        {galat && <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galat}</p>}

        {data === null && !galat ? (
          <p className="mt-6 text-aspal/70">Memuat…</p>
        ) : data && data.length === 0 ? (
          <p className="mt-6">{status === "LUNAS_PERLU_TINDAKAN" ? "Tidak ada perpanjangan yang perlu tindakan." : "Belum ada kasus yang ditangani."}</p>
        ) : (
          <ul className="mt-2">
            {data.map((k) => (
              <Kasus key={k.id_perpanjangan} k={k} onSelesai={(p) => { setInfo(p); muat(status); }} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
