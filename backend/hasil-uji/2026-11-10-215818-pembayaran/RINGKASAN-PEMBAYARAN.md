# Waktu proses pembayaran perpanjangan

- Diambil: 2026-11-10 21:58:18 WITA
- Waktu bayar = settlement_time dari Midtrans (dikonversi ke WITA). Jam Midtrans dan jam laptop dapat berselisih beberapa detik, dan waktu selesai tercatat per detik.

| No | Order ID | Unit | Jalur | Dibayar (Midtrans) | Webhook diterima | Selesai diproses | Bayar ke diterima (dtk) | Bayar ke jatuh tempo diperbarui (dtk) |
|---|---|---|---|---|---|---|---|---|
| 1 | JRM-3-36a0dd | DB 1001 JR | webhook | 2026-11-10 21:08:58 | 2026-11-10 21:08:59 | 2026-11-10 21:08:59 | 1.2 | 1 |
| 2 | JRM-4-c03c59 | DB 1001 JR | webhook | 2026-11-10 21:10:10 | 2026-11-10 21:10:10 | 2026-11-10 21:10:11 | 0.9 | 1 |
| 3 | JRM-5-b51cfe | DB 1001 JR | webhook | 2026-11-10 21:11:01 | 2026-11-10 21:11:02 | 2026-11-10 21:11:02 | 1.1 | 1 |
| 4 | JRM-6-928724 | DB 1001 JR | webhook | 2026-11-10 21:11:20 | 2026-11-10 21:11:21 | 2026-11-10 21:11:21 | 1.4 | 1 |
| 5 | JRM-7-b5dae7 | DB 1001 JR | webhook | 2026-11-10 21:21:19 | 2026-11-10 21:21:20 | 2026-11-10 21:21:20 | 1.2 | 1 |
| 6 | JRM-8-7efef6 | DB 1001 JR | rekonsiliasi | 2026-11-10 21:29:25 | - | 2026-11-10 21:30:00 | - | 35.2 |

## Ringkasan

| Jalur | Jumlah | Median (dtk) | Tercepat (dtk) | Terlama (dtk) |
|---|---|---|---|---|
| Webhook | 5 | 1 | 1 | 1 |
| Rekonsiliasi (webhook tidak tiba) | 1 | 35.2 | 35.2 | 35.2 |
