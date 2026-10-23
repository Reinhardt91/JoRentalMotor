import "@fontsource-variable/figtree";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "Jo Rental Motor",
  description: "Pantau masa sewa, perpanjang, dan bayar QRIS dari satu tempat.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d2b33",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
