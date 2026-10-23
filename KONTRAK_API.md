# Kontrak API Jo Rental Motor

Dokumen kerja untuk pembangunan backend dan frontend. Semua alamat diawali `http://localhost:3000`.
Semua rute (kecuali registrasi, login, dan webhook) wajib membawa header `Authorization: Bearer <token>`.

Format galat selalu: `{ "pesan": "...", "galat": ["..."] }` (`galat` hanya ada pada kesalahan validasi).

Kode status yang dipakai: 200 berhasil, 201 dibuat, 400 data tidak valid, 401 belum login atau token salah,
403 peran tidak berhak, 404 tidak ditemukan, 409 konflik (data ganda atau konflik versi).

## Akun (sudah dibuat dan diuji)

| Metode | Alamat | Peran | Fungsi |
|---|---|---|---|
| POST | `/api/auth/register` | umum | Registrasi pelanggan. Body: `email, password, nama_lengkap, no_whatsapp, no_ktp, asal_daerah?` |
| POST | `/api/auth/login` | umum | Body: `email, password`. Balikan: `token, user` |
| GET | `/api/auth/me` | login | Data pengguna yang sedang login |

## Motor (sudah dibuat dan diuji)

| Metode | Alamat | Peran | Fungsi |
|---|---|---|---|
| GET | `/api/motor` | login | Daftar motor. Tambahan `?mulai=YYYY-MM-DD&selesai=YYYY-MM-DD` untuk cek ketersediaan periode |
| GET | `/api/motor/:id` | login | Detail satu motor |

Bentuk satu motor: `id_motor, plat_nomor, merek, nama_model, jenis_transmisi, kapasitas_cc, warna,
tahun_produksi, harga_harian, harga_mingguan, foto_url, status_unit, tersedia`.

## Sewa (belum dibuat)

| Metode | Alamat | Peran | Fungsi |
|---|---|---|---|
| GET | `/api/sewa/saya` | PELANGGAN | Daftar sewa milik sendiri (aktif dan riwayat), lengkap dengan motor, jatuh tempo, status, dan ada tidaknya perpanjangan yang menunggu |
| GET | `/api/admin/sewa?status=` | ADMIN | Pantau semua sewa; saring menurut status |

## Perpanjangan dan pembayaran (belum dibuat, inti proyek)

| Metode | Alamat | Peran | Fungsi |
|---|---|---|---|
| POST | `/api/perpanjangan` | PELANGGAN | Body: `id_sewa, tambahan_hari`. Backend membaca `motor.version`, memeriksa konflik, membuat transaksi QRIS di Midtrans. Balikan: `id_perpanjangan, jatuh_tempo_baru, biaya, pembayaran { order_id, qr_url, expiry_time }`. 409 bila terjadi konflik versi |
| GET | `/api/perpanjangan/:id/status` | PELANGGAN (pemilik) | Dipakai halaman bayar untuk memeriksa status berkala. Balikan: `status_perpanjangan, transaction_status` |
| GET | `/api/admin/perpanjangan?status=` | ADMIN | Daftar perpanjangan untuk diverifikasi |
| POST | `/api/admin/perpanjangan/:id/verifikasi` | ADMIN | Body: `catatan?`. Mengisi `diverifikasi_oleh` dan `verified_at` |
| POST | `/api/webhook/midtrans` | publik (dijaga `signature_key`) | Menerima notifikasi Midtrans. Selalu dicatat ke `webhook_log` |

## Notifikasi (belum dibuat)

| Metode | Alamat | Peran | Fungsi |
|---|---|---|---|
| GET | `/api/admin/notifikasi?status=GAGAL` | ADMIN | Log notifikasi WhatsApp yang gagal terkirim |

## Aturan yang dipegang bersama

- Peran dan status akun dibaca dari database pada setiap permintaan, bukan dari isi token.
- Pelanggan hanya boleh mengakses sewa dan perpanjangan miliknya sendiri.
- Hanya backend yang boleh mengubah `motor.version`, `status_unit`, dan status pembayaran.
- Pembaruan status akibat webhook dijalankan dalam satu transaksi database.
