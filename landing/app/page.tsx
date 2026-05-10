import { Hero } from "@/components/sections/Hero";
import { Pain } from "@/components/sections/Pain";
import { Solution } from "@/components/sections/Solution";
import { Demo } from "@/components/sections/Demo";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { CTAFinal } from "@/components/sections/CTAFinal";
import { Footer } from "@/components/sections/Footer";
import { FloatingWhatsApp } from "@/components/sections/FloatingWhatsApp";

export default function Page() {
  return (
    <main className="relative">
      <Hero />
      <Pain />
      <Solution />
      <Demo />
      <Pricing />
      <FAQ />
      <CTAFinal />
      <Footer />
      <FloatingWhatsApp />
    </main>
  );
}
