import { SITE } from "@/lib/utils";

export function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FrostERP",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Sistema de gestão integrada para empresas de refrigeração e climatização: ordens de serviço, agenda, financeiro, cadastros e estoque.",
    offers: {
      "@type": "Offer",
      price: "59.90",
      priceCurrency: "BRL",
      url: SITE.stripe,
    },
    publisher: {
      "@type": "Organization",
      name: "FrostERP",
      email: SITE.supportEmail,
      address: {
        "@type": "PostalAddress",
        streetAddress: "Avenida João Coelho, 1896",
        addressLocality: "Altamira",
        addressRegion: "PA",
        postalCode: "68375-049",
        addressCountry: "BR",
      },
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
