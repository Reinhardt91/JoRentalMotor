-- =====================================================================
-- schema.sql (versi 2) : Skema database Sistem Perpanjangan Sewa Jo Rental Motor
-- DBMS   : PostgreSQL (butuh ekstensi btree_gist, sudah termasuk paket standar)
-- Sumber : ERD revisi (Gambar 3.3), 11 tabel
--
-- Aturan inti yang dijaga langsung oleh basis data:
--   1. Jadwal unit tidak boleh bertumpang tindih (EXCLUDE USING gist pada reservasi aktif)
--   2. Hanya satu perpanjangan berstatus MENUNGGU_PEMBAYARAN per sewa (anti klik ganda)
--   3. order_id pembayaran unik (kunci idempotency)
--   4. Pengingat H-1/H-0 tidak boleh ganda per sewa, jenis, dan tanggal
--   5. sewa.version untuk Optimistic Locking (dinaikkan oleh aplikasi saat perubahan tersimpan)
--
-- Aman dijalankan berulang kali, TETAPI menghapus semua data lama.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Waktu dinding mengikuti lokasi usaha (Manado, WITA)
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Makassar');
END $$;

-- ---------- Bersihkan (anak dulu, induk kemudian) ----------
DROP TABLE IF EXISTS notifikasi_whatsapp  CASCADE;
DROP TABLE IF EXISTS scheduler_log        CASCADE;
DROP TABLE IF EXISTS webhook_log          CASCADE;
DROP TABLE IF EXISTS pembayaran           CASCADE;
DROP TABLE IF EXISTS perpanjangan_sewa    CASCADE;
DROP TABLE IF EXISTS sewa                 CASCADE;
DROP TABLE IF EXISTS reservasi            CASCADE;
DROP TABLE IF EXISTS motor                CASCADE;
DROP TABLE IF EXISTS tipe_motor           CASCADE;
DROP TABLE IF EXISTS pelanggan            CASCADE;
DROP TABLE IF EXISTS users                CASCADE;

DROP TYPE IF EXISTS role_pengguna, jenis_transmisi, status_unit, kondisi_unit, metode_serah,
  status_reservasi, status_sewa, status_perpanjangan, status_transaksi,
  hasil_webhook, jenis_notifikasi, status_kirim, status_job CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- ---------- Tipe ENUM ----------
CREATE TYPE role_pengguna       AS ENUM ('ADMIN', 'PELANGGAN');
CREATE TYPE jenis_transmisi     AS ENUM ('MATIC', 'MANUAL', 'KOPLING');
CREATE TYPE kondisi_unit        AS ENUM ('SIAP', 'PERBAIKAN', 'TIDAK_TERSEDIA');
CREATE TYPE metode_serah        AS ENUM ('AMBIL', 'ANTAR');
CREATE TYPE status_reservasi    AS ENUM ('MENUNGGU', 'DIKONFIRMASI', 'DIBATALKAN', 'SELESAI');
CREATE TYPE status_sewa         AS ENUM ('AKTIF', 'TERLAMBAT', 'SELESAI');
CREATE TYPE status_perpanjangan AS ENUM ('MENUNGGU_PEMBAYARAN', 'LUNAS', 'GAGAL', 'KEDALUWARSA', 'LUNAS_PERLU_TINDAKAN', 'DITANGANI');
CREATE TYPE status_transaksi    AS ENUM ('PENDING', 'SETTLEMENT', 'EXPIRE', 'CANCEL', 'DENY');
CREATE TYPE hasil_webhook       AS ENUM ('DITERIMA', 'DIPROSES', 'DITOLAK_SIGNATURE', 'DITOLAK_DATA', 'DUPLIKAT_DIABAIKAN', 'GAGAL');
CREATE TYPE jenis_notifikasi    AS ENUM ('PENGINGAT_H1', 'PENGINGAT_H0', 'KONFIRMASI_PERPANJANGAN');
CREATE TYPE status_kirim        AS ENUM ('PENDING', 'TERKIRIM', 'GAGAL');
CREATE TYPE status_job          AS ENUM ('BERJALAN', 'SELESAI', 'GAGAL');

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. AKUN & PENGGUNA
-- =====================================================================
CREATE TABLE users (
  id_user        SERIAL        PRIMARY KEY,
  email          VARCHAR(100)  NOT NULL UNIQUE,
  password_hash  VARCHAR(255)  NOT NULL,
  role           role_pengguna NOT NULL DEFAULT 'PELANGGAN',
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE TABLE pelanggan (
  id_pelanggan   SERIAL        PRIMARY KEY,
  id_user        INT           NOT NULL UNIQUE REFERENCES users(id_user) ON DELETE CASCADE,
  nama_lengkap   VARCHAR(100)  NOT NULL,
  no_whatsapp    VARCHAR(20)   NOT NULL,
  no_ktp         VARCHAR(16)   NOT NULL UNIQUE,
  foto_ktp       VARCHAR(255),
  foto_sim       VARCHAR(255),
  asal_daerah    VARCHAR(100),
  created_at     TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 2. ARMADA MOTOR (kondisi fisik saja; ketersediaan diturunkan dari jadwal)
-- =====================================================================
CREATE TABLE tipe_motor (
  id_tipe          SERIAL          PRIMARY KEY,
  merek            VARCHAR(50)     NOT NULL,
  nama_model       VARCHAR(50)     NOT NULL,
  jenis_transmisi  jenis_transmisi NOT NULL,
  kapasitas_cc     INT             NOT NULL CHECK (kapasitas_cc > 0),
  harga_harian     DECIMAL(12,2)   NOT NULL CHECK (harga_harian >= 0),
  harga_mingguan   DECIMAL(12,2)   CHECK (harga_mingguan >= 0),
  UNIQUE (merek, nama_model)
);

CREATE TABLE motor (
  id_motor        SERIAL        PRIMARY KEY,
  id_tipe         INT           NOT NULL REFERENCES tipe_motor(id_tipe),
  plat_nomor      VARCHAR(15)   NOT NULL UNIQUE,
  warna           VARCHAR(30),
  tahun_produksi  INT           CHECK (tahun_produksi BETWEEN 1990 AND 2100),
  kondisi_unit    kondisi_unit  NOT NULL DEFAULT 'SIAP',
  foto_url        VARCHAR(255),
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 3. TRANSAKSI SEWA
-- =====================================================================
-- reservasi = satu-satunya sumber jadwal unit. Jatuh tempo sewa = tanggal_selesai.
CREATE TABLE reservasi (
  id_reservasi      SERIAL            PRIMARY KEY,
  id_pelanggan      INT               NOT NULL REFERENCES pelanggan(id_pelanggan),
  id_motor          INT               NOT NULL REFERENCES motor(id_motor),
  tanggal_mulai     TIMESTAMP         NOT NULL,
  tanggal_selesai   TIMESTAMP         NOT NULL,
  metode_serah      metode_serah      NOT NULL DEFAULT 'AMBIL',
  lokasi_serah      VARCHAR(255),
  total_biaya       DECIMAL(12,2)     NOT NULL CHECK (total_biaya >= 0),
  status_reservasi  status_reservasi  NOT NULL DEFAULT 'MENUNGGU',
  created_at        TIMESTAMP         NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP         NOT NULL DEFAULT NOW(),
  CHECK (tanggal_selesai > tanggal_mulai),
  -- Tidak boleh ada dua reservasi aktif yang periodenya bertumpang tindih pada unit yang sama.
  -- Rentang setengah terbuka [mulai, selesai): reservasi yang berakhir pukul X boleh disusul yang mulai pukul X.
  CONSTRAINT reservasi_tanpa_overlap
    EXCLUDE USING gist (id_motor WITH =, tsrange(tanggal_mulai, tanggal_selesai, '[)') WITH &&)
    WHERE (status_reservasi IN ('MENUNGGU', 'DIKONFIRMASI'))
);

-- sewa = pelaksanaan: dibuat admin dari reservasi terkonfirmasi saat serah terima
CREATE TABLE sewa (
  id_sewa          SERIAL       PRIMARY KEY,
  id_reservasi     INT          NOT NULL UNIQUE REFERENCES reservasi(id_reservasi),
  tanggal_serah    TIMESTAMP    NOT NULL,
  tanggal_kembali  TIMESTAMP,
  status_sewa      status_sewa  NOT NULL DEFAULT 'AKTIF',
  version          INT          NOT NULL DEFAULT 0,   -- Optimistic Locking
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE perpanjangan_sewa (
  id_perpanjangan      SERIAL               PRIMARY KEY,
  id_sewa              INT                  NOT NULL REFERENCES sewa(id_sewa),
  ditangani_oleh       INT                  REFERENCES users(id_user),   -- admin; hanya terisi pada perpanjangan bermasalah
  jatuh_tempo_lama     TIMESTAMP            NOT NULL,
  jatuh_tempo_baru     TIMESTAMP            NOT NULL,
  tambahan_hari        INT                  NOT NULL CHECK (tambahan_hari > 0),
  biaya_perpanjangan   DECIMAL(12,2)        NOT NULL CHECK (biaya_perpanjangan >= 0),
  status_perpanjangan  status_perpanjangan  NOT NULL DEFAULT 'MENUNGGU_PEMBAYARAN',
  ditangani_pada       TIMESTAMP,
  catatan_penanganan   TEXT,
  created_at           TIMESTAMP            NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP            NOT NULL DEFAULT NOW(),
  CHECK (jatuh_tempo_baru > jatuh_tempo_lama)
);

-- Anti klik ganda / dua tab: satu perpanjangan menunggu pembayaran per sewa
CREATE UNIQUE INDEX uq_perpanjangan_menunggu
  ON perpanjangan_sewa (id_sewa) WHERE status_perpanjangan = 'MENUNGGU_PEMBAYARAN';

-- =====================================================================
-- 4. PEMBAYARAN & WEBHOOK
-- =====================================================================
CREATE TABLE pembayaran (
  id_pembayaran            SERIAL           PRIMARY KEY,
  id_perpanjangan          INT              NOT NULL REFERENCES perpanjangan_sewa(id_perpanjangan),
  order_id                 VARCHAR(50)      NOT NULL UNIQUE,   -- kunci idempotency
  transaction_id           VARCHAR(50),
  payment_type             VARCHAR(20)      NOT NULL DEFAULT 'qris',
  gross_amount             DECIMAL(12,2)    NOT NULL CHECK (gross_amount >= 0),
  transaction_status       status_transaksi NOT NULL DEFAULT 'PENDING',
  fraud_status             VARCHAR(20),
  qr_url                   TEXT,
  is_processed             BOOLEAN          NOT NULL DEFAULT FALSE,
  transaction_time         TIMESTAMP,
  settlement_time          TIMESTAMP,
  expiry_time              TIMESTAMP,
  terakhir_direkonsiliasi  TIMESTAMP,
  created_at               TIMESTAMP        NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP        NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_log (
  id_webhook          SERIAL         PRIMARY KEY,
  id_pembayaran       INT            REFERENCES pembayaran(id_pembayaran) ON DELETE SET NULL,
  order_id            VARCHAR(50),
  status_code         VARCHAR(5),
  transaction_status  VARCHAR(20),
  gross_amount        VARCHAR(20),
  signature_key       VARCHAR(128),
  signature_valid     BOOLEAN        NOT NULL DEFAULT FALSE,
  hasil_proses        hasil_webhook  NOT NULL DEFAULT 'DITERIMA',
  jumlah_percobaan    INT            NOT NULL DEFAULT 0,
  raw_payload         JSONB,
  error_message       TEXT,
  received_at         TIMESTAMP      NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMP
);

-- =====================================================================
-- 5. NOTIFIKASI WHATSAPP & SCHEDULER
-- =====================================================================
CREATE TABLE scheduler_log (
  id_scheduler_log  SERIAL      PRIMARY KEY,
  nama_job          VARCHAR(50) NOT NULL,
  cakupan_dari      TIMESTAMP,                 -- jendela waktu yang diproses (untuk pemulihan jadwal terlewat)
  cakupan_sampai    TIMESTAMP,
  waktu_mulai       TIMESTAMP   NOT NULL DEFAULT NOW(),
  waktu_selesai     TIMESTAMP,
  status_job        status_job  NOT NULL DEFAULT 'BERJALAN',
  jumlah_diproses   INT         NOT NULL DEFAULT 0,
  jumlah_berhasil   INT         NOT NULL DEFAULT 0,
  jumlah_gagal      INT         NOT NULL DEFAULT 0,
  error_message     TEXT
);

-- Antrean sekaligus log pesan (antrean ada di basis data, tidak hilang saat server mati)
CREATE TABLE notifikasi_whatsapp (
  id_notifikasi      SERIAL            PRIMARY KEY,
  id_sewa            INT               NOT NULL REFERENCES sewa(id_sewa),
  id_perpanjangan    INT               REFERENCES perpanjangan_sewa(id_perpanjangan),
  id_scheduler_log   INT               REFERENCES scheduler_log(id_scheduler_log),
  jenis_notifikasi   jenis_notifikasi  NOT NULL,
  no_tujuan          VARCHAR(20)       NOT NULL,
  isi_pesan          TEXT              NOT NULL,
  tanggal_jadwal     DATE              NOT NULL,
  status_kirim       status_kirim      NOT NULL DEFAULT 'PENDING',
  fonnte_response    TEXT,
  error_message      TEXT,
  jumlah_percobaan   INT               NOT NULL DEFAULT 0,
  coba_lagi_pada     TIMESTAMP,
  dikirim_pada       TIMESTAMP,
  created_at         TIMESTAMP         NOT NULL DEFAULT NOW()
);

-- Pengingat yang sama tidak boleh terkirim dua kali untuk satu sewa pada hari yang sama
CREATE UNIQUE INDEX uq_pengingat_per_hari
  ON notifikasi_whatsapp (id_sewa, jenis_notifikasi, tanggal_jadwal)
  WHERE jenis_notifikasi IN ('PENGINGAT_H1', 'PENGINGAT_H0');

-- =====================================================================
-- INDEKS
-- =====================================================================
CREATE INDEX idx_motor_tipe            ON motor (id_tipe);
CREATE INDEX idx_reservasi_pelanggan   ON reservasi (id_pelanggan);
CREATE INDEX idx_reservasi_selesai     ON reservasi (tanggal_selesai) WHERE status_reservasi = 'DIKONFIRMASI';
CREATE INDEX idx_sewa_aktif            ON sewa (status_sewa) WHERE status_sewa IN ('AKTIF', 'TERLAMBAT');
CREATE INDEX idx_perpanjangan_sewa     ON perpanjangan_sewa (id_sewa);
CREATE INDEX idx_perpanjangan_status   ON perpanjangan_sewa (status_perpanjangan) WHERE status_perpanjangan = 'LUNAS_PERLU_TINDAKAN';
CREATE INDEX idx_pembayaran_perpj      ON pembayaran (id_perpanjangan);
CREATE INDEX idx_pembayaran_pending    ON pembayaran (created_at) WHERE transaction_status = 'PENDING';
CREATE INDEX idx_webhook_pembayaran    ON webhook_log (id_pembayaran);
CREATE INDEX idx_webhook_order         ON webhook_log (order_id);
CREATE INDEX idx_webhook_belum_proses  ON webhook_log (received_at) WHERE hasil_proses IN ('DITERIMA', 'GAGAL');
CREATE INDEX idx_notif_sewa            ON notifikasi_whatsapp (id_sewa);
CREATE INDEX idx_notif_antrean         ON notifikasi_whatsapp (coba_lagi_pada) WHERE status_kirim = 'PENDING';
CREATE INDEX idx_notif_gagal           ON notifikasi_whatsapp (created_at) WHERE status_kirim = 'GAGAL';

-- =====================================================================
-- TRIGGER updated_at (kolom version pada sewa TIDAK diubah di sini; itu tugas aplikasi)
-- =====================================================================
CREATE TRIGGER trg_users_updated        BEFORE UPDATE ON users              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_motor_updated        BEFORE UPDATE ON motor              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_reservasi_updated    BEFORE UPDATE ON reservasi          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sewa_updated         BEFORE UPDATE ON sewa               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_perpanjangan_updated BEFORE UPDATE ON perpanjangan_sewa  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pembayaran_updated   BEFORE UPDATE ON pembayaran         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
