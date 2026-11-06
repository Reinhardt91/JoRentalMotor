"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import { waktu } from "@/lib/format";
import NavAdmin from "@/components/NavAdmin";
import { PlatNomor } from "@/components/motor";

// Use case: Lihat log notifikasi gagal
const JENIS = {
  PENGINGAT_H1: "Pengingat H-1",
  PENGINGAT_H0: "Pengingat H-0",
  KONFIRMASI_PERPANJANGAN: "Konfirmasi perpanjangan",
};
const JOB = {
  pengingat_h1: "Pengingat H-1 (17.00)",
  pengingat_h0: "Pengingat H-0 (08.00)",
  pengirim_whatsapp: "Pengirim WhatsApp",
  rekonsiliasi_pembayaran: "Rekonsiliasi pembayaran",
};
const TAB = [["GAGAL", "Gagal"], ["PENDING", "Menunggu"], ["TERKIRIM", "Terkirim"]];

function Angka({ label, nilai, keterangan }) {
  return (
    <div className="rounded-md border-2 border-aspal bg-white p-4">
      <p className="text-sm font-semibold text-aspal/75">{label}</p>
      <p className="font-display text-4xl font-bold">{nilai}</p>
      {keterangan && <p className="text-xs text-aspal/70">{keterangan}</p>}
    </div>
  );
}

function Baris({ n }) {
  return (
    <li className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-4 md:grid-cols-[10rem_1fr]">
      <div><PlatNomor plat={n.plat_nomor} /></div>
      <div className="text-sm">
        <p className="font-display text-xl font-bold leading-tight">{JENIS[n.jenis_notifikasi] || n.jenis_notifikasi}</p>
        <p>
          <span className="text-aspal/70">Kepada:</span> {n.nama_lengkap}{" "}
          <a href={`https://wa.me/${n.no_tujuan}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            ({n.no_tujuan})
          </a>
        </p>
        <p>
          <span className="text-aspal/70">{n.status_kirim === "TERKIRIM" ? "Dikirim:" : "Dibuat:"}</span>{" "}
          {waktu(n.status_kirim === "TERKIRIM" ? n.dikirim_pada : n.created_at)}
        </p>
        <p><span className="text-aspal/70">Percobaan:</span> {n.jumlah_percobaan} dari 3</p>
        {n.status_kirim === "PENDING" && n.coba_lagi_pada && (
          <p><span className="text-aspal/70">Dicoba lagi:</span> {waktu(n.coba_lagi_pada)}</p>
        )}
        {n.error_message && n.status_kirim !== "TERKIRIM" && (
          <p className="font-bold text-rem">Alasan: {n.error_message}</p>
        )}
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold underline underline-offset-2">Lihat isi pesan</summary>
          <p className="mt-1 rounded-md bg-white p-3">{n.isi_pesan}</p>
        </details>
      </div>
    </li>
  );
}

export default function HalamanNotifikasi() {
  const { siap } = useWajibLogin("ADMIN");
  const [status, setStatus] = useState("GAGAL");
  const [data, setData] = useState(null);
  const [ringkasan, setRingkasan] = useState(null);
  const [galat, setGalat] = useState("");

  const muat = useCallback(async (st) => {
    setData(null);
    try {
      const [a, b] = await Promise.all([api(`/api/admin/notifikasi?status=${st}`), api("/api/admin/notifikasi/ringkasan")]);
      setData(a.data);
      setRingkasan(b.data);
    } catch (e) {
      setGalat(e.message);
    }
  }, []);

  useEffect(() => {
    if (siap) muat(status);
  }, [siap, status, muat]);

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  const k = ringkasan;
  return (
    <>
      <NavAdmin />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Log notifikasi</h1>

        {k && k.mode_pengiriman === "simulasi" && (
          <p className="mt-4 rounded-md border-2 border-marka-tua bg-white p-3 text-sm font-semibold">
            Mode simulasi: pesan diproses lengkap, tetapi tidak dikirim ke WhatsApp sungguhan.
          </p>
        )}
        {galat && <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galat}</p>}

        {k && (
          <section aria-label="Ringkasan" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Angka label="Menunggu dikirim" nilai={k.menunggu} />
            <Angka label="Terkirim" nilai={k.terkirim_7_hari} keterangan="7 hari terakhir" />
            <Angka label="Gagal" nilai={k.gagal_7_hari} keterangan="7 hari terakhir" />
            <Angka label="Tingkat keberhasilan" keterangan="7 hari terakhir"
              nilai={k.tingkat_keberhasilan_7_hari === null ? "-" : `${String(k.tingkat_keberhasilan_7_hari).replace(".", ",")}%`} />
          </section>
        )}

        <div role="tablist" aria-label="Status pesan" className="mt-8 flex gap-2">
          {TAB.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => setStatus(v)}
              className={`rounded-md border-2 px-3 py-1.5 text-sm font-bold ${status === v ? "border-aspal bg-aspal text-white" : "border-aspal"}`}>
              {l}
            </button>
          ))}
        </div>

        {data === null && !galat ? (
          <p className="mt-6 text-aspal/70">Memuat…</p>
        ) : data && data.length === 0 ? (
          <p className="mt-6">
            {status === "GAGAL" ? "Tidak ada pesan yang gagal." : status === "PENDING" ? "Tidak ada pesan yang menunggu." : "Belum ada pesan terkirim."}
          </p>
        ) : (
          <ul className="mt-2">{data.map((n) => <Baris key={n.id_notifikasi} n={n} />)}</ul>
        )}

        {k && (
          <section aria-labelledby="h-job" className="mt-10">
            <h2 id="h-job" className="font-display text-2xl font-bold">Eksekusi scheduler terakhir</h2>
            {k.eksekusi_terakhir.length === 0 ? (
              <p className="mt-2 text-aspal/70">Belum ada eksekusi tercatat.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b-2 border-aspal">
                      <th className="py-2 pr-4">Job</th><th className="py-2 pr-4">Mulai</th><th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Diproses</th><th className="py-2 pr-4">Berhasil</th><th className="py-2">Gagal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.eksekusi_terakhir.map((j) => (
                      <tr key={j.nama_job} className="border-b-2 border-aspal/15">
                        <td className="py-2 pr-4 font-semibold">{JOB[j.nama_job] || j.nama_job}</td>
                        <td className="py-2 pr-4">{waktu(j.waktu_mulai)}</td>
                        <td className={`py-2 pr-4 font-bold ${j.status_job === "GAGAL" ? "text-rem" : ""}`}>{j.status_job}</td>
                        <td className="py-2 pr-4">{j.jumlah_diproses}</td>
                        <td className="py-2 pr-4">{j.jumlah_berhasil}</td>
                        <td className="py-2">{j.jumlah_gagal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
