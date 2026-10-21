const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const dataFile = path.join(os.tmpdir(), `chuangda-verify-${process.pid}.json`);
process.env.DATA_FILE = dataFile;
process.env.STORAGE_DRIVER = 'json';
process.env.NODE_ENV = 'test';

const store = require('../storage/jsonStore');
const { consumeCode, hashCode } = require('../lib/verify');

test.before(async () => {
  fs.rmSync(dataFile, { force: true });
  await store.ready();
});

test.after(() => {
  fs.rmSync(dataFile, { force: true });
});

test('verification code is invalidated after five failed attempts', async () => {
  await store.insertCode({
    id: 'code-attempt-limit',
    userId: 'employee-attempt-limit',
    channel: 'sms',
    target: '13800008888',
    codeHash: hashCode('123456'),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    used: false,
    failedAttempts: 0,
    createdAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      consumeCode(store, {
        userId: 'employee-attempt-limit',
        channel: 'sms',
        target: '13800008888',
        code: '000000',
      }),
      (error) => error && error.code === 'CODE_INVALID',
    );
  }

  await assert.rejects(
    consumeCode(store, {
      userId: 'employee-attempt-limit',
      channel: 'sms',
      target: '13800008888',
      code: '123456',
    }),
    (error) => error && error.code === 'CODE_INVALID',
  );
});
