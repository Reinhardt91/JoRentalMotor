// Web App Manifest: membuat aplikasi dapat dipasang di layar utama ponsel
export default function manifest() {
  return {
    name: "Jo Rental Motor",
    short_name: "Jo Rental",
    description: "Pantau masa sewa, perpanjang, dan bayar QRIS dari satu tempat.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "id",
    background_color: "#eef0ec",
    theme_color: "#1d2b33",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
