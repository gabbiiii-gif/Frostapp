"use client";

import { motion } from "framer-motion";
import { MessageSquareWarning, Receipt, PackageX } from "lucide-react";
import { landing } from "@/content/landing";

const icons = [MessageSquareWarning, Receipt, PackageX];

export function Pain() {
  const t = landing.pain;
  return (
    <section className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-28">
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5 }}
        className="text-[clamp(28px,4vw,44px)] font-bold tracking-tight max-w-2xl"
      >
        {t.title}
      </motion.h2>

      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {t.items.map((item, i) => {
          const Icon = icons[i];
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="glass rounded-xl2 p-6 hover:-translate-y-1 hover:border-accent-cyan/30 transition-all duration-200"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-cyan/15 to-accent/15 border border-accent-cyan/20 flex items-center justify-center mb-5">
                <Icon className="w-5 h-5 text-accent-cyan2" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-ink-muted leading-relaxed">{item.body}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
