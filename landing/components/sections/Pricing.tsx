"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { landing } from "@/content/landing";
import { SITE } from "@/lib/utils";
import { trackEvent } from "@/components/Analytics";
import { cn } from "@/lib/utils";

export function Pricing() {
  const t = landing.pricing;
  const [annual, setAnnual] = useState(true);
  const plan = annual ? t.annual : t.monthly;

  return (
    <section id="precos" className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-28">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-[clamp(28px,4vw,44px)] font-bold tracking-tight"
        >
          {t.title}
        </motion.h2>
        <p className="mt-3 text-ink-muted text-lg">{t.subtitle}</p>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <button
          onClick={() => {
            setAnnual(false);
            trackEvent("pricing_toggle", { period: "monthly" });
          }}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all",
            !annual ? "bg-white/10 text-ink" : "text-ink-muted hover:text-ink"
          )}
        >
          {t.monthly.label}
        </button>
        <button
          onClick={() => {
            setAnnual(true);
            trackEvent("pricing_toggle", { period: "annual" });
          }}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
            annual ? "bg-white/10 text-ink" : "text-ink-muted hover:text-ink"
          )}
        >
          {t.annual.label}
          <span className="text-[10px] font-bold uppercase bg-ok/20 text-ok px-2 py-0.5 rounded-full">
            -17%
          </span>
        </button>
      </div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="max-w-xl mx-auto relative"
      >
        <div className="absolute -inset-1 bg-gradient-to-br from-accent-cyan/30 to-accent/30 blur-2xl opacity-60 -z-10" />
        <div className="rounded-2xl border border-white/10 bg-bg-surface/80 backdrop-blur-xl p-8 md:p-10 shadow-cyan">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xl font-semibold tracking-tight">{t.name}</h3>
            {annual && (
              <span className="text-[11px] font-bold uppercase bg-accent-cyan/15 text-accent-cyan2 px-2.5 py-1 rounded-full border border-accent-cyan/30">
                {t.annual.badge}
              </span>
            )}
          </div>

          <div className="flex items-end gap-1 mt-6">
            <span className="font-mono text-5xl md:text-6xl font-bold tracking-tight text-ink">
              {plan.price}
            </span>
            <span className="text-ink-muted text-lg pb-2">{plan.period}</span>
          </div>
          <p className="text-sm text-ink-muted mt-1">{plan.note}</p>

          <ul className="mt-8 space-y-3">
            {t.features.map((f) => (
              <li key={f} className="flex gap-3 text-[15px]">
                <Check className="w-5 h-5 text-ok shrink-0 mt-0.5" />
                <span className="text-ink/90">{f}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-xs text-ink-muted font-mono">{t.addon}</p>

          <Button asChild size="xl" className="w-full mt-8">
            <a
              href={SITE.stripe}
              onClick={() => trackEvent("cta_primary_click", { location: "pricing", period: annual ? "annual" : "monthly" })}
            >
              {t.cta}
              <ArrowRight className="w-4 h-4" />
            </a>
          </Button>

          <p className="mt-4 text-xs text-center text-ink-muted">{t.guarantee}</p>
        </div>
      </motion.div>
    </section>
  );
}
