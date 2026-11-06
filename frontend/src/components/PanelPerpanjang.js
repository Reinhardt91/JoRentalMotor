"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { waktu, jam, tambahHari } from "@/lib/format";
import { hitungBiaya } from "@/lib/tarif";
import { rupiah } from "@/components/motor";

const JEDA_PANTAU_MS = 5000;

export default function PanelPerpanjang({ idSewa, onBerubah, onTutup }) {
  const [info, setInfo] = useState(null);
  const [tambahan, setTambahan] = useState(1);
  const [aktif, setAktif] = useState(null); // pengajuan yang sedang menunggu pembayaran
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const [kabar, setKabar] = useState("");

  const muatInfo = useCallback(async () => {
    try {
      const res = await api(`/api/sewa/${idSewa}/perpanjangan`);
      setInfo(res.data);
      setAktif(res.data.menunggu);
      setTambahan((t) => Math.min(Math.max(1, t), Math.max(1, res.data.maks_hari)));
    } catch (e) {
      setGalat(e.message);
    }
  }, [idSewa]);

  useEffect(() => {
    muatInfo();
  }, [muatInfo]);

  // Pantau status pembayaran secara berkala selama kode QR masih menunggu
  useEffect(() => {
    if (!aktif || aktif.status_perpanjangan !== "MENUNGGU_PEMBAYARAN") return;
    const t = setInterval(async () => {
      try {
        const { data } = await api(`/api/perpanjangan/${aktif.id_perpanjangan}`);
        if (data.status_perpanjangan === aktif.status_perpanjangan && data.qr_kedaluwarsa === aktif.qr_kedaluwarsa) return;
        setAktif(data);
        if (data.status_perpanjangan === "LUNAS") {
          setKabar(`Pembayaran diterima. Jatuh tempo baru ${waktu(data.jatuh_tempo_baru)}.`);
          onBerubah?.();
        } else if (data.status_perpanjangan === "LUNAS_PERLU_TINDAKAN") {
          setKabar("Pembayaran diterima, tetapi perpanjangan tidak dapat diterapkan karena jadwal unit bentrok. Admin akan menghubungi Anda.");
          onBerubah?.();
        } else if (data.status_perpanjangan !== "MENUNGGU_PEMBAYARAN") {
          setKabar("Pengajuan ini sudah tidak berlaku. Silakan ajukan ulang.");
          muatInfo();
        }
      } catch {
        // Gangguan sesaat: coba lagi pada putaran berikutnya
      }
    }, JEDA_PANTAU_MS);
    return () => clearInterval(t);
  }, [aktif, muatInfo, onBerubah]);

  async function ajukan() {
    setSibuk(true);
    setGalat("");
    setKabar("");
    try {
      const res = await api("/api/perpanjangan", { method: "POST", body: { id_sewa: idSewa, tambahan_hari: tambahan } });
      setAktif(res.data);
    } catch (e) {
      setGalat(e.message);
      if (e.status === 409) muatInfo();
    } finally {
      setSibuk(false);
    }
  }

  async function batalkan() {
    if (!window.confirm("Batalkan pengajuan perpanjangan ini? Kode QR tidak dapat dipakai lagi.")) return;
    setSibuk(true);
    setGalat("");
    try {
      const res = await api(`/api/perpanjangan/${aktif.id_perpanjangan}/batal`, { method: "POST" });
      setKabar(res.pesan);
      setAktif(null);
      await muatInfo();
    } catch (e) {
      setGalat(e.message);
    } finally {
      setSibuk(false);
    }
  }

  if (!info) {
    return <div className="mt-3 rounded-md border-2 border-aspal bg-white p-4 text-aspal/70">{galat || "Memuat…"}</div>;
  }

  const menungguBayar = aktif && aktif.status_perpanjangan === "MENUNGGU_PEMBAYARAN";
  const selesai = aktif && ["LUNAS", "LUNAS_PERLU_TINDAKAN"].includes(aktif.status_perpanjangan);

  return (
    <section aria-label="Perpanjang sewa" className="mt-3 rounded-md border-2 border-aspal bg-white p-5">
      {kabar && (
        <p role="status" className={`mb-4 rounded-md border-2 p-3 text-sm font-semibold ${
          aktif?.status_perpanjangan === "LUNAS" ? "border-rambu text-rambu" : "border-aspal text-aspal"}`}>
          {kabar}
        </p>
      )}
      {galat && <p role="alert" className="mb-4 rounded-md border-2 border-rem p-3 text-sm font-semibold text-rem">{galat}</p>}

      {menungguBayar ? (
        <div className="grid gap-5 md:grid-cols-[auto_1fr]">
          <div className="justify-self-center">
            {aktif.qr_url && !aktif.qr_kedaluwarsa ? (
              <img src={aktif.qr_url} width={240} height={240}
                alt={`Kode QR QRIS untuk membayar perpanjangan sebesar ${rupiah(aktif.biaya_perpanjangan)}`}
                className="h-60 w-60 border-2 border-aspal bg-white" />
            ) : (
              <div className="flex h-60 w-60 items-center justify-center border-2 border-dashed border-garis p-4 text-center text-sm text-aspal/70">
                Kode QR sudah kedaluwarsa.
              </div>
            )}
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold">Bayar perpanjangan</h3>
            <p className="mt-1 font-display text-4xl font-bold">{rupiah(aktif.biaya_perpanjangan)}</p>
            <p className="mt-2 text-sm">
              {aktif.tambahan_hari} hari, jatuh tempo baru <span className="font-semibold">{waktu(aktif.jatuh_tempo_baru)}</span>
            </p>
            {!aktif.qr_kedaluwarsa && aktif.expiry_time && (
              <p className="mt-1 text-sm">Kode berlaku sampai pukul <span className="font-semibold">{jam(aktif.expiry_time)} WITA</span>.</p>
            )}
            <p className="mt-3 text-sm text-aspal/75">Pindai dengan aplikasi e-wallet atau mobile banking yang mendukung QRIS.</p>
            {info.mode === "sandbox" && (
              <p className="mt-1 text-sm text-aspal/75">Mode uji coba: bayar memakai simulator QRIS Midtrans Sandbox. Tidak ada uang sungguhan.</p>
            )}
            <p aria-live="polite" className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-aspal" />
              {aktif.qr_kedaluwarsa ? "Buat kode baru untuk melanjutkan." : "Menunggu pembayaran. Halaman ini akan diperbarui otomatis."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {aktif.qr_kedaluwarsa && (
                <button type="button" onClick={ajukan} disabled={sibuk}
                  className="rounded-md bg-marka px-4 py-2 font-bold text-aspal hover:bg-marka-tua disabled:opacity-60">
                  Buat kode QR baru
                </button>
              )}
              <button type="button" onClick={batalkan} disabled={sibuk}
                className="rounded-md border-2 border-aspal px-4 py-2 font-bold disabled:opacity-60">
                Batalkan pengajuan
              </button>
            </div>
          </div>
        </div>
      ) : selesai ? (
        <button type="button" onClick={onTutup} className="rounded-md border-2 border-aspal px-4 py-2 font-bold">Tutup</button>
      ) : info.maks_hari === 0 ? (
        <>
          <p className="font-semibold">Sewa ini tidak dapat diperpanjang.</p>
          {info.reservasi_berikutnya && (
            <p className="mt-1 text-sm text-aspal/75">Unit sudah dipesan pelanggan lain mulai {waktu(info.reservasi_berikutnya)}.</p>
          )}
          <button type="button" onClick={onTutup} className="mt-4 rounded-md border-2 border-aspal px-4 py-2 font-bold">Tutup</button>
        </>
      ) : (
        <>
          <h3 className="font-display text-2xl font-bold">Perpanjang sewa</h3>
          <p className="mt-1 text-sm"><span className="text-aspal/70">Jatuh tempo sekarang:</span> {waktu(info.jatuh_tempo)}</p>
          <div className="mt-4 flex items-center gap-3">
            <span id={`label-tambah-${idSewa}`} className="text-sm font-semibold">Tambahan hari</span>
            <button type="button" aria-label="Kurangi satu hari" onClick={() => setTambahan((t) => Math.max(1, t - 1))}
              disabled={tambahan <= 1} className="h-10 w-10 rounded-md border-2 border-aspal text-xl font-bold disabled:opacity-40">−</button>
            <output aria-labelledby={`label-tambah-${idSewa}`} className="w-10 text-center font-display text-3xl font-bold">{tambahan}</output>
            <button type="button" aria-label="Tambah satu hari" onClick={() => setTambahan((t) => Math.min(info.maks_hari, t + 1))}
              disabled={tambahan >= info.maks_hari} className="h-10 w-10 rounded-md border-2 border-aspal text-xl font-bold disabled:opacity-40">+</button>
          </div>
          {info.reservasi_berikutnya && (
            <p className="mt-2 text-sm text-aspal/75">
              Maksimal {info.maks_hari} hari karena unit sudah dipesan pelanggan lain mulai {waktu(info.reservasi_berikutnya)}.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-aspal/70">Jatuh tempo baru</dt>
            <dd className="font-semibold">{waktu(tambahHari(info.jatuh_tempo, tambahan))}</dd>
            <dt className="text-aspal/70">Biaya</dt>
            <dd className="font-semibold">{rupiah(hitungBiaya(tambahan, info.harga_harian, info.harga_mingguan))}</dd>
          </dl>
          <p className="mt-3 text-sm text-aspal/75">
            Jatuh tempo diperbarui otomatis setelah pembayaran QRIS diterima. Kode QR berlaku {info.menit_berlaku_qris} menit.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={ajukan} disabled={sibuk}
              className="rounded-md bg-marka px-4 py-2.5 font-bold text-aspal hover:bg-marka-tua disabled:opacity-60">
              {sibuk ? "Membuat kode QR…" : "Bayar dengan QRIS"}
            </button>
            <button type="button" onClick={onTutup} className="rounded-md border-2 border-aspal px-4 py-2 font-bold">Batal</button>
          </div>
        </>
      )}
    </section>
  );
}
