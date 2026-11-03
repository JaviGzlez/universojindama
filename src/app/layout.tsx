import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Universo Jindama",
    template: "%s · Universo Jindama",
  },
  description: "Tu negocio. Al siguiente nivel. Todo conectado y bajo control desde un mismo punto.",
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
