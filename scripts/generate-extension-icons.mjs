import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import console from "node:console";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "extension/icons");
const sizes = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

// Colors of the Vosio mark (public/vosio-logo.svg) as RGB triples.
const BACKGROUND = [10, 13, 18];
const BORDER = [52, 58, 70];
const PANEL = [21, 25, 34];
const WAVE = [247, 248, 250];

// Tests whether a point lies inside a rounded rectangle given in 512-unit logo coordinates.
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Samples the cubic bezier of the logo smile into stamp points.
function smilePoints() {
  const p = [[136, 360], [168, 396], [208, 414], [256, 414]];
  const q = [[256, 414], [304, 414], [344, 396], [376, 360]];
  const points = [];
  for (const [a, b, c, d] of [p, q]) {
    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t;
      points.push([
        u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0],
        u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]
      ]);
    }
  }
  return points;
}

const SMILE = smilePoints();
const BARS = [[144, 230, 52], [178, 194, 124], [212, 156, 200], [246, 118, 276], [280, 156, 200], [314, 194, 124], [348, 230, 52]];

// Returns the RGBA color of the logo at a point in 512-unit coordinates (transparent outside the mark).
function colorAt(x, y) {
  if (!inRoundRect(x, y, 0, 0, 512, 512, 112)) return null;
  for (const [bx, by, bh] of BARS) {
    if (inRoundRect(x, y, bx, by, 20, bh, 10)) return WAVE;
  }
  for (const [sx, sy] of SMILE) {
    if ((x - sx) ** 2 + (y - sy) ** 2 <= 64) return WAVE;
  }
  if (inRoundRect(x, y, 76, 76, 360, 360, 88)) return PANEL;
  if (inRoundRect(x, y, 72, 72, 368, 368, 92)) return BORDER;
  return BACKGROUND;
}

// Renders the logo at the given pixel size with 4x4 supersampling and returns raw RGBA bytes.
function render(size) {
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const color = colorAt(((px + (sx + 0.5) / SUPERSAMPLE) / size) * 512, ((py + (sy + 0.5) / SUPERSAMPLE) / size) * 512);
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 1; }
        }
      }
      const offset = (py * size + px) * 4;
      const total = SUPERSAMPLE * SUPERSAMPLE;
      data[offset] = a ? Math.round(r / a) : 0;
      data[offset + 1] = a ? Math.round(g / a) : 0;
      data[offset + 2] = a ? Math.round(b / a) : 0;
      data[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return data;
}

// Builds one PNG chunk (length, type, data, CRC).
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

// Encodes raw RGBA pixels as a PNG file.
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0;
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
for (const size of sizes) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), encodePng(size, render(size)));
}
console.log(`Generated ${sizes.length} extension icons in extension/icons.`);
