// Pencatat event loop delay (perf_hooks.monitorEventLoopDelay) untuk pengukuran kinerja.
// Hanya aktif bila UKUR_KINERJA=true, sehingga tidak berjalan saat aplikasi dipakai biasa.
const { monitorEventLoopDelay } = require('perf_hooks');

const RESOLUSI_MS = 10;
let histogram = null;

const aktif = () => process.env.UKUR_KINERJA === 'true';

function mulai() {
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: RESOLUSI_MS });
    histogram.enable();
  }
  histogram.reset();
}

// Nilai histogram dalam nanodetik; dikembalikan dalam milidetik
function baca() {
  if (!histogram) return null;
  const ms = (ns) => Math.round(ns / 1e4) / 100;
  return {
    sampel: histogram.count,
    min: ms(histogram.min), rata_rata: ms(histogram.mean),
    p50: ms(histogram.percentile(50)), p95: ms(histogram.percentile(95)), p99: ms(histogram.percentile(99)),
    maks: ms(histogram.max), resolusi_ms: RESOLUSI_MS,
  };
}

module.exports = { aktif, mulai, baca };
