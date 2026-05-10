"use client";

import { motion } from "framer-motion";
import { Gauge, KanbanSquare, CalendarRange, Wallet, Users, Moon } from "lucide-react";
import { landing } from "@/content/landing";

const iconMap = {
  gauge: Gauge,
  kanban: KanbanSquare,
  calendar: CalendarRange,
  wallet: Wallet,
  users: Users,
  moon: Moon,
} as const;

export function Solution() {
  const t = landing.solution;
  return (
    <section id="solucao" className="mx-auto max-w-7xl px-5 md:px-8 py-20 md:py-28">
      <div className="max-w-2xl">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-[clamp(28px,4vw,44px)] font-bold tracking-tight"
        >
          {t.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-3 text-ink-muted text-lg"
        >
          {t.subtitle}
        </motion.p>
      </div>

      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {t.items.map((item, i) => {
          const Icon = iconMap[item.iconKey as keyof typeof iconMap];
          return (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
              className="group glass rounded-xl2 p-6 hover:-translate-y-1 hover:shadow-cyanHover hover:border-accent-cyan/30 transition-all duration-200"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-cyan/20 to-accent/20 border border-accent-cyan/25 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
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
