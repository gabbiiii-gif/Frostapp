// ─── Mapa interativo da cerca do ponto (Leaflet / OpenStreetMap) ─────────────
// Carregado lazy: só baixa o chunk (Leaflet + CSS) quando o admin abre a aba
// "Configurações" do ponto. Sem API key — tiles do OpenStreetMap.
//
// Mostra um pino arrastável (centro da empresa) + círculo do raio. Clicar no
// mapa ou arrastar o pino chama onChangeCenter(lat, lng). O raio vem por prop
// (controlado pelo slider no painel pai).

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Vite serve os PNGs como URL. Sem isto o Leaflet tenta caminhos relativos
// quebrados e o ícone do marcador some (gotcha clássico com bundlers).
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const ICON = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Centro padrão (Brasil) quando ainda não há cerca definida.
const BR_FALLBACK = { lat: -14.235, lng: -51.925, zoom: 4 };

export default function PontoGeofenceMap({ lat, lng, raio_m = 100, onChangeCenter }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  // onChangeCenter pode mudar de identidade a cada render — guarda em ref pra
  // não recriar o mapa nem os listeners.
  const onChangeRef = useRef(onChangeCenter);
  useEffect(() => { onChangeRef.current = onChangeCenter; }, [onChangeCenter]);

  const temCentro = typeof lat === "number" && typeof lng === "number";

  // Inicializa o mapa uma única vez.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const center = temCentro ? [lat, lng] : [BR_FALLBACK.lat, BR_FALLBACK.lng];
    const zoom = temCentro ? 16 : BR_FALLBACK.zoom;

    const map = L.map(containerRef.current, { attributionControl: true }).setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const marker = L.marker(center, { icon: ICON, draggable: true }).addTo(map);
    const circle = L.circle(center, { radius: raio_m, color: "#06b6d4", fillColor: "#06b6d4", fillOpacity: 0.15 }).addTo(map);

    // Arrastar o pino → novo centro.
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      circle.setLatLng(p);
      onChangeRef.current?.(p.lat, p.lng);
    });
    // Clicar no mapa → move o pino pra lá.
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      onChangeRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // Leaflet às vezes calcula o tamanho errado quando o container ainda estava
    // oculto/animando — recalcula no próximo frame.
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  // Só na montagem.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza posição quando lat/lng mudam por fora (ex: botão "usar local atual").
  useEffect(() => {
    if (!mapRef.current || !temCentro) return;
    const p = [lat, lng];
    markerRef.current?.setLatLng(p);
    circleRef.current?.setLatLng(p);
    mapRef.current.setView(p, Math.max(mapRef.current.getZoom(), 16));
  }, [lat, lng, temCentro]);

  // Atualiza o raio do círculo quando o slider muda.
  useEffect(() => {
    if (circleRef.current && typeof raio_m === "number") {
      circleRef.current.setRadius(raio_m);
    }
  }, [raio_m]);

  return (
    <div
      ref={containerRef}
      className="w-full h-72 rounded-lg overflow-hidden border border-gray-700"
      style={{ background: "#1f2937" }}
    />
  );
}
