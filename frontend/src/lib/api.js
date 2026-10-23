// Pemanggil API backend. Semua halaman memakai fungsi ini.
const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const KUNCI_TOKEN = "jo_token";

export class ApiError extends Error {
  constructor(pesan, status, galat) {
    super(pesan);
    this.status = status;
    this.galat = galat || [];
  }
}

export const tokenStore = {
  get() {
    try { return localStorage.getItem(KUNCI_TOKEN); } catch { return null; }
  },
  set(token) {
    try { localStorage.setItem(KUNCI_TOKEN, token); } catch {}
  },
  hapus() {
    try { localStorage.removeItem(KUNCI_TOKEN); } catch {}
  },
};

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.", 0);
  }

  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new ApiError(data?.pesan || "Terjadi kesalahan.", res.status, data?.galat);
  return data;
}
