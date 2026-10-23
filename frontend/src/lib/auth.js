"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, tokenStore } from "@/lib/api";

const AuthContext = createContext(null);

export const berandaUntuk = (role) => (role === "ADMIN" ? "/admin" : "/sewa");

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
        if (!batal) { setUser(user); setStatus("masuk"); }
      } catch (e) {
        // Hanya 401 yang berarti token tidak berlaku; galat jaringan tidak menghapus sesi
        if (e.status === 401) tokenStore.hapus();
        if (!batal) { setUser(null); setStatus("keluar"); }
      }
    }
    muat();
    return () => { batal = true; };
  }, []);

  const masuk = useCallback(async (email, password) => {
    const res = await api("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
    tokenStore.set(res.token);
    setUser(res.user);
    setStatus("masuk");
    return res.user;
  }, []);

  const daftar = useCallback(async (data) => {
    await api("/api/auth/register", { method: "POST", body: data, auth: false });
    return masuk(data.email, data.password);
  }, [masuk]);

  const keluar = useCallback(() => {
    tokenStore.hapus();
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