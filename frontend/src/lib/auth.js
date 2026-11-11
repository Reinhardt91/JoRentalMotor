"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, tokenStore } from "@/lib/api";

const AuthContext = createContext(null);

export const berandaUntuk = (role) => (role === "ADMIN" ? "/admin" : "/sewa");

// Profil pengguna yang terakhir login disimpan di perangkat, supaya aplikasi tetap dapat dibuka saat offline
const KUNCI_USER = "jo_user";
const profil = {
  simpan(u) { try { localStorage.setItem(KUNCI_USER, JSON.stringify(u)); } catch {} },
  ambil() { try { return JSON.parse(localStorage.getItem(KUNCI_USER)); } catch { return null; } },
  hapus() { try { localStorage.removeItem(KUNCI_USER); } catch {} },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("memuat"); // memuat | masuk | keluar

  // Saat aplikasi dibuka: jika ada token tersimpan, tanyakan siapa pemiliknya
  useEffect(() => {
    let batal = false;
    async function muat() {
      if (!tokenStore.get()) {
        setStatus("keluar");
        return;
      }
      try {
        const { user } = await api("/api/auth/me");
        profil.simpan(user);
        if (!batal) { setUser(user); setStatus("masuk"); }
      } catch (e) {
        // 401: token tidak berlaku, sesi diakhiri
        if (e.status === 401) {
          tokenStore.hapus();
          profil.hapus();
          if (!batal) { setUser(null); setStatus("keluar"); }
          return;
        }
        // Galat jaringan (misalnya offline): pakai profil yang tersimpan agar halaman tetap dapat dibuka
        const tersimpan = profil.ambil();
        if (!batal) {
          if (tersimpan) { setUser(tersimpan); setStatus("masuk"); }
          else { setUser(null); setStatus("keluar"); }
        }
      }
    }
    muat();
    return () => { batal = true; };
  }, []);

  const masuk = useCallback(async (email, password) => {
    const res = await api("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
    tokenStore.set(res.token);
    profil.simpan(res.user);
    setUser(res.user);
    setStatus("masuk");
    return res.user;
  }, []);

  const daftar = useCallback(async (data) => {
    await api("/api/auth/register", { method: "POST", body: data, auth: false });
    return masuk(data.email, data.password);
  }, [masuk]);

  const keluar = useCallback(() => {
    // Hapus data API yang disimpan service worker agar tidak terlihat oleh pengguna berikutnya
    if (typeof caches !== "undefined") {
      caches.keys().then((ks) => ks.filter((k) => k.startsWith("jr-api")).forEach((k) => caches.delete(k))).catch(() => {});
    }
    tokenStore.hapus();
    profil.hapus();
    setUser(null);
    setStatus("keluar");
  }, []);

  return (
    <AuthContext value={{ user, status, masuk, daftar, keluar }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}

// Untuk halaman yang butuh login. Kirim role ("ADMIN" / "PELANGGAN") jika dibatasi.
export function useWajibLogin(role) {
  const { user, status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "keluar") router.replace("/masuk");
    else if (status === "masuk" && role && user.role !== role) router.replace(berandaUntuk(user.role));
  }, [status, user, role, router]);
  return { user, siap: status === "masuk" && (!role || user?.role === role) };
}
