// Komponen kecil untuk tampilan motor: plat nomor, status, format rupiah.

export function rupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

// Plat nomor ditampilkan seperti plat kendaraan: latar gelap, huruf putih, bingkai tipis
export function PlatNomor({ plat }) {
  return (
    <span className="inline-block rounded-md bg-aspal p-[3px]">
      <span className="block rounded-[5px] border-2 border-white/90 px-3 py-0.5 font-display text-2xl font-bold tracking-wider text-white">
        {plat}
      </span>
    </span>
  );
}

const LABEL_STATUS = {
  TERSEDIA: "Tersedia",
  DIPESAN: "Sudah dipesan",
  DISEWA: "Sedang disewa",
  PERBAIKAN: "Dalam perbaikan",
  TIDAK_TERSEDIA: "Tidak tersedia",
};

// Status memakai bentuk (lingkaran penuh / cincin) dan teks, bukan warna saja
export function StatusMotor({ motor, periode }) {
  let teks;
  if (periode && !["PERBAIKAN", "TIDAK_TERSEDIA"].includes(motor.status_unit)) {
    teks = motor.tersedia ? "Tersedia pada tanggal itu" : "Tidak tersedia pada tanggal itu";
  } else {
    teks = LABEL_STATUS[motor.status_unit] || motor.status_unit;
  }
  return (
    <p className="flex items-center gap-2 font-bold md:justify-end">
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-3 rounded-full ${
          motor.tersedia ? "bg-rambu" : "border-2 border-garis bg-transparent"
        }`}
      />
      <span className={motor.tersedia ? "text-rambu" : "text-aspal/70"}>{teks}</span>
    </p>
  );
}
