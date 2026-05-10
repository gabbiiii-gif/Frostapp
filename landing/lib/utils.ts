import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SITE = {
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://frosterp.com.br",
  stripe: process.env.NEXT_PUBLIC_STRIPE_URL || "#",
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "5593984166832",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "suportefrosterp@gmail.com",
};

export const whatsappLink = (msg = "Olá! Quero saber mais sobre o FrostERP.") =>
  `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(msg)}`;
