"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { landing } from "@/content/landing";
import { SITE, whatsappLink } from "@/lib/utils";
import { trackEvent } from "@/components/Analytics";
import { ArrowRight, MessageCircle } from "lucide-react";

const fade = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export function Hero() {
  const t = landing.hero;
  return (
    <section className="relative overflow-hidden">
      {/* Nav */}
      <div className="mx-auto max-w-7xl px-5 md:px-8 pt-6 flex items-center justify-between">
        <Logo />
        <nav className="hidden md:flex items-center gap-8 text-sm text-ink-muted">
          <a href="#solucao" className="hover:text-ink transition">Recursos</a>
          <a href="#demo" className="hover:text-ink transition">Demo</a>
          <a href="#precos" className="hover:text-ink transition">Preços</a>
          <a href="#faq" className="hover:text-ink transition">FAQ</a>
        </nav>
        <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
          <a href={SITE.stripe} onClick={() => trackEvent("cta_primary_click", { location: "nav" })}>
            Entrar
          </a>
        </Button>
      </div>

      {/* Hero core */}
      <div className="mx-auto max-w-7xl px-5 md:px-8 pt-14 md:pt-20 pb-16 md:pb-24 grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          className="lg:col-span-6"
        >
          <motion.div variants={fade} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-ink-muted mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
            Já em produção em Altamira/PA
          </motion.div>

          <motion.h1
            variants={fade}
            className="text-balance font-bold tracking-tight leading-[1.05] text-[clamp(40px,6vw,72px)]"
          >
            {t.headline}
          </motion.h1>

          <motion.p
            variants={fade}
            className="mt-6 text-pretty text-ink-muted text-[17px] md:text-lg leading-relaxed max-w-xl"
          >
            {t.subheadline}
          </motion.p>

          <motion.div variants={fade} className="mt-8 flex flex-col sm:flex-row gap-3">
            <Button asChild size="lg">
              <a
                href={SITE.stripe}
                onClick={() => trackEvent("cta_primary_click", { location: "hero" })}
              >
                {t.ctaPrimary}
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noopener"
                onClick={() => trackEvent("cta_whatsapp_click", { location: "hero" })}
              >
                <MessageCircle className="h-4 w-4" />
                {t.ctaSecondary}
              </a>
            </Button>
          </motion.div>

          <motion.p variants={fade} className="mt-6 text-sm text-ink-muted max-w-md">
            {t.proof}
          </motion.p>
        </motion.div>

        {/* Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 24, rotateX: 8, rotateY: -6 }}
          animate={{ opacity: 1, y: 0, rotateX: 4, rotateY: -4 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          className="lg:col-span-6 [perspective:1400px]"
        >
          <div className="relative rounded-xl2 border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-cyan overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-bg-surface/60">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
              <span className="ml-3 text-[11px] font-mono text-ink-muted">app.frosterp.com.br/dashboard</span>
            </div>
            <Image
              src="/screenshots/dashboard.webp"
              alt="Dashboard do FrostERP"
              width={1600}
              height={980}
              priority
              className="w-full h-auto"
            />
          </div>
          <div className="absolute -inset-x-12 -bottom-10 h-32 bg-gradient-to-t from-accent-cyan/20 to-transparent blur-3xl -z-10" />
        </motion.div>
      </div>
    </section>
  );
}
