const path = require('node:path');

const TYPES = {
  '.png': { contentType: 'image/png', matches: (buffer) => (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) },
  '.jpg': { contentType: 'image/jpeg', matches: jpeg },
  '.jpeg': { contentType: 'image/jpeg', matches: jpeg },
  '.webp': { contentType: 'image/webp', matches: (buffer) => (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) },
  '.gif': { contentType: 'image/gif', matches: (buffer) => {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  } },
  '.pdf': { contentType: 'application/pdf', matches: (buffer) => (
    buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) },
};

function jpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function validatedFileType(filename, buffer) {
  const ext = path.extname(filename || '').toLowerCase();
  const type = TYPES[ext];
  if (!type || !Buffer.isBuffer(buffer) || !type.matches(buffer)) return null;
  return { ext, contentType: type.contentType };
}

module.exports = { validatedFileType };
