"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import NavPelanggan from "@/components/NavPelanggan";
import { PlatNomor, StatusMotor, rupiah } from "@/components/motor";

const TRANSMISI = { MATIC: "Matic", MANUAL: "Manual", KOPLING: "Kopling" };

export default function HalamanMotor() {
  const { siap } = useWajibLogin("PELANGGAN");
  const [data, setData] = useState([]);
  const [periode, setPeriode] = useState(null);
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState("");

  const muat = useCallback(async (p) => {
    setMemuat(true);
    setGalat("");
    try {
      const qs = p ? `?mulai=${p.mulai}&selesai=${p.selesai}` : "";
      const res = await api(`/api/motor${qs}`);
      setData(res.data);
      setPeriode(res.periode);
    } catch (e) {
      setGalat(e.message);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    if (siap) muat(null);
  }, [siap, muat]);

  function cek(e) {
    e.preventDefault();
    if (!mulai || !selesai) return setGalat("Isi tanggal ambil dan tanggal kembali.");
    if (selesai <= mulai) return setGalat("Tanggal kembali harus setelah tanggal ambil.");
    muat({ mulai, selesai });
  }

  function hapusTanggal() {
    setMulai("");
    setSelesai("");
    muat(null);
  }

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

  // Motor yang tersedia ditampilkan lebih dulu
  const urut = [...data].sort((a, b) => Number(b.tersedia) - Number(a.tersedia));
  const jumlahTersedia = data.filter((m) => m.tersedia).length;

  return (
    <>
      <NavPelanggan />
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold">Motor</h1>

        <form onSubmit={cek} className="mt-5 flex flex-wrap items-end gap-4" noValidate>
          <div>
            <label htmlFor="mulai" className="block text-sm font-semibold">Tanggal ambil</label>
            <input id="mulai" type="date" value={mulai} onChange={(e) => setMulai(e.target.value)}
              className="mt-1.5 rounded-md border-2 border-garis bg-white px-3 py-2" />
          </div>
          <div>
            <label htmlFor="selesai" className="block text-sm font-semibold">Tanggal kembali</label>
            <input id="selesai" type="date" value={selesai} onChange={(e) => setSelesai(e.target.value)}
              className="mt-1.5 rounded-md border-2 border-garis bg-white px-3 py-2" />
          </div>
          <button type="submit" className="rounded-md bg-marka px-4 py-2.5 font-bold text-aspal hover:bg-marka-tua">
            Cek ketersediaan
          </button>
          {periode && (
            <button type="button" onClick={hapusTanggal} className="py-2.5 font-semibold underline underline-offset-2">
              Hapus tanggal
            </button>
          )}
        </form>

        {galat && (
          <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">
            {galat}
          </p>
        )}

        {memuat ? (
          <p className="mt-8 text-aspal/70">Memuat daftar motor…</p>
        ) : (
          <>
            <p className="mt-6 font-semibold" aria-live="polite">
              {periode
                ? `${jumlahTersedia} dari ${data.length} motor tersedia pada tanggal itu.`
                : `${jumlahTersedia} dari ${data.length} motor tersedia saat ini.`}
            </p>
            {data.length === 0 ? (
              <p className="mt-4">Belum ada motor yang terdaftar.</p>
            ) : (
              <ul className="mt-2">
                {urut.map((m) => (
                  <li
                    key={m.id_motor}
                    className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-5 md:grid-cols-[11rem_1fr_16rem] md:items-center"
                  >
                    <div><PlatNomor plat={m.plat_nomor} /></div>
                    <div>
                      <p className="font-display text-2xl font-bold leading-tight">{m.merek} {m.nama_model}</p>
                      <p className="text-sm text-aspal/75">
                        {TRANSMISI[m.jenis_transmisi]}, {m.kapasitas_cc} cc, {m.warna}, tahun {m.tahun_produksi}
                      </p>
                    </div>
                    <div className="md:text-right">
                      <StatusMotor motor={m} periode={periode} />
                      <p className="mt-1 font-semibold">{rupiah(m.harga_harian)} per hari</p>
                      {m.harga_mingguan !== null && (
                        <p className="text-sm text-aspal/75">{rupiah(m.harga_mingguan)} per minggu</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}
