"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import { waktu, tanggal } from "@/lib/format";
import NavAdmin from "@/components/NavAdmin";
import { PlatNomor, rupiah } from "@/components/motor";

function Tombol({ utama, children, ...props }) {
  return (
    <button type="button" {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-bold disabled:opacity-60 ${
        utama ? "bg-marka text-aspal hover:bg-marka-tua" : "border-2 border-aspal"
      }`}>
      {children}
    </button>
  );
}

function Baris({ plat, judul, children, aksi }) {
  return (
    <li className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-4 md:grid-cols-[10rem_1fr_auto] md:items-center">
      <div><PlatNomor plat={plat} /></div>
      <div className="text-sm">
        <p className="font-display text-xl font-bold leading-tight">{judul}</p>
        {children}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">{aksi}</div>
    </li>
  );
}

function Bagian({ id, judul, jumlah, kosong, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="font-display text-2xl font-bold">
        {judul} <span className="text-aspal/60">({jumlah})</span>
      </h2>
      {jumlah === 0 ? <p className="mt-2 text-aspal/70">{kosong}</p> : <ul>{children}</ul>}
    </section>
  );
}

export default function HalamanAdmin() {
  const { siap } = useWajibLogin("ADMIN");
  const [menunggu, setMenunggu] = useState(null);
  const [terkonfirmasi, setTerkonfirmasi] = useState([]);
  const [sewa, setSewa] = useState([]);
  const [info, setInfo] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState("");

  const muat = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([
        api("/api/admin/reservasi?status=MENUNGGU"),
        api("/api/admin/reservasi?status=DIKONFIRMASI"),
        api("/api/admin/sewa"),
      ]);
      setMenunggu(a.data);
      setTerkonfirmasi(b.data.filter((r) => !r.id_sewa));
      setSewa(c.data);
    } catch (e) {
      setGalat(e.message);
    }
  }, []);

  useEffect(() => {
    if (siap) muat();
  }, [siap, muat]);

  async function aksi(kunci, konfirmasi, jalan) {
    if (konfirmasi && !window.confirm(konfirmasi)) return;
    setSibuk(kunci);
    setInfo("");
    setGalat("");
    try {
      const res = await jalan();
      setInfo(res.pesan);
    } catch (e) {
      setGalat(e.message);
    } finally {
      setSibuk("");
      await muat(); // selalu muat ulang agar data dan version terbaru terlihat
    }
  }

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  const pelanggan = (r) => (
    <p><span className="text-aspal/70">Pelanggan:</span> {r.nama_lengkap} ({r.no_whatsapp})</p>
  );
  const serah = (r) => (
    <p className="text-aspal/75">{r.metode_serah === "ANTAR" ? `Diantar ke ${r.lokasi_serah}` : "Ambil sendiri di lokasi rental"}</p>
  );

  return (
    <>
      <NavAdmin />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Dasbor admin</h1>

        {info && <p role="status" className="mt-4 rounded-md border-2 border-rambu bg-white p-3 text-sm font-semibold text-rambu">{info}</p>}
        {galat && <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galat}</p>}

        {menunggu === null && !galat ? (
          <p className="mt-8 text-aspal/70">Memuat data…</p>
        ) : (
          <>
            <Bagian id="h-sewa" judul="Sewa berjalan" jumlah={sewa.length} kosong="Tidak ada sewa yang sedang berjalan.">
              {sewa.map((s) => (
                <Baris key={s.id_sewa} plat={s.plat_nomor} judul={`${s.merek} ${s.nama_model}`}
                  aksi={
                    <Tombol utama disabled={sibuk === `akhiri-${s.id_sewa}`}
                      onClick={() => aksi(`akhiri-${s.id_sewa}`,
                        `Motor ${s.plat_nomor} sudah dikembalikan oleh ${s.nama_lengkap}? Sewa akan diakhiri.`,
                        () => api(`/api/admin/sewa/${s.id_sewa}/akhiri`, { method: "POST", body: { version: s.version } }))}>
                      {sibuk === `akhiri-${s.id_sewa}` ? "Memproses…" : "Akhiri sewa"}
                    </Tombol>
                  }>
                  {pelanggan(s)}
                  <p><span className="text-aspal/70">Jatuh tempo:</span> <span className="font-semibold">{waktu(s.jatuh_tempo)}</span></p>
                  {s.lewat_jatuh_tempo ? (
                    <p className="font-bold text-rem">Lewat jatuh tempo, motor belum dikembalikan</p>
                  ) : s.jatuh_tempo_hari_ini ? (
                    <p className="font-bold">Jatuh tempo hari ini</p>
                  ) : null}
                </Baris>
              ))}
            </Bagian>

            <Bagian id="h-serah" judul="Siap diserahkan" jumlah={terkonfirmasi.length} kosong="Tidak ada reservasi terkonfirmasi yang menunggu serah terima.">
              {terkonfirmasi.map((r) => (
                <Baris key={r.id_reservasi} plat={r.plat_nomor} judul={`${r.merek} ${r.nama_model}`}
                  aksi={
                    <>
                      <Tombol utama disabled={!r.bisa_diserahkan || sibuk === `mulai-${r.id_reservasi}`}
                        onClick={() => aksi(`mulai-${r.id_reservasi}`,
                          `Serahkan ${r.plat_nomor} kepada ${r.nama_lengkap} sekarang? Sewa akan dimulai.`,
                          () => api(`/api/admin/reservasi/${r.id_reservasi}/mulai-sewa`, { method: "POST" }))}>
                        {sibuk === `mulai-${r.id_reservasi}` ? "Memproses…" : "Mulai sewa"}
                      </Tombol>
                      <Tombol disabled={sibuk === `batal-${r.id_reservasi}`}
                        onClick={() => aksi(`batal-${r.id_reservasi}`, `Batalkan reservasi ${r.nama_lengkap} untuk ${r.plat_nomor}?`,
                          () => api(`/api/admin/reservasi/${r.id_reservasi}/batalkan`, { method: "POST" }))}>
                        Batalkan
                      </Tombol>
                    </>
                  }>
                  {pelanggan(r)}
                  <p><span className="text-aspal/70">Ambil:</span> {waktu(r.tanggal_mulai)}</p>
                  <p><span className="text-aspal/70">Kembali:</span> {waktu(r.tanggal_selesai)}</p>
                  {serah(r)}
                  {!r.bisa_diserahkan && (
                    <p className="text-aspal/75">Serah terima dapat dilakukan mulai {tanggal(r.tanggal_mulai)}.</p>
                  )}
                </Baris>
              ))}
            </Bagian>

            <Bagian id="h-tunggu" judul="Reservasi menunggu konfirmasi" jumlah={menunggu.length} kosong="Tidak ada reservasi baru.">
              {menunggu.map((r) => (
                <Baris key={r.id_reservasi} plat={r.plat_nomor} judul={`${r.merek} ${r.nama_model}`}
                  aksi={
                    <>
                      <Tombol utama disabled={sibuk === `konf-${r.id_reservasi}`}
                        onClick={() => aksi(`konf-${r.id_reservasi}`, null,
                          () => api(`/api/admin/reservasi/${r.id_reservasi}/konfirmasi`, { method: "POST" }))}>
                        {sibuk === `konf-${r.id_reservasi}` ? "Memproses…" : "Konfirmasi"}
                      </Tombol>
                      <Tombol disabled={sibuk === `tolak-${r.id_reservasi}`}
                        onClick={() => aksi(`tolak-${r.id_reservasi}`, `Tolak reservasi ${r.nama_lengkap} untuk ${r.plat_nomor}?`,
                          () => api(`/api/admin/reservasi/${r.id_reservasi}/batalkan`, { method: "POST" }))}>
                        Tolak
                      </Tombol>
                    </>
                  }>
                  {pelanggan(r)}
                  <p><span className="text-aspal/70">Ambil:</span> {waktu(r.tanggal_mulai)}</p>
                  <p><span className="text-aspal/70">Kembali:</span> {waktu(r.tanggal_selesai)}</p>
                  {serah(r)}
                  <p className="font-semibold">{rupiah(r.total_biaya)}</p>
                </Baris>
              ))}
            </Bagian>
          </>
        )}
      </main>
    </>
  );
}
