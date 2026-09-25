// Splash de marca, estático. Mesmo markup do placeholder que fica dentro de
// <div id="root"> no index.html — o CSS (.fr-splash*) mora inline no
// index.html para pintar antes de o JS carregar. Se mudar um, mude o outro.
//
// O wordmark é texto HTML com fonte do sistema (não <text> em SVG nem fonte
// web): renderiza no primeiro paint, sem esperar fonte nem animação. Ele é o
// elemento de LCP da abertura, então nunca pode começar com opacity 0.
// Aqui o floco não repete a entrada animada do placeholder (modificador
// --estatico), senão ela "recomeçaria" quando o React assume a tela.
import React from "react";
import { FlocoSVG } from "./AnimatedSnowflake.jsx";

export default function BrandSplash() {
  return (
    <div className="fr-splash fr-splash--estatico" role="status" aria-label="Carregando o FrostERP">
      <FlocoSVG className="fr-splash-floco" title="FrostERP" />
      <h1 className="fr-splash-word">FROST<span>ERP</span></h1>
      <hr className="fr-splash-rule" />
      <p className="fr-splash-tag">REFRIGERAÇÕES</p>
    </div>
  );
}
