import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { JsonLd } from "@/components/JsonLd";
import { Analytics } from "@/components/Analytics";
import { SITE } from "@/lib/utils";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: "FrostERP — Sistema de Gestão para Refrigeração e Climatização",
  description:
    "Gerencie ordens de serviço, agenda, financeiro e estoque em um só sistema. R$ 59,90/mês. 7 dias grátis. Sem fidelidade.",
  openGraph: {
    title: "FrostERP — Sistema de Gestão para Refrigeração e Climatização",
    description:
      "Gerencie ordens de serviço, agenda, financeiro e estoque em um só sistema. R$ 59,90/mês. 7 dias grátis. Sem fidelidade.",
    url: SITE.url,
    siteName: "FrostERP",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/screenshots/dashboard.webp",
        width: 1200,
        height: 630,
        alt: "Dashboard do FrostERP",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FrostERP — Sistema de Gestão para Refrigeração e Climatização",
    description:
      "Gestão de OS, agenda, financeiro e estoque. R$ 59,90/mês. 7 dias grátis.",
    images: ["/screenshots/dashboard.webp"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0A1628",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-bg-base text-ink antialiased">
        {children}
        <JsonLd />
        <Analytics />
      </body>
    </html>
  );
}
