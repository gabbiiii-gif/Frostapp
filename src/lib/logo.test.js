import { describe, it, expect } from 'vitest';
import { limitesConteudo, recorteComFolga, dimensoesAlvo, recomendarVetor, bytesDataUrl } from './logo.js';

// Monta um RGBA w×h preenchido com `fundo` e um retângulo de `cor`.
function imagem(w, h, fundo, ret, cor = [20, 60, 200, 255]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(fundo, i * 4);
  if (ret) for (let y = ret.y; y < ret.y + ret.h; y++) for (let x = ret.x; x < ret.x + ret.w; x++) d.set(cor, (y * w + x) * 4);
  return d;
}

describe('limitesConteudo', () => {
  it('acha o desenho em fundo branco (margem grande, como a logo da Minas)', () => {
    const d = imagem(100, 60, [255, 255, 255, 255], { x: 30, y: 20, w: 40, h: 15 });
    expect(limitesConteudo(d, 100, 60)).toEqual({ x: 30, y: 20, w: 40, h: 15 });
  });

  it('acha o desenho em fundo transparente', () => {
    const d = imagem(50, 50, [0, 0, 0, 0], { x: 5, y: 10, w: 20, h: 30 });
    expect(limitesConteudo(d, 50, 50)).toEqual({ x: 5, y: 10, w: 20, h: 30 });
  });

  it('tolera branco "sujo" de JPEG', () => {
    const d = imagem(40, 40, [250, 248, 252, 255], { x: 10, y: 10, w: 5, h: 5 });
    expect(limitesConteudo(d, 40, 40)).toEqual({ x: 10, y: 10, w: 5, h: 5 });
  });

  it('fundo colorido liso também é recortado', () => {
    const d = imagem(40, 40, [10, 30, 90, 255], { x: 8, y: 9, w: 6, h: 7 }, [255, 255, 255, 255]);
    expect(limitesConteudo(d, 40, 40)).toEqual({ x: 8, y: 9, w: 6, h: 7 });
  });

  it('imagem só de fundo → null (mantém a original)', () => {
    expect(limitesConteudo(imagem(10, 10, [255, 255, 255, 255]), 10, 10)).toBeNull();
  });
});

describe('recorteComFolga', () => {
  it('adiciona 3% sem sair da imagem', () => {
    expect(recorteComFolga({ x: 30, y: 20, w: 100, h: 40 }, 200, 100)).toEqual({ x: 27, y: 17, w: 106, h: 46 });
    expect(recorteComFolga({ x: 0, y: 0, w: 100, h: 40 }, 100, 40)).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });
});

describe('dimensoesAlvo', () => {
  it('reduz mantendo a proporção', () => {
    expect(dimensoesAlvo(1024, 512)).toEqual({ w: 512, h: 256 });
  });
  it('não amplia imagem pequena', () => {
    expect(dimensoesAlvo(200, 100)).toEqual({ w: 200, h: 100 });
  });
});

describe('recomendarVetor / bytesDataUrl', () => {
  it('sugere SVG para desenho pequeno', () => {
    expect(recomendarVetor(180, 70)).toBe(true);
    expect(recomendarVetor(480, 200)).toBe(false);
  });
  it('estima bytes de base64 e de SVG em texto', () => {
    expect(bytesDataUrl('data:image/png;base64,QUJD')).toBe(3);
    expect(bytesDataUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E')).toBe(5);
  });
});
