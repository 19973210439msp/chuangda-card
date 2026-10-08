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
      const pixel = paint(x, y, size) || [0, 0, 0, 0];
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

function dot(color, on) {
  return on ? color.concat(255) : [0, 0, 0, 0];
}

const idle = [138, 144, 153];
const active = [24, 40, 80];

function home(x, y, size) {
  const cx = size / 2;
  if (y >= 18 && y <= 40) {
    const half = 6 + ((y - 18) / 22) * 24;
    if (Math.abs(x - cx) <= half && Math.abs(x - cx) >= half - 4) return true;
  }
  if (y >= 38 && y <= 64 && Math.abs(x - cx) <= 16 && Math.abs(x - cx) >= 12) return true;
  if (y >= 60 && y <= 64 && Math.abs(x - cx) <= 16) return true;
  if (y >= 46 && y <= 64 && Math.abs(x - cx) <= 5) return true;
  return false;
}

function holder(x, y, size) {
  const inRect = (left, top, right, bottom) => x >= left && x <= right && y >= top && y <= bottom;
  const frame = (left, top, right, bottom) => inRect(left, top, right, bottom)
    && (x <= left + 3 || x >= right - 3 || y <= top + 3 || y >= bottom - 3);
  return frame(22, 18, 58, 48) || frame(28, 30, 64, 62);
}

function mine(x, y, size) {
  const cx = size / 2;
  const head = (x - cx) ** 2 + (y - 30) ** 2 <= 12 ** 2 && (x - cx) ** 2 + (y - 30) ** 2 >= 8 ** 2;
  const body = y >= 48 && y <= 66 && Math.abs(x - cx) <= 16 && Math.abs(x - cx) >= 12;
  const base = y >= 62 && y <= 66 && Math.abs(x - cx) <= 16;
  return head || body || base;
}

const icons = [
  ['tab-home', home, idle],
  ['tab-home-on', home, active],
  ['tab-holder', holder, idle],
  ['tab-holder-on', holder, active],
  ['tab-mine', mine, idle],
  ['tab-mine-on', mine, active],
];

for (const [name, shape, color] of icons) {
  const file = png(81, (x, y, size) => (shape(x, y, size) ? color.concat(255) : null));
  fs.writeFileSync(path.join(__dirname, name + '.png'), file);
}
