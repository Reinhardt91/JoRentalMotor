# Ringkasan pengukuran kinerja

- Waktu: 2026-11-07 01:42:03 WITA
- Lingkungan: Node.js v22.18.0, PostgreSQL 18.6, win32, 16 CPU
- Beban API: 10 pengguna tiruan bersamaan, tanpa jeda berpikir, bergiliran memanggil GET /api/motor, GET /api/motor?mulai&selesai, GET /api/reservasi/saya
- Notifikasi: mode simulasi, 150 ms per pesan (meniru panggilan ke gateway), tanpa jeda antarpesan (lebih berat dari pemakaian sebenarnya)
- Pemanasan bersama 5 detik sebelum skenario pertama; lama minimal tiap skenario 20 detik, 2 detik pertama tiap skenario tidak dihitung
- Event loop delay: perf_hooks.monitorEventLoopDelay, resolusi 10 ms; nilai yang dilaporkan sudah dikurangi resolusi
- Target: latensi p95 < 500 ms dan event loop delay p99 < 100 ms

- Putaran: 3, urutan skenario digilir tiap putaran; tabel utama memakai MEDIAN antarputaran, kolom "terburuk" memakai nilai paling buruk

## Hasil (median antarputaran)

| Skenario | Pesan terkirim | Lama proses antrean (dtk) | Throughput (req/dtk) | Galat | Latensi median (ms) | p95 (ms) | p95 terburuk (ms) | p99 (ms) | ELD p99 (ms) | ELD p99 terburuk (ms) | ELD maks terburuk (ms) | Target (semua putaran) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tanpa beban notifikasi | 0 dari 0 | 0 | 1179 | 0 | 8.1 | 11.1 | 13.7 | 14.4 | 3.4 | 5.6 | 13.1 | Memenuhi |
| Beban realistis | 90 dari 90 | 4.7 | 1216.6 | 0 | 8 | 10.3 | 11.6 | 12 | 3.1 | 3.8 | 7 | Memenuhi |
| Beban ekstrem | 900 dari 900 | 46.6 | 1218.1 | 0 | 8 | 10.2 | 10.3 | 12.3 | 3.1 | 3.2 | 6.3 | Memenuhi |

## Rincian per putaran

| Putaran | Skenario | Pesan (terkirim) | Lama proses (dtk) | Permintaan | Throughput | Galat | Median | p95 | p99 | ELD p50 | ELD p99 | ELD maks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Tanpa beban notifikasi | 0 (0) | 0 | 19351 | 1073.4 | 0 | 8.7 | 13.7 | 17.8 | 0.7 | 5.6 | 13.1 |
| 1 | Beban realistis | 30 (30) | 4.8 | 21114 | 1167.1 | 0 | 8.2 | 11.6 | 14.9 | 0.6 | 3.8 | 7 |
| 1 | Beban ekstrem | 300 (300) | 46.6 | 56705 | 1215.7 | 0 | 8 | 10.2 | 12.3 | 0.6 | 3.1 | 5.3 |
| 2 | Beban realistis | 30 (30) | 4.7 | 22399 | 1239.7 | 0 | 7.8 | 9.8 | 11.7 | 0.6 | 3.1 | 4.6 |
| 2 | Beban ekstrem | 300 (300) | 46.6 | 56746 | 1218.1 | 0 | 8 | 10.3 | 12.5 | 0.6 | 3.2 | 6.3 |
| 2 | Tanpa beban notifikasi | 0 (0) | 0 | 21637 | 1198.1 | 0 | 8 | 10.8 | 13.1 | 0.6 | 3.1 | 5.5 |
| 3 | Beban ekstrem | 300 (300) | 46.6 | 57000 | 1222.2 | 0 | 7.9 | 10.2 | 12.1 | 0.6 | 3.1 | 5.9 |
| 3 | Tanpa beban notifikasi | 0 (0) | 0 | 21294 | 1179 | 0 | 8.1 | 11.1 | 14.4 | 0.7 | 3.4 | 7.3 |
| 3 | Beban realistis | 30 (30) | 4.7 | 21909 | 1216.6 | 0 | 8 | 10.3 | 12 | 0.6 | 2.9 | 5 |
