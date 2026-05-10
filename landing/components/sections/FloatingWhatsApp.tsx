"use client";

import { useEffect, useRef } from "react";
import anime from "animejs";
import { whatsappLink } from "@/lib/utils";
import { trackEvent } from "@/components/Analytics";

export function FloatingWhatsApp() {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const tl = anime({
      targets: ref.current,
      scale: [1, 1.08, 1],
      duration: 600,
      easing: "easeInOutQuad",
      loop: true,
      delay: 8000,
      endDelay: 0,
    });
    return () => tl.pause();
  }, []);

  return (
    <a
      ref={ref}
      href={whatsappLink()}
      target="_blank"
      rel="noopener"
      aria-label="Falar no WhatsApp"
      onClick={() => trackEvent("cta_whatsapp_click", { location: "floating" })}
      className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-2xl shadow-[#25D366]/30 transition-shadow hover:shadow-[#25D366]/60"
      style={{ background: "#25D366" }}
    >
      <svg viewBox="0 0 32 32" className="w-7 h-7" fill="white" aria-hidden="true">
        <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 0 1-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 0 1-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.09-.832-2.335-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.06 2.264v.114c-.015.99.472 1.977 1.017 2.78 1.23 1.82 2.506 3.41 4.554 4.34.616.287 2.035 1.018 2.722 1.018.515 0 1.69-.302 2.092-.987.158-.27.302-.555.302-.86 0-.246-1.118-.876-1.376-1.005-.114-.057-.61-.328-.776-.328z" />
        <path d="M16.005 2.667C8.643 2.667 2.667 8.643 2.667 16c0 2.518.69 4.945 2.012 7.067L2.667 29.333l6.466-2.012a13.27 13.27 0 0 0 6.872 1.901c7.357 0 13.333-5.976 13.333-13.333S23.362 2.667 16.005 2.667zm0 24.466a11.13 11.13 0 0 1-5.65-1.541l-.4-.243-4.2 1.31 1.34-4.094-.262-.42a11.07 11.07 0 0 1-1.7-5.91c0-6.13 4.973-11.103 11.103-11.103 6.13 0 11.103 4.973 11.103 11.103S22.135 27.133 16.005 27.133z" />
      </svg>
    </a>
  );
}
