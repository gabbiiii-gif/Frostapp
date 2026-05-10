"use client";

import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { landing } from "@/content/landing";
import { trackEvent } from "@/components/Analytics";

export function FAQ() {
  const t = landing.faq;
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 md:px-8 py-20 md:py-28">
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5 }}
        className="text-[clamp(28px,4vw,44px)] font-bold tracking-tight text-center mb-10"
      >
        {t.title}
      </motion.h2>

      <Accordion
        type="single"
        collapsible
        className="space-y-3"
        onValueChange={(v) => v && trackEvent("faq_open", { item: v })}
      >
        {t.items.map((item, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{item.q}</AccordionTrigger>
            <AccordionContent>{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
