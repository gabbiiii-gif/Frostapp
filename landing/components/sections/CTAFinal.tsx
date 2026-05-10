"use client";

import { motion } from "framer-motion";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";
import { SITE, whatsappLink } from "@/lib/utils";
import { trackEvent } from "@/components/Analytics";

export function CTAFinal() {
  const t = landing.ctaFinal;
  return (
    <section className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.55 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 px-6 md:px-16 py-16 md:py-20 text-center"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-accent/30 via-accent-cyan/20 to-accent-cyan2/30 -z-10" />
        <div className="absolute inset-0 bg-bg-base/50 -z-10" />
        <div className="absolute -inset-x-20 -bottom-20 h-60 bg-accent-cyan/30 blur-3xl -z-10" />

        <h2 className="text-[clamp(30px,4.5vw,52px)] font-bold tracking-tight text-balance max-w-2xl mx-auto">
          {t.title}
        </h2>
        <p className="mt-4 text-ink-muted text-lg max-w-xl mx-auto">{t.subtitle}</p>

        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Button asChild size="xl">
            <a
              href={SITE.stripe}
              onClick={() => trackEvent("cta_primary_click", { location: "cta_final" })}
            >
              {t.primary}
              <ArrowRight className="w-4 h-4" />
            </a>
          </Button>
          <Button asChild size="xl" variant="outline">
            <a
              href={whatsappLink()}
              target="_blank"
              rel="noopener"
              onClick={() => trackEvent("cta_whatsapp_click", { location: "cta_final" })}
            >
              <MessageCircle className="w-4 h-4" />
              {t.secondary}
            </a>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
