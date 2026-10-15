const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = paint(x, y) || [0, 0, 0, 0];
      const i = row + 1 + x * 4;
      raw[i] = pixel[0];
      raw[i + 1] = pixel[1];
      raw[i + 2] = pixel[2];
      raw[i + 3] = pixel[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ink = [24, 40, 80, 255];
const white = [255, 255, 255, 255];

function nearSegment(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  let t = ((x - x1) * dx + (y - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= width * width;
}

function ring(x, y, cx, cy, radius, stroke) {
  const d = Math.hypot(x - cx, y - cy);
  return d <= radius + stroke && d >= radius - stroke;
}

function camera(x, y) {
  const body = x >= 10 && x <= 54 && y >= 22 && y <= 50
    && !(x >= 13 && x <= 51 && y >= 25 && y <= 47);
  return body
    || ring(x, y, 32, 36, 8, 1.6)
    || nearSegment(x, y, 24, 22, 28, 16, 1.8)
    || nearSegment(x, y, 28, 16, 40, 16, 1.8)
    || nearSegment(x, y, 40, 16, 44, 22, 1.8);
}

function trash(x, y) {
  return nearSegment(x, y, 18, 18, 46, 18, 1.7)
    || nearSegment(x, y, 26, 18, 26, 14, 1.7)
    || nearSegment(x, y, 26, 14, 38, 14, 1.7)
    || nearSegment(x, y, 38, 14, 38, 18, 1.7)
    || nearSegment(x, y, 20, 22, 22, 50, 1.7)
    || nearSegment(x, y, 44, 22, 42, 50, 1.7)
    || nearSegment(x, y, 22, 50, 42, 50, 1.7)
    || nearSegment(x, y, 28, 26, 28, 44, 1.5)
    || nearSegment(x, y, 36, 26, 36, 44, 1.5);
}

function arrows(x, y) {
  return nearSegment(x, y, 14, 26, 50, 26, 1.8)
    || nearSegment(x, y, 42, 18, 50, 26, 1.8)
    || nearSegment(x, y, 42, 34, 50, 26, 1.8)
    || nearSegment(x, y, 14, 42, 50, 42, 1.8)
    || nearSegment(x, y, 14, 42, 22, 34, 1.8)
    || nearSegment(x, y, 14, 42, 22, 50, 1.8);
}

function phone(x, y) {
  const body = x >= 22 && x <= 42 && y >= 10 && y <= 54
    && !(x >= 25 && x <= 39 && y >= 14 && y <= 46);
  return body || nearSegment(x, y, 28, 50, 36, 50, 1.6);
}

function mail(x, y) {
  const body = x >= 10 && x <= 54 && y >= 18 && y <= 48
    && !(x >= 13 && x <= 51 && y >= 22 && y <= 45);
  return body
    || nearSegment(x, y, 12, 20, 32, 34, 1.6)
    || nearSegment(x, y, 52, 20, 32, 34, 1.6);
}

function logout(x, y) {
  return nearSegment(x, y, 28, 12, 28, 34, 1.8)
    || nearSegment(x, y, 22, 28, 28, 34, 1.8)
    || nearSegment(x, y, 34, 28, 28, 34, 1.8)
    || nearSegment(x, y, 16, 20, 16, 52, 1.8)
    || nearSegment(x, y, 16, 52, 46, 52, 1.8)
    || nearSegment(x, y, 46, 20, 46, 52, 1.8)
    || nearSegment(x, y, 16, 20, 24, 20, 1.8)
    || nearSegment(x, y, 38, 20, 46, 20, 1.8);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'camera.png'), png(64, (x, y) => (camera(x, y) ? white : null)));
fs.writeFileSync(path.join(dir, 'delete-bin.png'), png(64, (x, y) => (trash(x, y) ? ink : null)));
fs.writeFileSync(path.join(dir, 'switch-account.png'), png(64, (x, y) => (arrows(x, y) ? ink : null)));
fs.writeFileSync(path.join(dir, 'phone.png'), png(64, (x, y) => (phone(x, y) ? ink : null)));
fs.writeFileSync(path.join(dir, 'mail.png'), png(64, (x, y) => (mail(x, y) ? ink : null)));
function arrowRight(x, y) {
  return nearSegment(x, y, 24, 14, 42, 32, 2.6)
    || nearSegment(x, y, 42, 32, 24, 50, 2.6);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function remixArrowLeft(size) {
  const raw = [
    [7.82843, 10.9999], [20, 10.9999], [20, 12.9999], [7.82843, 12.9999],
    [13.1924, 18.3638], [11.7782, 19.778], [4, 11.9999], [11.7782, 4.22168], [13.1924, 5.63589],
  ];
  const pad = Math.round(size * 0.22);
  const scale = (size - pad * 2) / 24;
  const poly = raw.map(([px, py]) => [pad + px * scale, pad + py * scale]);
  return png(size, (x, y) => {
    let hits = 0;
    for (let sy = 0; sy < 4; sy += 1) {
      for (let sx = 0; sx < 4; sx += 1) {
        if (pointInPoly(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, poly)) hits += 1;
      }
    }
    if (!hits) return null;
    return [0, 0, 0, Math.round(255 * hits / 16)];
  });
}

fs.writeFileSync(path.join(dir, 'logout.png'), png(64, (x, y) => (logout(x, y) ? ink : null)));
fs.writeFileSync(path.join(dir, 'arrow-left.png'), remixArrowLeft(128));
fs.writeFileSync(path.join(dir, 'arrow-right.png'), png(64, (x, y) => (arrowRight(x, y) ? [200, 205, 212, 255] : null)));
