"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useWajibLogin } from "@/lib/auth";
import { tanggal, jam } from "@/lib/format";
import NavPelanggan from "@/components/NavPelanggan";
import { PlatNomor, StatusMotor, rupiah } from "@/components/motor";
import { Field } from "@/components/ui";

const TRANSMISI = { MATIC: "Matic", MANUAL: "Manual", KOPLING: "Kopling" };

export default function HalamanMotor() {
  const { siap } = useWajibLogin("PELANGGAN");
  const router = useRouter();
  const [data, setData] = useState([]);
  const [periode, setPeriode] = useState(null);
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState("");

  // Panel pemesanan
  const [pilih, setPilih] = useState(null);
  const [metode, setMetode] = useState("AMBIL");
  const [lokasi, setLokasi] = useState("");
  const [kirim, setKirim] = useState(false);
  const [galatPesan, setGalatPesan] = useState("");
  const panelRef = useRef(null);

  const muat = useCallback(async (p) => {
    setMemuat(true);
    setGalat("");
    setPilih(null);
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

  useEffect(() => {
    if (!pilih || !panelRef.current) return;
    const kurangiGerak = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRef.current.scrollIntoView({ behavior: kurangiGerak ? "auto" : "smooth", block: "start" });
  }, [pilih]);

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

  function bukaPesan(m) {
    setPilih(m);
    setMetode("AMBIL");
    setLokasi("");
    setGalatPesan("");
  }

  async function buatReservasi(e) {
    e.preventDefault();
    if (metode === "ANTAR" && lokasi.trim().length < 5) {
      return setGalatPesan("Isi alamat pengantaran dengan jelas, misalnya nama jalan dan nomor rumah.");
    }
    setKirim(true);
    setGalatPesan("");
    try {
      await api("/api/reservasi", {
        method: "POST",
        body: {
          id_motor: pilih.id_motor,
          mulai: periode.mulai,
          selesai: periode.selesai,
          metode_serah: metode,
          lokasi_serah: metode === "ANTAR" ? lokasi.trim() : undefined,
        },
      });
      try { sessionStorage.setItem("jo_flash", "Reservasi dibuat dan menunggu konfirmasi admin."); } catch {}
      router.push("/sewa");
    } catch (err) {
      setGalatPesan(err.galat?.length ? err.galat.join(" ") : err.message);
      setKirim(false);
      // Jika jadwal sudah diambil orang lain, perbarui daftar supaya status terbaru terlihat
      if (err.status === 409) {
        const res = await api(`/api/motor?mulai=${periode.mulai}&selesai=${periode.selesai}`).catch(() => null);
        if (res) setData(res.data);
      }
    }
  }

  if (!siap) return <p className="p-6 text-aspal/70">Memuat…</p>;

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
          <p role="alert" className="mt-4 rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galat}</p>
        )}

        {pilih && periode && (
          <section ref={panelRef} aria-labelledby="judul-pesan" className="mt-6 scroll-mt-4 rounded-md border-2 border-aspal bg-white p-5">
            <h2 id="judul-pesan" className="font-display text-3xl font-bold">
              Pesan {pilih.merek} {pilih.nama_model}
            </h2>
            <div className="mt-3"><PlatNomor plat={pilih.plat_nomor} /></div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
              <dt className="text-aspal/70">Ambil</dt>
              <dd className="font-semibold">{tanggal(periode.mulai)}, pukul {jam(periode.jam_ambil)} WITA</dd>
              <dt className="text-aspal/70">Kembali</dt>
              <dd className="font-semibold">{tanggal(periode.selesai)}, pukul {jam(periode.jam_kembali)} WITA</dd>
              <dt className="text-aspal/70">Lama sewa</dt>
              <dd className="font-semibold">{pilih.hari} hari</dd>
              <dt className="text-aspal/70">Estimasi biaya</dt>
              <dd className="font-semibold">{rupiah(pilih.estimasi_biaya)}</dd>
            </dl>

            <form onSubmit={buatReservasi} noValidate className="mt-5 space-y-4">
              <fieldset>
                <legend className="text-sm font-semibold">Cara serah terima</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="metode" value="AMBIL" checked={metode === "AMBIL"}
                      onChange={() => setMetode("AMBIL")} className="h-4 w-4 accent-aspal" />
                    Ambil sendiri di lokasi rental
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="metode" value="ANTAR" checked={metode === "ANTAR"}
                      onChange={() => setMetode("ANTAR")} className="h-4 w-4 accent-aspal" />
                    Diantar ke lokasi saya
                  </label>
                </div>
              </fieldset>
              {metode === "ANTAR" && (
                <Field label="Alamat pengantaran" value={lokasi} onChange={(e) => setLokasi(e.target.value)}
                  autoComplete="street-address" />
              )}
              <p className="text-sm text-aspal/75">
                Reservasi menunggu konfirmasi admin. Pembayaran sewa awal dilakukan langsung kepada pemilik.
              </p>
              {galatPesan && (
                <p role="alert" className="rounded-md border-2 border-rem bg-white p-3 text-sm font-semibold text-rem">{galatPesan}</p>
              )}
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={kirim}
                  className="rounded-md bg-marka px-4 py-2.5 font-bold text-aspal hover:bg-marka-tua disabled:opacity-60">
                  {kirim ? "Mengirim…" : "Buat reservasi"}
                </button>
                <button type="button" onClick={() => setPilih(null)}
                  className="rounded-md border-2 border-aspal px-4 py-2 font-bold">
                  Batal
                </button>
              </div>
            </form>
          </section>
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
            {!periode && (
              <p className="mt-1 text-sm text-aspal/75">Pilih tanggal ambil dan tanggal kembali untuk memesan.</p>
            )}
            {data.length === 0 ? (
              <p className="mt-4">Belum ada motor yang terdaftar.</p>
            ) : (
              <ul className="mt-2">
                {urut.map((m) => (
                  <li key={m.id_motor}
                    className="grid gap-x-6 gap-y-2 border-b-2 border-aspal/15 py-5 md:grid-cols-[11rem_1fr_16rem] md:items-center">
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
                      {periode && m.tersedia && (
                        <>
                          <p className="mt-1 text-sm font-semibold">{rupiah(m.estimasi_biaya)} untuk {m.hari} hari</p>
                          <button type="button" onClick={() => bukaPesan(m)} aria-label={`Pesan ${m.plat_nomor}`}
                            className="mt-2 rounded-md bg-marka px-4 py-2 font-bold text-aspal hover:bg-marka-tua">
                            Pesan
                          </button>
                        </>
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
