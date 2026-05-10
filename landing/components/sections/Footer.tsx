import { Logo } from "@/components/Logo";
import { landing } from "@/content/landing";
import { ShieldCheck } from "lucide-react";

export function Footer() {
  const t = landing.footer;
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/10 bg-bg-surface/50 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-14">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <Logo />
            <p className="mt-3 text-sm text-ink-muted max-w-xs">{t.tagline}</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-ink-muted">
              <ShieldCheck className="w-4 h-4 text-ok" />
              Pagamento seguro via Stripe
            </div>
            <div className="mt-3 flex gap-2 text-[10px] font-mono text-ink-muted">
              <span className="px-2 py-1 rounded border border-white/10">VISA</span>
              <span className="px-2 py-1 rounded border border-white/10">MASTERCARD</span>
              <span className="px-2 py-1 rounded border border-white/10">ELO</span>
              <span className="px-2 py-1 rounded border border-white/10">AMEX</span>
            </div>
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-8">
            {t.columns.map((col) => (
              <div key={col.title}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-3">
                  {col.title}
                </h4>
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        className="text-sm text-ink/80 hover:text-ink transition"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 text-xs text-ink-muted leading-relaxed">
          <p>FrostERP — CNPJ {t.legal.cnpj}</p>
          <p>{t.legal.address}</p>
          <p className="mt-3">© {year} FrostERP. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
