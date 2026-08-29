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

// Directional shade over whatever alpha already exists, for form. `dir` in
// radians; darker toward that side, lighter toward the opposite.
function shade(img, cx, cy, radius, dir, darkColor, lightColor, strength = 0.5) {
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (img[i + 3] <= 0) continue;
      const t = ((x - cx) * dx + (y - cy) * dy) / radius; // -1..1 across shape
      if (t < 0) blend(img, x, y, Math.min(1, -t) * strength, withA(darkColor, 1));
      else blend(img, x, y, Math.min(1, t) * strength * 0.7, withA(lightColor, 1));
    }
  }
}

// per-pixel grain on painted pixels — kills the "flat vector" read
function grain(img, amount) {
  const rand = mulberry32(0xa11);
  for (let i = 0; i < img.length; i += 4) {
    if (img[i + 3] <= 0.01) continue;
    const n = (rand() - 0.5) * amount;
    img[i] = Math.min(1, Math.max(0, img[i] + n));
    img[i + 1] = Math.min(1, Math.max(0, img[i + 1] + n));
    img[i + 2] = Math.min(1, Math.max(0, img[i + 2] + n));
  }
}

// mulberry32, inline (same as the runtime seed RNG)
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One sakura flower centred at (cx,cy).
function blossom(img, cx, cy, r, rot, rand) {
  const petal = hex("#ff86b8");
  const petalLo = hex("#ffd0e2");
  const petalHi = hex("#ff5fa0");
  const centre = hex("#ffd35e");
  for (let k = 0; k < 5; k++) {
    const a = rot + (k / 5) * Math.PI * 2;
    const px = cx + Math.cos(a) * r * 0.55;
    const py = cy + Math.sin(a) * r * 0.55;
    fillSDF(img, ellipse(px, py, r * 0.42, r * 0.56, a + Math.PI / 2), petal);
    fillSDF(
      img,
      ellipse(cx + Math.cos(a) * r * 0.36, cy + Math.sin(a) * r * 0.36, r * 0.24, r * 0.32, a + Math.PI / 2),
      withA(petalLo, 0.75),
    );
    // notched tip
    const nx = cx + Math.cos(a) * r * 1.15;
    const ny = cy + Math.sin(a) * r * 1.15;
    fillSDF(img, disc(nx, ny, r * 0.12), [0, 0, 0, 0]);
    fillSDF(img, capsule(px, py, nx, ny, r * 0.05), withA(petalHi, 0.4));
  }
  fillSDF(img, disc(cx, cy, r * 0.2), centre);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rand() * 0.4;
    fillSDF(img, disc(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, r * 0.04), hex("#ffbf3d"));
  }
}

// CHERRY — a spray: 3 blossoms + loose petals, so it reads as a cluster
function drawCherry() {
  const img = canvas();
  const rand = mulberry32(0xc4e1);
  const clusters = [
    [S * 0.42, S * 0.4, S * 0.2, 0.2],
    [S * 0.62, S * 0.56, S * 0.16, 1.1],
    [S * 0.38, S * 0.66, S * 0.14, 2.3],
  ];
  for (const [cx, cy, r, rot] of clusters) blossom(img, cx, cy, r, rot, rand);
  // loose petals
  for (let i = 0; i < 6; i++) {
    const px = S * (0.2 + rand() * 0.6);
    const py = S * (0.2 + rand() * 0.6);
    const pr = S * (0.05 + rand() * 0.04);
    fillSDF(img, ellipse(px, py, pr, pr * 1.4, rand() * Math.PI), hex("#ff9ec6"));
  }
  shade(img, S / 2, S / 2, S * 0.5, -Math.PI * 0.35, hex("#b64f86"), hex("#ffd9e8"), 0.4);
  grain(img, 0.05);
  return img;
}

// One banknote rectangle.
function bill(img, cx, cy, w, h, rot) {
  const paper = hex("#5aa06a");
  const ink = hex("#2c5b3c");
  const light = hex("#8dc79a");
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const rect = (bw, bh, rad) => (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    const qx = Math.abs(lx) - (bw / 2 - rad);
    const qy = Math.abs(ly) - (bh / 2 - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  };
  fillSDF(img, rect(w, h, 22), paper);
  fillSDF(img, (x, y) => Math.max(rect(w - 34, h - 34, 16)(x, y), -rect(w - 58, h - 58, 12)(x, y)), withA(ink, 0.8));
  fillSDF(img, ellipse(cx, cy, w * 0.13, h * 0.34, rot), withA(light, 0.85));
  fillSDF(img, (x, y) => {
    const e = ((px, py, rx, ry) => {
      const dx = px - cx;
      const dy = py - cy;
      const lx = (dx * c - dy * s) / rx;
      const ly = (dx * s + dy * c) / ry;
      return (Math.hypot(lx, ly) - 1) * Math.min(rx, ry);
    })(x, y, w * 0.13, h * 0.34);
    const inner = ((px, py, rx, ry) => {
      const dx = px - cx;
      const dy = py - cy;
      const lx = (dx * c - dy * s) / rx;
      const ly = (dx * s + dy * c) / ry;
      return (Math.hypot(lx, ly) - 1) * Math.min(rx, ry);
    })(x, y, w * 0.1, h * 0.28);
    return Math.max(e, -inner);
  }, withA(ink, 0.75));
}

// MONEY — a small fan of overlapping banknotes
function drawMoney() {
  const img = canvas();
  const bills = [
    [S * 0.46, S * 0.54, S * 0.62, S * 0.34, -0.28],
    [S * 0.56, S * 0.44, S * 0.6, S * 0.32, 0.12],
    [S * 0.4, S * 0.42, S * 0.5, S * 0.28, 0.5],
  ];
  for (const [cx, cy, w, h, rot] of bills) bill(img, cx, cy, w, h, rot);
  shade(img, S / 2, S / 2, S * 0.5, -Math.PI * 0.4, hex("#265239"), hex("#a9d6b4"), 0.42);
  grain(img, 0.06);
  return img;
}

/* ---------- run ---------- */

mkdirSync(OUT, { recursive: true });
for (const [name, draw] of [
  ["cherry", drawCherry],
  ["money", drawMoney],
]) {
  const file = resolve(OUT, `${name}.png`);
  writeFileSync(file, encodePNG(draw()));
  console.log("wrote", file);
}
