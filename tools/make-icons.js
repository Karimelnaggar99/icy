#!/usr/bin/env node
// Generates app/icons/*.png with pure Node (zlib + hand-written PNG encoder).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'app', 'icons');

// ---- PNG encoder ----
const CRC = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- geometry helpers (unit box coordinates) ----
function inPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

// Cube (top 62% of the mark box) and block letters I C Y beneath.
const cy = 0.31, R = 0.31, A = R * 0.8660254;
const P = {
  top: [0.5, cy - R], ur: [0.5 + A, cy - R / 2], lr: [0.5 + A, cy + R / 2],
  bot: [0.5, cy + R], ll: [0.5 - A, cy + R / 2], ul: [0.5 - A, cy - R / 2], c: [0.5, cy]
};
const FACES = [
  { poly: [P.top, P.ur, P.c, P.ul], col: [255, 255, 255] },
  { poly: [P.ul, P.c, P.bot, P.ll], col: [226, 245, 255] },
  { poly: [P.ur, P.lr, P.bot, P.c], col: [186, 226, 252] }
];
const LT = 0.055, LY0 = 0.76, LY1 = 1.0, LW = 0.22, LGAP = 0.07;
const LX0 = (1 - (3 * LW + 2 * LGAP)) / 2;
const WHITE = [255, 255, 255];

function markColor(u, v) { // returns [r,g,b] or null
  if (v < 0.66) {
    for (const f of FACES) if (inPoly(u, v, f.poly)) return f.col;
    return null;
  }
  if (v < LY0 - 0.01 || v > LY1 + 0.01) return null;
  const ymid = (LY0 + LY1) / 2;
  // I
  const ix = LX0 + LW / 2;
  if (segDist(u, v, [ix, LY0], [ix, LY1]) <= LT / 2 ||
      segDist(u, v, [LX0 + 0.02, LY0], [LX0 + LW - 0.02, LY0]) <= LT / 2 ||
      segDist(u, v, [LX0 + 0.02, LY1], [LX0 + LW - 0.02, LY1]) <= LT / 2) return WHITE;
  // C (ring with a gap on the right)
  const cx0 = LX0 + LW + LGAP, rx = LW / 2, ry = (LY1 - LY0) / 2;
  const nx = (u - (cx0 + rx)) / rx, ny = (v - ymid) / ry;
  const rr = Math.hypot(nx, ny);
  const inner = 1 - (LT * 1.15) / ry;
  if (rr <= 1.04 && rr >= inner && !(nx > 0 && Math.abs(ny) < nx * 0.9)) return WHITE;
  // Y
  const yx0 = cx0 + LW + LGAP, ycx = yx0 + LW / 2;
  if (segDist(u, v, [yx0, LY0], [ycx, ymid + 0.01]) <= LT / 2 ||
      segDist(u, v, [yx0 + LW, LY0], [ycx, ymid + 0.01]) <= LT / 2 ||
      segDist(u, v, [ycx, ymid], [ycx, LY1]) <= LT / 2) return WHITE;
  return null;
}

function bgColor(u, v) { // diagonal icy-blue gradient
  const t = Math.max(0, Math.min(1, (u + v) / 2));
  const a = [96, 190, 255], b = [30, 120, 214];
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
}

function render(size, { maskable, markScale }) {
  const SS = 3;
  const buf = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const box = size * markScale, ox = (size - box) / 2, oy = (size - box) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          // rounded-square coverage
          if (radius > 0) {
            const qx = Math.abs(px - size / 2) - (size / 2 - radius);
            const qy = Math.abs(py - size / 2) - (size / 2 - radius);
            if (qx > 0 && qy > 0 && Math.hypot(qx, qy) > radius) continue;
          }
          const m = markColor((px - ox) / box, (py - oy) / box);
          const c = m || bgColor(px / size, py / size);
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      if (a > 0) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePNG(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { maskable: false, markScale: 0.66 }],
  ['icon-512.png', 512, { maskable: false, markScale: 0.66 }],
  ['icon-maskable-512.png', 512, { maskable: true, markScale: 0.52 }] // mark stays inside the centre 60%
];
for (const [name, size, opts] of jobs) {
  const png = render(size, opts);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('wrote', name, size + 'x' + size, png.length + ' bytes');
}
