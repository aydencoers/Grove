/*
 * Procedurally generate the alpha-mapped leaf billboards for Grove's leaf
 * skins. Matches ez-tree's own leaf textures: 1024x1024 PNG with alpha
 * (node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/*.png are 1024x1024,
 * 8-bit, transparent). Ours are RGBA8 instead of palette+tRNS — loads the same.
 *
 * Base colours are kept saturated so the per-skin health ramp (multiplied onto
 * material.color at runtime) has room to shift + darken toward "stressed" and
 * "dying" without a regenerate.
 *
 *   node scripts/gen-leaf-textures.mjs
 */
import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const S = 1024;
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/textures/leaves",
);

/* ---------- tiny software rasteriser (straight-alpha `over`) ---------- */

function canvas() {
  return new Float32Array(S * S * 4); // r,g,b,a in 0..1
}

function blend(img, x, y, cov, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= S || y >= S || cov <= 0) return;
  const i = (y * S + x) * 4;
  const sa = a * cov;
  const da = img[i + 3];
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  img[i] = (r * sa + img[i] * da * (1 - sa)) / outA;
  img[i + 1] = (g * sa + img[i + 1] * da * (1 - sa)) / outA;
  img[i + 2] = (b * sa + img[i + 2] * da * (1 - sa)) / outA;
  img[i + 3] = outA;
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const withA = (c, a) => [c[0], c[1], c[2], a];

// fill a signed-distance field: sdf(x,y) < 0 is inside, ~1px anti-aliased edge
function fillSDF(img, sdf, color, aa = 1.1) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      if (d > aa) continue;
      const cov = Math.min(1, Math.max(0, 0.5 - d / aa));
      if (cov > 0) blend(img, x, y, cov, color);
    }
  }
}

const disc = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const ellipse = (cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * c - dy * s) / rx;
    const v = (dx * s + dy * c) / ry;
    const k = Math.min(rx, ry);
    return (Math.hypot(u, v) - 1) * k;
  };
};

const roundRect = (x0, y0, w, h, rad) => (x, y) => {
  const qx = Math.abs(x - (x0 + w / 2)) - (w / 2 - rad);
  const qy = Math.abs(y - (y0 + h / 2)) - (h / 2 - rad);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad;
};

const capsule = (x1, y1, x2, y2, width) => (x, y) => {
  const pax = x - x1;
  const pay = y - y1;
  const bax = x2 - x1;
  const bay = y2 - y1;
  const t = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * t, pay - bay * t) - width / 2;
};

/* ---------- PNG encode (RGBA8, no deps) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(img) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    const row = y * (1 + S * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      const si = (y * S + x) * 4;
      const di = row + 1 + x * 4;
      const a = img[si + 3];
      raw[di] = Math.round(Math.min(1, Math.max(0, img[si])) * 255);
      raw[di + 1] = Math.round(Math.min(1, Math.max(0, img[si + 1])) * 255);
      raw[di + 2] = Math.round(Math.min(1, Math.max(0, img[si + 2])) * 255);
      raw[di + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    png("IHDR", ihdr),
    png("IDAT", idat),
    png("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- the three skins ---------- */

// DEFAULT — a single simple deciduous leaf, mid-saturated green
function drawDefault() {
  const img = canvas();
  const cx = S / 2;
  const blade = hex("#7ba33f");
  const bladeDark = hex("#5f8a34");
  const tip = hex("#93b95a");
  const rib = hex("#4a6f2b");
  const shape = ellipse(cx, S * 0.52, S * 0.22, S * 0.4);
  const clip = (sdf) => (x, y) => Math.max(sdf(x, y), shape(x, y) + 3);
  // blade
  fillSDF(img, shape, blade);
  fillSDF(img, clip((x, y) => (y < S * 0.34 ? shape(x, y) : 1e9)), withA(tip, 0.55));
  fillSDF(img, clip((x, y) => (x > cx ? shape(x, y) : 1e9)), withA(bladeDark, 0.35));
  // midrib + veins, clipped to the blade
  fillSDF(img, clip(capsule(cx, S * 0.16, cx, S * 0.9, 9)), withA(rib, 0.75));
  for (const [sy, ex, ey] of [
    [0.36, 0.78, 0.3],
    [0.52, 0.82, 0.48],
    [0.68, 0.76, 0.68],
  ]) {
    fillSDF(img, clip(capsule(cx, S * sy, S * ex, S * ey, 5)), withA(rib, 0.45));
    fillSDF(img, clip(capsule(cx, S * sy, S * (1 - ex), S * ey, 5)), withA(rib, 0.45));
  }
  return img;
}

// CHERRY BLOSSOM — five notched petals + stamen centre, saturated pink
function drawCherry() {
  const img = canvas();
  const cx = S / 2;
  const cy = S / 2;
  const petal = hex("#ff7fb3");
  const petalLo = hex("#ff9ec6");
  const notch = hex("#ff5fa0");
  const centre = hex("#ffd766");
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * S * 0.26;
    const py = cy + Math.sin(a) * S * 0.26;
    fillSDF(img, ellipse(px, py, S * 0.15, S * 0.19, a + Math.PI / 2), petal);
    // lighter inner
    fillSDF(
      img,
      ellipse(
        cx + Math.cos(a) * S * 0.18,
        cy + Math.sin(a) * S * 0.18,
        S * 0.09,
        S * 0.12,
        a + Math.PI / 2,
      ),
      withA(petalLo, 0.7),
    );
    // the sakura tip notch: carve with background, then a darker seam
    const nx = cx + Math.cos(a) * S * 0.42;
    const ny = cy + Math.sin(a) * S * 0.42;
    fillSDF(img, disc(nx, ny, S * 0.035), [0, 0, 0, 0]);
    fillSDF(img, capsule(px, py, nx, ny, 7), withA(notch, 0.5));
  }
  fillSDF(img, disc(cx, cy, S * 0.075), centre);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    fillSDF(
      img,
      disc(cx + Math.cos(a) * S * 0.11, cy + Math.sin(a) * S * 0.11, S * 0.014),
      hex("#ffcf5a"),
    );
  }
  return img;
}

// MONEY — a rounded banknote, crisp green, portrait oval + border + numerals
function drawMoney() {
  const img = canvas();
  const w = S * 0.9;
  const h = S * 0.46;
  const x0 = (S - w) / 2;
  const y0 = (S - h) / 2;
  const bill = hex("#5aa06a");
  const billEdge = hex("#3c7a4e");
  const ink = hex("#2f5d3c");
  const paper = hex("#a9cdb0");
  fillSDF(img, roundRect(x0, y0, w, h, 46), bill);
  // inner frame
  fillSDF(img, (x, y) => {
    const outer = roundRect(x0 + 26, y0 + 26, w - 52, h - 52, 30)(x, y);
    const inner = roundRect(x0 + 40, y0 + 40, w - 80, h - 80, 24)(x, y);
    return Math.max(outer, -inner);
  }, withA(ink, 0.85));
  // portrait oval
  fillSDF(img, ellipse(S / 2, S / 2, S * 0.11, S * 0.15), paper);
  fillSDF(img, (x, y) => {
    const d = ellipse(S / 2, S / 2, S * 0.11, S * 0.15)(x, y);
    return Math.max(d, -ellipse(S / 2, S / 2, S * 0.09, S * 0.13)(x, y));
  }, withA(billEdge, 0.9));
  // corner discs (denomination medallions)
  for (const sx of [x0 + 92, x0 + w - 92]) {
    for (const sy of [y0 + 74, y0 + h - 74]) {
      fillSDF(img, disc(sx, sy, 34), withA(paper, 0.9));
      fillSDF(img, (x, y) => {
        const d = disc(sx, sy, 34)(x, y);
        return Math.max(d, -disc(sx, sy, 24)(x, y));
      }, withA(ink, 0.9));
    }
  }
  // guilloché lines
  for (let i = 0; i < 5; i++) {
    const yy = y0 + 70 + i * 12;
    fillSDF(img, capsule(x0 + 150, yy, x0 + w - 150, yy, 3), withA(ink, 0.25));
    const yb = y0 + h - 70 - i * 12;
    fillSDF(img, capsule(x0 + 150, yb, x0 + w - 150, yb, 3), withA(ink, 0.25));
  }
  return img;
}

/* ---------- run ---------- */

mkdirSync(OUT, { recursive: true });
for (const [name, draw] of [
  ["default", drawDefault],
  ["cherry", drawCherry],
  ["money", drawMoney],
]) {
  const file = resolve(OUT, `${name}.png`);
  writeFileSync(file, encodePNG(draw()));
  console.log("wrote", file);
}
