export const BITMAP_FONT_SCALE = 4;

const GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export interface OcrLine {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: readonly [number, number, number, number];
}

export function renderBitmapText(text: string, scale = BITMAP_FONT_SCALE): {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
} {
  const glyphs = [...text.toUpperCase()];
  const glyphW = 5 * scale;
  const glyphH = 7 * scale;
  const gap = scale;
  const pad = scale;
  const width = pad * 2 + glyphs.length * glyphW + Math.max(0, glyphs.length - 1) * gap;
  const height = pad * 2 + glyphH;
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(255);
  glyphs.forEach((glyph, index) => {
    const rows = GLYPHS[glyph] ?? GLYPHS[" "];
    const originX = pad + index * (glyphW + gap);
    rows?.forEach((row, rowIndex) => {
      for (let col = 0; col < 5; col += 1) {
        if (row[col] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = originX + col * scale + dx;
            const y = pad + rowIndex * scale + dy;
            const dest = (y * width + x) * 3;
            rgb[dest] = 0;
            rgb[dest + 1] = 0;
            rgb[dest + 2] = 0;
          }
        }
      }
    });
  });
  return { width, height, rgb };
}

export function recognizeBitmap(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
): OcrLine[] {
  if (width <= 0 || height <= 0 || channels < 3) return [];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * channels;
    const r = pixels[offset] ?? 255;
    const g = pixels[offset + 1] ?? 255;
    const b = pixels[offset + 2] ?? 255;
    mask[i] = r * 0.3 + g * 0.59 + b * 0.11 < 128 ? 1 : 0;
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return [];
  const scale = detectScale(mask, width, minX, minY, maxX, maxY);
  const glyphW = 5 * scale;
  const step = glyphW + scale;
  let text = "";
  let matched = 0;
  let counted = 0;
  for (let x = minX; x + glyphW - 1 <= maxX + scale; x += step) {
    const glyph = readGlyph(mask, width, height, x, minY, scale);
    const best = matchGlyph(glyph);
    text += best.char;
    matched += best.score;
    counted += 1;
  }
  const trimmed = text.trim();
  if (!trimmed || counted === 0) return [];
  const confidence = matched / counted;
  if (confidence < 0.7) return [];
  return [
    {
      text: trimmed,
      confidence,
      bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
    },
  ];
}

function detectScale(
  mask: Uint8Array,
  width: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const inkHeight = maxY - minY + 1;
  for (let scale = 8; scale >= 1; scale -= 1) {
    if (Math.abs(inkHeight - 7 * scale) <= scale) {
      const column = minX;
      let run = 0;
      for (let y = minY; y <= maxY; y += 1) {
        if (mask[y * width + column] === 1) run += 1;
      }
      if (run > 0) return scale;
    }
  }
  return Math.max(1, Math.round(inkHeight / 7));
}

function readGlyph(
  mask: Uint8Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  scale: number,
): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 7; row += 1) {
    let bits = "";
    for (let col = 0; col < 5; col += 1) {
      let ink = 0;
      let total = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const x = originX + col * scale + dx;
          const y = originY + row * scale + dy;
          total += 1;
          if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1) ink += 1;
        }
      }
      bits += ink * 2 >= total ? "1" : "0";
    }
    rows.push(bits);
  }
  return rows;
}

function matchGlyph(rows: readonly string[]): { readonly char: string; readonly score: number } {
  let bestChar = " ";
  let bestScore = -1;
  for (const [char, glyph] of Object.entries(GLYPHS)) {
    let same = 0;
    for (let row = 0; row < 7; row += 1) {
      const left = rows[row] ?? "";
      const right = glyph[row] ?? "";
      for (let col = 0; col < 5; col += 1) {
        if (left[col] === right[col]) same += 1;
      }
    }
    const score = same / 35;
    if (score > bestScore) {
      bestScore = score;
      bestChar = char;
    }
  }
  return { char: bestScore >= 0.75 ? bestChar : " ", score: Math.max(0, bestScore) };
}
