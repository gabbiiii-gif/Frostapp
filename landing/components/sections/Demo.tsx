"use client";

import { useState } from "react";
import Image from "next/image";
import * as Tabs from "@radix-ui/react-tabs";
import { AnimatePresence, motion } from "framer-motion";
import { landing } from "@/content/landing";
import { cn } from "@/lib/utils";

export function Demo() {
  const t = landing.demo;
  const [active, setActive] = useState(t.tabs[0].key);
  const current = t.tabs.find((x) => x.key === active) ?? t.tabs[0];

  return (
    <section id="demo" className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-28">
      <div className="max-w-2xl mb-10">
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

      <Tabs.Root value={active} onValueChange={setActive}>
        <Tabs.List className="flex flex-wrap gap-2 mb-6">
          {t.tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.key}
              value={tab.key}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
                active === tab.key
                  ? "bg-accent-cyan/10 border-accent-cyan/40 text-ink"
                  : "bg-white/[0.03] border-white/10 text-ink-muted hover:text-ink hover:border-white/20"
              )}
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="relative rounded-xl2 border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-cyan overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-bg-surface/60">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <span className="ml-3 text-[11px] font-mono text-ink-muted">
              app.frosterp.com.br/{current.key}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={current.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <Image
                src={current.image}
                alt={current.label}
                width={1600}
                height={980}
                className="w-full h-auto"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="mt-5 text-sm text-ink-muted text-center">{current.caption}</p>
      </Tabs.Root>
    </section>
  );
}
