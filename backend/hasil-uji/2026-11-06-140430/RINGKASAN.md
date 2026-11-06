# Ringkasan pengujian otomatis

- Waktu: 2026-11-06 14:04:52 WITA
- Mode Midtrans: Midtrans Sandbox sungguhan
- Lingkungan: Node.js v22.18.0, PostgreSQL 18.6, win32
- Total waktu: 22 detik

| Rangkaian uji | Rumusan | Fokus | Pemeriksaan lulus | Gagal | Waktu (dtk) | Hasil |
|---|---|---|---|---|---|---|
| alur-reservasi | 3 | Pemesanan dan jadwal bertumpang tindih | 34 | 0 | 0.8 | LULUS |
| alur-admin | 3 | Konfirmasi, mulai sewa, akhiri sewa, Optimistic Locking | 24 | 0 | 0.6 | LULUS |
| alur-perpanjangan | 1 dan 3 | Pengajuan perpanjangan dan pembuatan QRIS | 25 | 0 | 2.0 | LULUS |
| alur-webhook | 1 dan 2 | Webhook: signature, duplikat, status, rekonsiliasi | 33 | 1 | 3.2 | GAGAL |
| alur-admin-tambahan | 3 | Perpanjangan bermasalah dan kelola armada | 26 | 0 | 0.9 | LULUS |
| alur-pengirim | 4 | Antrean WhatsApp, percobaan ulang (mode simulasi) | 12 | 0 | 0.7 | LULUS |
| alur-pengingat | 4 | Pengingat H-1/H-0, pemulihan jadwal, TERLAMBAT | 21 | 0 | 0.6 | LULUS |
| **Total** | | | **175** | **1** | | **ADA YANG GAGAL** |
