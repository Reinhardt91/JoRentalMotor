"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import { waktu } from "@/lib/format";
import NavPelanggan from "@/components/NavPelanggan";
import { PlatNomor, rupiah } from "@/components/motor";
import PanelPerpanjang from "@/components/PanelPerpanjang";

// Status gabungan reservasi + sewa, dengan bentuk penanda agar tidak bergantung pada warna saja
function statusTampil(r) {
  if (r.status_sewa === "AKTIF") return { teks: "Sedang berjalan", kelas: "bg-rambu", warna: "text-rambu" };
  if (r.status_sewa === "TERLAMBAT") return { teks: "Terlambat dikembalikan", kelas: "bg-rem", warna: "text-rem" };
  if (r.status_sewa === "SELESAI") return { teks: "Selesai", kelas: "border-2 border-garis", warna: "text-aspal/70" };
  return {
    MENUNGGU: { teks: "Menunggu konfirmasi admin", kelas: "border-2 border-aspal", warna: "text-aspal" },
    DIKONFIRMASI: { teks: "Dikonfirmasi, menunggu serah terima", kelas: "bg-aspal", warna: "text-aspal" },
    DIBATALKAN: { teks: "Dibatalkan", kelas: "border-2 border-garis", warna: "text-aspal/70" },
    SELESAI: { teks: "Selesai", kelas: "border-2 border-garis", warna: "text-aspal/70" },
  }[r.status_reservasi];
}

function kelompok(r) {
  if (r.status_sewa === "AKTIF" || r.status_sewa === "TERLAMBAT") return "berjalan";
  if (!r.status_sewa && ["MENUNGGU", "DIKONFIRMASI"].includes(r.status_reservasi)) return "datang";
  return "riwayat";
}

function Kartu({ r, onBatal, sibuk, terbuka, onBuka, onTutup, onBerubah }) {
  const st = statusTampil(r);
  return (
    <li className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-5 md:grid-cols-[11rem_1fr_15rem]">
      <div><PlatNomor plat={r.plat_nomor} /></div>
      <div>
        <p className="font-display text-2xl font-bold leading-tight">{r.merek} {r.nama_model}</p>
        <p className="mt-1 text-sm"><span className="text-aspal/70">Ambil:</span> {waktu(r.tanggal_mulai)}</p>
        <p className="text-sm"><span className="text-aspal/70">Kembali:</span> {waktu(r.tanggal_selesai)}</p>
        <p className="text-sm text-aspal/75">
          {r.metode_serah === "ANTAR" ? `Diantar ke ${r.lokasi_serah}` : "Ambil sendiri di lokasi rental"}
        </p>
      </div>
      <div className="md:text-right">
        <p className={`flex items-center gap-2 font-bold md:justify-end ${st.warna}`}>
          <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${st.kelas}`} />
          {st.teks}
        </p>
        <p className="mt-1 font-semibold">{rupiah(r.total_biaya)}</p>
        {["AKTIF", "TERLAMBAT"].includes(r.status_sewa) && !terbuka && (
          <button type="button" onClick={onBuka}
            className="mt-2 rounded-md bg-marka px-4 py-2 text-sm font-bold text-aspal hover:bg-marka-tua">
            Perpanjang
          </button>
        )}
        {r.status_reservasi === "MENUNGGU" && !r.status_sewa && (
          <button type="button" disabled={sibuk} onClick={() => onBatal(r)}
            className="mt-2 rounded-md border-2 border-aspal px-3 py-1.5 text-sm font-bold disabled:opacity-60">
            {sibuk ? "Membatalkan…" : "Batalkan reservasi"}
          </button>
        )}
      </div>
      {terbuka && (
        <div className="md:col-span-3">
          <PanelPerpanjang idSewa={r.id_sewa} onTutup={onTutup} onBerubah={onBerubah} />
        </div>
      )}
    </li>
  );
}

export default function HalamanSewa() {
  const { user, siap } = useWajibLogin("PELANGGAN");
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [info, setInfo] = useState("");
  const [batalId, setBatalId] = useState(null);
  const [panelSewa, setPanelSewa] = useState(null);

  const muat = useCallback(async () => {
    try {
      const res = await api("/api/reservasi/saya");
      setData(res.data);
    } catch (e) {
      setGalat(e.message);
    }
  }, []);

  useEffect(() => {
    if (!siap) return;
    try {
      const f = sessionStorage.getItem("jo_flash");
      if (f) { setInfo(f); sessionStorage.removeItem("jo_flash"); }
    } catch {}
    muat();
  }, [siap, muat]);

  async function batal(r) {
    if (!window.confirm(`Batalkan reservasi ${r.merek} ${r.nama_model} (${r.plat_nomor})?`)) return;
    setBatalId(r.id_reservasi);
    setGalat("");
    try {
      const res = await api(`/api/reservasi/${r.id_reservasi}/batal`, { method: "POST" });
      setInfo(res.pesan);
      await muat();
    } catch (e) {
      setGalat(e.message);
    } finally {
      setBatalId(null);
    }
  }

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  const grup = { berjalan: [], datang: [], riwayat: [] };
  (data || []).forEach((r) => grup[kelompok(r)].push(r));
  const BAGIAN = [
    ["berjalan", "Sedang berjalan"],
    ["datang", "Akan datang"],
    ["riwayat", "Riwayat"],
  ];

  return (
    <>
      <NavPelanggan />
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Sewa saya</h1>
        <p className="mt-1 text-aspal/75">Masuk sebagai {user.nama_lengkap}.</p>

        {info && (
          <p role="status" className="mt-4 rounded-md border-2 border-rambu bg-white p-3 text-sm font-semibold text-rambu">{info}</p>
        )}
        {galat && (
          <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galat}</p>
        )}

        {data === null && !galat && <p className="mt-8 text-aspal/70">Memuat data sewa…</p>}

        {data && data.length === 0 && (
          <p className="mt-6">
            Belum ada reservasi.{" "}
            <Link href="/motor" className="font-bold underline underline-offset-2">Pilih motor</Link> untuk memesan.
          </p>
        )}

        {data && data.length > 0 && BAGIAN.map(([kunci, judul]) =>
          grup[kunci].length > 0 && (
            <section key={kunci} aria-labelledby={`h-${kunci}`} className="mt-8">
              <h2 id={`h-${kunci}`} className="font-display text-2xl font-bold">{judul}</h2>
              <ul>
                {grup[kunci].map((r) => (
                  <Kartu key={r.id_reservasi} r={r} onBatal={batal} sibuk={batalId === r.id_reservasi}
                    terbuka={panelSewa === r.id_sewa && !!r.id_sewa} onBuka={() => setPanelSewa(r.id_sewa)}
                    onTutup={() => setPanelSewa(null)} onBerubah={muat} />
                ))}
              </ul>
            </section>
          )
        )}
      </main>
    </>
  );
}
