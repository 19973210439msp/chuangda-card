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
function near(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  let t = ((x - x1) * dx + (y - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= width * width;
}
function ring(x, y, cx, cy, r, w) {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d <= (r + w) ** 2 && d >= (r - w) ** 2;
}
function frame(x, y, l, t, r, b, s) {
  const inside = x >= l && x <= r && y >= t && y <= b;
  const inner = x >= l + s && x <= r - s && y >= t + s && y <= b - s;
  return inside && !inner;
}

const icons = {
  'edit-card': (x, y) => frame(x, y, 16, 14, 48, 50, 2.4) || near(x, y, 28, 38, 40, 26, 1.6),
  forward: (x, y) => frame(x, y, 12, 20, 40, 48, 2.4) || near(x, y, 34, 28, 50, 14, 1.8) || near(x, y, 42, 14, 50, 14, 1.8) || near(x, y, 50, 14, 50, 22, 1.8),
  link: (x, y) => ring(x, y, 24, 40, 10, 2) || ring(x, y, 40, 24, 10, 2) || near(x, y, 30, 34, 34, 30, 1.8),
  'switch-card': (x, y) => near(x, y, 16, 24, 46, 24, 1.8) || near(x, y, 18, 40, 48, 40, 1.8) || near(x, y, 38, 16, 48, 24, 1.8) || near(x, y, 16, 40, 26, 48, 1.8),
  'card-style': (x, y) => frame(x, y, 14, 16, 50, 48, 2.4) || near(x, y, 22, 28, 42, 28, 1.6) || near(x, y, 22, 36, 36, 36, 1.6),
};

const dir = path.join(__dirname, 'icons');
for (const [name, shape] of Object.entries(icons)) {
  fs.writeFileSync(path.join(dir, name + '.png'), png(64, (x, y) => (shape(x, y) ? ink : null)));
}
console.log('icons', Object.keys(icons).length);
