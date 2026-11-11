# Ringkasan pengukuran kinerja

- Waktu: 2026-11-07 02:06:19 WITA
- Lingkungan: Node.js v22.18.0, PostgreSQL 18.6, win32, 16 CPU
- Beban API: 10 pengguna tiruan bersamaan, tanpa jeda berpikir, bergiliran memanggil GET /api/motor, GET /api/motor?mulai&selesai, GET /api/reservasi/saya
- Notifikasi: mode simulasi, 150 ms per pesan (meniru panggilan ke gateway), tanpa jeda antarpesan (lebih berat dari pemakaian sebenarnya)
- Pemanasan bersama 10 detik sebelum skenario pertama; lama minimal tiap skenario 20 detik, 2 detik pertama tiap skenario tidak dihitung
- Event loop delay: perf_hooks.monitorEventLoopDelay, resolusi 10 ms; nilai yang dilaporkan sudah dikurangi resolusi
- Target: latensi p95 < 500 ms dan event loop delay p99 < 100 ms

- Putaran: 3, urutan skenario digilir tiap putaran; tabel utama memakai MEDIAN antarputaran, kolom "terburuk" memakai nilai paling buruk

## Hasil (median antarputaran)

| Skenario | Pesan terkirim | Lama proses antrean (dtk) | Throughput (req/dtk) | Galat | Latensi median (ms) | p95 (ms) | p95 terburuk (ms) | p99 (ms) | ELD p99 (ms) | ELD p99 terburuk (ms) | ELD maks terburuk (ms) | Target (semua putaran) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tanpa beban notifikasi | 0 dari 0 | 0 | 1061.1 | 0 | 9 | 12.9 | 15.6 | 15.6 | 4.3 | 4.7 | 11.5 | Memenuhi |
| Beban realistis | 90 dari 90 | 4.7 | 1007.2 | 0 | 9.3 | 14.5 | 14.8 | 16.7 | 4.3 | 4.4 | 6.9 | Memenuhi |
| Beban ekstrem | 900 dari 900 | 46.9 | 1042.9 | 0 | 9.1 | 13.3 | 14.3 | 15.8 | 4 | 4.4 | 7.3 | Memenuhi |

## Rincian per putaran

| Putaran | Skenario | Pesan (terkirim) | Lama proses (dtk) | Permintaan | Throughput | Galat | Median | p95 | p99 | ELD p50 | ELD p99 | ELD maks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Tanpa beban notifikasi | 0 (0) | 0 | 16803 | 930.7 | 0 | 10.1 | 15.6 | 18.2 | 0.9 | 4.7 | 11.5 |
| 1 | Beban realistis | 30 (30) | 4.7 | 18222 | 1007.2 | 0 | 9.3 | 14.5 | 16.7 | 0.8 | 4.3 | 6.1 |
| 1 | Beban ekstrem | 300 (300) | 46.9 | 49244 | 1049.1 | 0 | 9.1 | 13 | 15.8 | 0.8 | 4 | 5.8 |
| 2 | Beban realistis | 30 (30) | 4.7 | 18078 | 1002.6 | 0 | 9.3 | 14.8 | 16.8 | 0.8 | 4.4 | 6.3 |
| 2 | Beban ekstrem | 300 (300) | 46.9 | 48975 | 1042.9 | 0 | 9.1 | 13.3 | 15.8 | 0.8 | 3.9 | 7.3 |
| 2 | Tanpa beban notifikasi | 0 (0) | 0 | 19301 | 1070.6 | 0 | 9 | 12.4 | 14.9 | 0.8 | 4.3 | 7.7 |
| 3 | Beban ekstrem | 300 (300) | 47 | 47917 | 1019.3 | 0 | 9.2 | 14.3 | 16.6 | 0.8 | 4.4 | 7.3 |
| 3 | Tanpa beban notifikasi | 0 (0) | 0 | 19132 | 1061.1 | 0 | 9 | 12.9 | 15.6 | 0.7 | 4.2 | 6.5 |
| 3 | Beban realistis | 30 (30) | 4.7 | 19139 | 1060.1 | 0 | 9 | 12.6 | 15.6 | 0.8 | 4.3 | 6.9 |
