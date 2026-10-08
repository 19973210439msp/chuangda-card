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

function frame(x, y, left, top, right, bottom, stroke) {
  const inside = x >= left && x <= right && y >= top && y <= bottom;
  const inner = x >= left + stroke && x <= right - stroke && y >= top + stroke && y <= bottom - stroke;
  return inside && !inner;
}

function pencil(x, y) {
  return nearSegment(x, y, 18, 46, 44, 20, 2.2)
    || nearSegment(x, y, 44, 20, 50, 14, 2)
    || nearSegment(x, y, 40, 24, 48, 28, 1.6);
}

function forward(x, y) {
  return frame(x, y, 12, 22, 40, 50, 3)
    || nearSegment(x, y, 34, 30, 52, 14, 2.2)
    || nearSegment(x, y, 44, 14, 52, 14, 2.2)
    || nearSegment(x, y, 52, 14, 52, 22, 2.2);
}

function link(x, y) {
  const ring = (cx, cy) => {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    return d <= 13 ** 2 && d >= 9 ** 2;
  };
  return ring(24, 40) || ring(40, 24) || nearSegment(x, y, 28, 36, 36, 28, 2);
}

function chart(x, y) {
  const bar = (left, top) => x >= left && x <= left + 8 && y >= top && y <= 50;
  return bar(14, 34) || bar(28, 24) || bar(42, 14);
}

const icons = [
  ['edit-card', pencil],
  ['forward', forward],
  ['link', link],
  ['stats', chart],
];

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const [name, shape] of icons) {
  fs.writeFileSync(path.join(dir, name + '.png'), png(64, (x, y) => (shape(x, y) ? ink : null)));
}
