import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.universojindama.com"),
  applicationName: "Universo Jindama",
  title: {
    default: "Universo Jindama",
    template: "%s · Universo Jindama",
  },
  description: "Tu negocio. Al siguiente nivel. Todo conectado y bajo control desde un mismo punto.",
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "Universo Jindama",
    url: "/",
    title: "Universo Jindama",
    description: "Tu negocio. Al siguiente nivel. Todo conectado y bajo control desde un mismo punto.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Universo Jindama",
    description: "Tu negocio. Al siguiente nivel. Todo conectado y bajo control desde un mismo punto.",
  },
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
