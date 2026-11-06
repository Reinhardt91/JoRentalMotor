"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import NavAdmin from "@/components/NavAdmin";
import { PlatNomor, rupiah } from "@/components/motor";

// Use case: Kelola armada motor
const KONDISI = { SIAP: "Siap disewa", PERBAIKAN: "Dalam perbaikan", TIDAK_TERSEDIA: "Tidak tersedia" };
const TRANSMISI = { MATIC: "Matic", MANUAL: "Manual", KOPLING: "Kopling" };
const kotak = "rounded-md border-2 border-garis bg-white px-3 py-2";
const tombolUtama = "rounded-md bg-marka px-4 py-2 font-bold text-aspal hover:bg-marka-tua disabled:opacity-60";

function Unit({ m, onPesan }) {
  const [kondisi, setKondisi] = useState(m.kondisi_unit);
  const [sibuk, setSibuk] = useState(false);
  async function simpan() {
    setSibuk(true);
    try {
      const res = await api(`/api/admin/motor/${m.id_motor}`, { method: "PATCH", body: { kondisi_unit: kondisi } });
      onPesan({ info: res.pesan, peringatan: res.peringatan });
    } catch (e) {
      onPesan({ galat: e.message });
    } finally {
      setSibuk(false);
    }
  }
  return (
    <li className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-4 md:grid-cols-[10rem_1fr_auto] md:items-center">
      <div><PlatNomor plat={m.plat_nomor} /></div>
      <div className="text-sm">
        <p className="font-display text-xl font-bold leading-tight">{m.merek} {m.nama_model}</p>
        <p className="text-aspal/75">{[m.warna, m.tahun_produksi && `tahun ${m.tahun_produksi}`].filter(Boolean).join(", ") || "-"}</p>
        {m.sedang_disewa && <p className="font-semibold">Sedang disewa</p>}
        {m.reservasi_mendatang > 0 && <p className="font-semibold">{m.reservasi_mendatang} reservasi mendatang</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`kondisi-${m.id_motor}`} className="sr-only">Kondisi {m.plat_nomor}</label>
        <select id={`kondisi-${m.id_motor}`} value={kondisi} onChange={(e) => setKondisi(e.target.value)} className={kotak}>
          {Object.entries(KONDISI).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" onClick={simpan} disabled={sibuk || kondisi === m.kondisi_unit}
          className="rounded-md border-2 border-aspal px-3 py-2 text-sm font-bold disabled:opacity-40">
          {sibuk ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </li>
  );
}

function BarisTipe({ t, onPesan }) {
  const [harian, setHarian] = useState(String(t.harga_harian));
  const [mingguan, setMingguan] = useState(t.harga_mingguan === null ? "" : String(t.harga_mingguan));
  const berubah = harian !== String(t.harga_harian) || mingguan !== (t.harga_mingguan === null ? "" : String(t.harga_mingguan));
  async function simpan() {
    try {
      const res = await api(`/api/admin/tipe-motor/${t.id_tipe}`, { method: "PATCH", body: { harga_harian: harian, harga_mingguan: mingguan } });
      onPesan({ info: res.pesan });
    } catch (e) {
      onPesan({ galat: e.galat?.length ? e.galat.join(" ") : e.message });
    }
  }
  return (
    <tr className="border-b-2 border-aspal/15">
      <td className="py-3 pr-4 font-semibold">{t.merek} {t.nama_model}</td>
      <td className="py-3 pr-4 text-sm">{TRANSMISI[t.jenis_transmisi]}, {t.kapasitas_cc} cc</td>
      <td className="py-3 pr-4 text-sm">{t.jumlah_unit}</td>
      <td className="py-3 pr-4">
        <label className="sr-only" htmlFor={`harian-${t.id_tipe}`}>Harga harian {t.merek} {t.nama_model}</label>
        <input id={`harian-${t.id_tipe}`} inputMode="numeric" value={harian} onChange={(e) => setHarian(e.target.value.replace(/\D/g, ""))} className={`${kotak} w-28`} />
      </td>
      <td className="py-3 pr-4">
        <label className="sr-only" htmlFor={`mingguan-${t.id_tipe}`}>Harga mingguan {t.merek} {t.nama_model}</label>
        <input id={`mingguan-${t.id_tipe}`} inputMode="numeric" value={mingguan} placeholder="kosong" onChange={(e) => setMingguan(e.target.value.replace(/\D/g, ""))} className={`${kotak} w-28`} />
      </td>
      <td className="py-3">
        <button type="button" onClick={simpan} disabled={!berubah} className="rounded-md border-2 border-aspal px-3 py-2 text-sm font-bold disabled:opacity-40">Simpan</button>
      </td>
    </tr>
  );
}

export default function HalamanArmada() {
  const { siap } = useWajibLogin("ADMIN");
  const [data, setData] = useState(null);
  const [pesan, setPesan] = useState({});
  const [unitBaru, setUnitBaru] = useState({ id_tipe: "", plat_nomor: "", warna: "", tahun_produksi: "" });
  const [tipeBaru, setTipeBaru] = useState({ merek: "", nama_model: "", jenis_transmisi: "MATIC", kapasitas_cc: "", harga_harian: "", harga_mingguan: "" });

  const muat = useCallback(async () => {
    try {
      setData((await api("/api/admin/armada")).data);
    } catch (e) {
      setPesan({ galat: e.message });
    }
  }, []);

  useEffect(() => {
    if (siap) muat();
  }, [siap, muat]);

  const lapor = useCallback((p) => { setPesan(p); muat(); }, [muat]);

  async function tambah(e, url, isi, kosongkan) {
    e.preventDefault();
    try {
      const res = await api(url, { method: "POST", body: isi });
      kosongkan();
      lapor({ info: res.pesan });
    } catch (err) {
      setPesan({ galat: err.galat?.length ? err.galat.join(" ") : err.message });
    }
  }

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  return (
    <>
      <NavAdmin />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Armada</h1>

        {pesan.info && <p role="status" className="mt-4 rounded-md border-2 border-rambu bg-white p-3 text-sm font-semibold text-rambu">{pesan.info}</p>}
        {pesan.peringatan && <p role="alert" className="mt-2 rounded-md border-2 border-marka-tua bg-white p-3 text-sm font-semibold">{pesan.peringatan}</p>}
        {pesan.galat && <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{pesan.galat}</p>}

        {!data ? <p className="mt-6 text-aspal/70">Memuat…</p> : (
          <>
            <section aria-labelledby="h-unit" className="mt-8">
              <h2 id="h-unit" className="font-display text-2xl font-bold">Unit motor <span className="text-aspal/60">({data.motor.length})</span></h2>
              <p className="text-sm text-aspal/75">Ketersediaan per tanggal dihitung otomatis dari jadwal. Di sini cukup atur kondisi fisik unit.</p>
              <ul>{data.motor.map((m) => <Unit key={`${m.id_motor}-${m.kondisi_unit}`} m={m} onPesan={lapor} />)}</ul>

              <form onSubmit={(e) => tambah(e, "/api/admin/motor", unitBaru, () => setUnitBaru({ id_tipe: "", plat_nomor: "", warna: "", tahun_produksi: "" }))}
                noValidate className="mt-5 rounded-md border-2 border-aspal bg-white p-4">
                <h3 className="font-display text-xl font-bold">Tambah unit</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <label className="text-sm font-semibold">Tipe
                    <select value={unitBaru.id_tipe} onChange={(e) => setUnitBaru({ ...unitBaru, id_tipe: e.target.value })} className={`${kotak} mt-1 block w-full font-normal`}>
                      <option value="">Pilih tipe</option>
                      {data.tipe.map((t) => <option key={t.id_tipe} value={t.id_tipe}>{t.merek} {t.nama_model}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Plat nomor
                    <input value={unitBaru.plat_nomor} placeholder="DB 1234 JR" onChange={(e) => setUnitBaru({ ...unitBaru, plat_nomor: e.target.value })} className={`${kotak} mt-1 block w-full font-normal`} />
                  </label>
                  <label className="text-sm font-semibold">Warna
                    <input value={unitBaru.warna} onChange={(e) => setUnitBaru({ ...unitBaru, warna: e.target.value })} className={`${kotak} mt-1 block w-full font-normal`} />
                  </label>
                  <label className="text-sm font-semibold">Tahun
                    <input inputMode="numeric" value={unitBaru.tahun_produksi} onChange={(e) => setUnitBaru({ ...unitBaru, tahun_produksi: e.target.value.replace(/\D/g, "") })} className={`${kotak} mt-1 block w-full font-normal`} />
                  </label>
                </div>
                <button type="submit" className={`${tombolUtama} mt-4`}>Tambah unit</button>
              </form>
            </section>

            <section aria-labelledby="h-tipe" className="mt-10">
              <h2 id="h-tipe" className="font-display text-2xl font-bold">Tipe dan harga</h2>
              <p className="text-sm text-aspal/75">Harga baru berlaku untuk pemesanan dan perpanjangan berikutnya.</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left">
                  <thead>
                    <tr className="border-b-2 border-aspal text-sm">
                      <th className="py-2 pr-4">Tipe</th><th className="py-2 pr-4">Mesin</th><th className="py-2 pr-4">Unit</th>
                      <th className="py-2 pr-4">Harian (Rp)</th><th className="py-2 pr-4">Mingguan (Rp)</th><th className="py-2"><span className="sr-only">Aksi</span></th>
                    </tr>
                  </thead>
                  <tbody>{data.tipe.map((t) => <BarisTipe key={`${t.id_tipe}-${t.harga_harian}-${t.harga_mingguan}`} t={t} onPesan={lapor} />)}</tbody>
                </table>
              </div>

              <form onSubmit={(e) => tambah(e, "/api/admin/tipe-motor", tipeBaru, () => setTipeBaru({ merek: "", nama_model: "", jenis_transmisi: "MATIC", kapasitas_cc: "", harga_harian: "", harga_mingguan: "" }))}
                noValidate className="mt-5 rounded-md border-2 border-aspal bg-white p-4">
                <h3 className="font-display text-xl font-bold">Tambah tipe</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {[["merek", "Merek"], ["nama_model", "Model"]].map(([k, l]) => (
                    <label key={k} className="text-sm font-semibold">{l}
                      <input value={tipeBaru[k]} onChange={(e) => setTipeBaru({ ...tipeBaru, [k]: e.target.value })} className={`${kotak} mt-1 block w-full font-normal`} />
                    </label>
                  ))}
                  <label className="text-sm font-semibold">Transmisi
                    <select value={tipeBaru.jenis_transmisi} onChange={(e) => setTipeBaru({ ...tipeBaru, jenis_transmisi: e.target.value })} className={`${kotak} mt-1 block w-full font-normal`}>
                      {Object.entries(TRANSMISI).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  {[["kapasitas_cc", "Kapasitas (cc)"], ["harga_harian", "Harga harian (Rp)"], ["harga_mingguan", "Harga mingguan (Rp, opsional)"]].map(([k, l]) => (
                    <label key={k} className="text-sm font-semibold">{l}
                      <input inputMode="numeric" value={tipeBaru[k]} onChange={(e) => setTipeBaru({ ...tipeBaru, [k]: e.target.value.replace(/\D/g, "") })} className={`${kotak} mt-1 block w-full font-normal`} />
                    </label>
                  ))}
                </div>
                {tipeBaru.harga_harian && <p className="mt-2 text-sm text-aspal/75">Harga harian: {rupiah(Number(tipeBaru.harga_harian))}</p>}
                <button type="submit" className={`${tombolUtama} mt-4`}>Tambah tipe</button>
              </form>
            </section>
          </>
        )}
      </main>
    </>
  );
}
