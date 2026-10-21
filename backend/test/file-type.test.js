const assert = require('node:assert/strict');
const test = require('node:test');

const { validatedFileType } = require('../lib/fileType');

test('validatedFileType rejects spoofed files and returns a server-owned MIME type', () => {
  const html = Buffer.from('<script>alert(1)</script>');
  assert.equal(validatedFileType('spoofed.png', html), null);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(validatedFileType('safe.png', png), {
    ext: '.png',
    contentType: 'image/png',
  });
});
