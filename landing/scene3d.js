// scene3d.js — Cristal de gelo refrativo + partículas de neve (three.js)
// Exposto em window.frostScene para o scroll.js controlar.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const PALETTES = {
  frost:   { core: 0x9fe9ff, atten: 0x22d3ee, edge: 0xbdeeff, lightA: 0x22d3ee, lightB: 0x3b82f6 },
  arctic:  { core: 0xcfeaff, atten: 0x6cb4f0, edge: 0xe6f6ff, lightA: 0x7dd3fc, lightB: 0x2563eb },
  glacier: { core: 0xa7f3d0, atten: 0x22d3ee, edge: 0xd1fae5, lightA: 0x34d399, lightB: 0x06b6d4 },
};

const state = {
  scroll: 0,        // 0..1 progresso total
  targetX: 0,       // deslocamento horizontal alvo (balanço com o texto)
  targetTwist: 0,   // ênfase extra por seção
  intensity: 0.6,   // 0..1
  particles: true,
  palette: "frost",
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  mobile: window.matchMedia("(max-width: 760px), (pointer: coarse)").matches,
  balanceScale: 1, // fator responsivo: encolhe o balanço lateral em telas estreitas
  fitScale: 1,     // fator responsivo: encolhe o modelo em retrato pra não cortar
};

let renderer, scene, camera, group, crystal, core, edges, points, pmrem, envRT;
let model = null;          // floco de neve (.glb) — substitui o cristal quando carrega
let iceMat = null;         // material de gelo compartilhado aplicado ao modelo
let burst = null;          // nuvem de cacos da explosão no footer
let bvel = null;           // velocidades dos cacos
let exploding = false;     // explosão em andamento
let exploded = false;      // já explodiu (trava re-disparo até resetar)
let eStart = 0;            // instante (clock) em que a explosão começou
const BN = 1300;           // qtd de cacos
const EXPLODE_T = 2.0;     // duração da explosão (s)
const ICE_OPACITY = 0.75;  // opacidade geral do floco
let raf = 0;
const clock = new THREE.Clock();
let curX = 0, curScroll = 0, curTwist = 0;

function makeEnv() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#05101d");
  g.addColorStop(0.45, "#0a2540");
  g.addColorStop(0.72, "#15a3c7");
  g.addColorStop(1.0, "#2f6fe0");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  // luzes pontuais brilhantes pra dar highlights na refração
  const blobs = [[120, 70, 70, "rgba(180,245,255,0.9)"], [380, 60, 90, "rgba(120,200,255,0.7)"], [260, 200, 60, "rgba(80,140,255,0.5)"]];
  for (const [x, y, r, col] of blobs) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 512, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  envRT = pmrem.fromEquirectangular(tex);
  tex.dispose();
  return envRT.texture;
}

function sprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(190,238,255,0.85)");
  g.addColorStop(1, "rgba(190,238,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 32, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function applyPalette() {
  const p = PALETTES[state.palette] || PALETTES.frost;
  if (crystal) {
    crystal.material.color.setHex(p.core);
    crystal.material.attenuationColor.setHex(p.atten);
  }
  if (edges) edges.material.color.setHex(p.edge);
  if (core) core.material.color.setHex(p.atten);
  if (iceMat) {
    iceMat.color.setHex(p.core);
    iceMat.attenuationColor.setHex(p.atten);
  }
  if (scene) {
    scene.userData.lightA.color.setHex(p.lightA);
    scene.userData.lightB.color.setHex(p.lightB);
  }
}

function loadModel() {
  // material de gelo refrativo aplicado ao floco — espelha o cristal procedural
  iceMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fe9ff,
    transmission: 0.75,   // transparência 75% (era 1 = totalmente transparente)
    opacity: ICE_OPACITY, // opacidade geral 75%
    thickness: 1.2,
    roughness: 0.08,
    metalness: 0,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    attenuationColor: new THREE.Color(0x22d3ee),
    attenuationDistance: 1.8,
    envMapIntensity: 1.6,
    transparent: true,
    side: THREE.DoubleSide,
  });

  // mobile: sem transmission (remove o render-pass extra — principal causa do scroll travado).
  // Vira gelo fosco/refletivo, bem mais leve, mantendo o brilho do envMap.
  if (state.mobile) {
    iceMat.transmission = 0;
    iceMat.thickness = 0;
    iceMat.opacity = 0.9;
    iceMat.roughness = 0.16;
    iceMat.side = THREE.FrontSide;   // metade dos triângulos desenhados
  }

  const loader = new GLTFLoader();
  loader.load(
    "snowflake.glb",
    (gltf) => {
      const m = gltf.scene;
      m.traverse((o) => {
        if (o.isMesh) {
          o.material = iceMat;
          o.castShadow = o.receiveShadow = false;
        }
      });

      // centraliza na origem e escala pra caber (~3.4 de altura no eixo maior)
      const box = new THREE.Box3().setFromObject(m);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      m.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      m.scale.setScalar(3.4 / maxDim);

      const holder = new THREE.Group();
      holder.add(m);
      group.add(holder);
      model = holder;

      // some com o cristal procedural — floco assume o palco
      if (crystal) crystal.visible = false;
      if (core) core.visible = false;
      if (edges) edges.visible = false;

      applyPalette();
    },
    undefined,
    (err) => console.error("GLB falhou — mantendo cristal procedural", err)
  );
}

export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // mobile: limita pixelRatio (transmission renderiza buffer extra por frame — caro em retina)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.mobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = makeEnv();

  group = new THREE.Group();
  scene.add(group);

  // Cristal facetado (gelo lapidado)
  const geo = new THREE.IcosahedronGeometry(1.55, 0);
  const mat = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    thickness: 2.2,
    roughness: 0.06,
    metalness: 0,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    attenuationDistance: 2.6,
    envMapIntensity: 1.5,
    transparent: true,
    flatShading: true,
  });
  crystal = new THREE.Mesh(geo, mat);
  crystal.scale.set(1, 1.32, 1);
  group.add(crystal);

  // Núcleo emissivo (brilho interno mesmo sem refração forte)
  const coreGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
  core = new THREE.Mesh(coreGeo, coreMat);
  core.scale.set(1, 1.32, 1);
  group.add(core);

  // Arestas (linhas frias)
  edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 })
  );
  edges.scale.copy(crystal.scale);
  group.add(edges);

  // Luzes
  const amb = new THREE.AmbientLight(0x335577, 0.6);
  const lA = new THREE.PointLight(0x22d3ee, 60, 30);
  lA.position.set(4, 3, 5);
  const lB = new THREE.PointLight(0x3b82f6, 50, 30);
  lB.position.set(-5, -2, 3);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 5, 4);
  scene.add(amb, lA, lB, key);
  scene.userData.lightA = lA;
  scene.userData.lightB = lB;

  // Partículas de neve
  const N = state.mobile ? 220 : 520;   // menos neve no celular
  const pos = new Float32Array(N * 3);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
    spd[i] = 0.15 + Math.random() * 0.5;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pgeo.userData.spd = spd;
  const pmat = new THREE.PointsMaterial({
    size: 0.075,
    map: sprite(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xcdeeff,
  });
  points = new THREE.Points(pgeo, pmat);
  scene.add(points);

  // Cacos da explosão (escondidos até o footer) — filhos do group p/ herdar transform
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
  bvel = new Float32Array(BN * 3);
  const bmat = new THREE.PointsMaterial({
    size: 0.16,
    map: sprite(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xbdeeff,
  });
  burst = new THREE.Points(bgeo, bmat);
  burst.visible = false;
  group.add(burst);

  loadModel();
  applyPalette();
  applyResponsive();
  window.addEventListener("resize", onResize);
  loop();
  return window.frostScene;
}

function applyResponsive() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;

  // câmera recua em retrato pra caber o modelo inteiro no enquadramento
  camera.position.z = aspect < 1 ? 6.2 + (1 / aspect - 1) * 4.2 : 6.2;

  // telas estreitas: texto fica centralizado, então centraliza o modelo também
  state.balanceScale = w < 760 ? 0.12 : w < 1100 ? 0.6 : 1;

  // encolhe um pouco o modelo no mobile pra dar respiro nas bordas
  state.fitScale = w < 760 ? 0.7 : w < 1100 ? 0.85 : 1;

  // menos partículas em telas pequenas (perf)
  if (points) points.material.size = w < 760 ? 0.055 : 0.075;
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyResponsive();
}

function loop() {
  raf = requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta ? 0.016 : 0.016, 0.05);
  const k = state.reduced ? 0.25 : (0.35 + state.intensity * 0.9);

  // suavização
  curX += (state.targetX - curX) * 0.06;
  curScroll += (state.scroll - curScroll) * 0.08;
  curTwist += (state.targetTwist - curTwist) * 0.06;

  if (group) {
    group.position.x = curX * state.balanceScale;
    group.position.y = Math.sin(t * 0.5) * 0.12 * (state.reduced ? 0.3 : 1);
    group.rotation.y = t * 0.15 * k + curScroll * Math.PI * 4 * (0.5 + state.intensity);
    group.rotation.x = Math.sin(t * 0.35) * 0.12 + curScroll * 0.6 + curTwist;
    group.rotation.z = curTwist * 0.4;
    const s = (1 + Math.sin(curScroll * Math.PI) * 0.18 * (0.4 + state.intensity)) * state.fitScale;
    group.scale.setScalar(s);
  }
  if (core) core.material.opacity = 0.4 + Math.sin(t * 1.6) * 0.18;
  if (model && !exploding) model.rotation.z = t * 0.25 * k;   // floco gira no próprio eixo

  // explosão no footer
  if (exploding && burst) {
    const life = t - eStart;
    const arr = burst.geometry.attributes.position.array;
    for (let i = 0; i < BN; i++) {
      bvel[i * 3 + 1] -= 2.4 * dt;            // gravidade
      arr[i * 3]     += bvel[i * 3]     * dt;
      arr[i * 3 + 1] += bvel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += bvel[i * 3 + 2] * dt;
      bvel[i * 3]     *= 0.992;               // arrasto baixo → vão mais longe
      bvel[i * 3 + 1] *= 0.992;
      bvel[i * 3 + 2] *= 0.992;
    }
    burst.geometry.attributes.position.needsUpdate = true;
    burst.material.opacity = Math.max(0, 1 - life / EXPLODE_T) * 0.95;

    // modelo encolhe e some rápido enquanto os cacos partem
    const mp = Math.min(1, life / 0.18);
    if (model) model.scale.setScalar(THREE.MathUtils.lerp(1, 0.15, mp));
    if (iceMat) iceMat.opacity = ICE_OPACITY * (1 - mp);

    if (life > EXPLODE_T) {
      exploding = false;
      burst.visible = false;
      if (model) model.visible = false;
    }
  }

  if (points) {
    points.visible = state.particles;
    if (state.particles) {
      const arr = points.geometry.attributes.position.array;
      const spd = points.geometry.userData.spd;
      for (let i = 0; i < spd.length; i++) {
        arr[i * 3 + 1] -= spd[i] * dt * (0.6 + state.intensity);
        arr[i * 3] += Math.sin(t * 0.4 + i) * 0.002;
        if (arr[i * 3 + 1] < -7) arr[i * 3 + 1] = 7;
      }
      points.geometry.attributes.position.needsUpdate = true;
      points.rotation.y = t * 0.02;
    }
  }

  renderer.render(scene, camera);
}

// dispara a explosão: semeia cacos na origem com velocidade radial
function explode() {
  if (!burst || exploding || exploded) return;
  exploded = true;
  const arr = burst.geometry.attributes.position.array;
  for (let i = 0; i < BN; i++) {
    // direção aleatória na esfera
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(a), dy = u, dz = s * Math.sin(a);
    const r = 0.15 + Math.random() * 1.2;          // posição inicial (~superfície do floco)
    arr[i * 3]     = dx * r;
    arr[i * 3 + 1] = dy * r;
    arr[i * 3 + 2] = dz * r;
    const sp = 6.0 + Math.random() * 7.0;          // velocidade de saída (estilhaço forte)
    bvel[i * 3]     = dx * sp;
    bvel[i * 3 + 1] = dy * sp + 1.4;               // viés pra cima
    bvel[i * 3 + 2] = dz * sp;
  }
  burst.geometry.attributes.position.needsUpdate = true;
  burst.material.opacity = 0.95;
  burst.visible = true;
  exploding = true;
  eStart = clock.getElapsedTime();
}

// remonta o floco (ao subir de volta)
function resetExplosion() {
  exploding = false;
  exploded = false;
  if (burst) burst.visible = false;
  if (model) { model.visible = true; model.scale.setScalar(1); }
  if (iceMat) iceMat.opacity = ICE_OPACITY;
}

// API pública
window.frostScene = {
  setScroll(p) { state.scroll = Math.max(0, Math.min(1, p)); },
  setBalance(x) { state.targetX = x; },
  setTwist(v) { state.targetTwist = v; },
  setIntensity(v) { state.intensity = Math.max(0, Math.min(1, v)); },
  setParticles(on) { state.particles = !!on; },
  setPalette(name) { state.palette = name; applyPalette(); },
  explode() { explode(); },
  reset() { resetExplosion(); },
  _state: state,
};

window.frostSceneInit = init;

// auto-init (módulo é deferido, DOM já existe)
const _cv = document.getElementById("bg-canvas");
if (_cv) {
  try { init(_cv); } catch (e) { console.error("frostScene init falhou", e); }
}
