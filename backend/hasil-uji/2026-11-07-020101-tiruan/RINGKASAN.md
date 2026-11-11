# Ringkasan pengujian otomatis

- Waktu: 2026-11-07 02:01:20 WITA
- Mode Midtrans: server tiruan (tanpa internet)
- Lingkungan: Node.js v22.18.0, PostgreSQL 18.6, win32
- Total waktu: 19 detik

| Rangkaian uji | Rumusan | Fokus | Pemeriksaan lulus | Gagal | Waktu (dtk) | Hasil |
|---|---|---|---|---|---|---|
| alur-reservasi | 3 | Pemesanan dan jadwal bertumpang tindih | 34 | 0 | 0.9 | LULUS |
| alur-admin | 3 | Konfirmasi, mulai sewa, akhiri sewa, Optimistic Locking | 24 | 0 | 0.8 | LULUS |
| alur-perpanjangan | 1 dan 3 | Pengajuan perpanjangan dan pembuatan QRIS | 7 | 1 | 0.5 | GAGAL |
| alur-webhook | 1 dan 2 | Webhook: signature, duplikat, status, rekonsiliasi | 0 | 0 | 0.5 | GALAT |
| alur-admin-tambahan | 3 | Perpanjangan bermasalah dan kelola armada | 0 | 0 | 0.4 | GALAT |
| alur-pengirim | 4 | Antrean WhatsApp, percobaan ulang (mode simulasi) | 12 | 0 | 0.7 | LULUS |
| alur-pengingat | 4 | Pengingat H-1/H-0, pemulihan jadwal, TERLAMBAT | 21 | 0 | 0.7 | LULUS |
| **Total** | | | **98** | **1** | | **ADA YANG GAGAL** |
