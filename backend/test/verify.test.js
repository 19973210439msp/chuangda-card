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
const { issueCode, consumeCode, hashCode } = require('../lib/verify');

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

test('verification code expires after five minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T00:00:00.000Z') });
  const issued = await issueCode(store, {
    userId: 'employee-five-minute-code',
    channel: 'sms',
    target: '13800007777',
  });

  t.mock.timers.tick(5 * 60 * 1000 + 1);

  await assert.rejects(
    consumeCode(store, {
      userId: 'employee-five-minute-code',
      channel: 'sms',
      target: '13800007777',
      code: issued.code,
    }),
    (error) => error && error.code === 'CODE_INVALID',
  );
});

test('one-minute limit follows the account even when the target phone changes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T01:00:00.000Z') });
  const options = {
    userId: 'employee-one-minute-limit',
    channel: 'sms',
    target: '13800006666',
  };

  await issueCode(store, options);
  await assert.rejects(
    issueCode(store, { ...options, target: '13800005555' }),
    (error) => error && error.status === 429 && error.code === 'CODE_RATE_LIMIT',
  );

  t.mock.timers.tick(60 * 1000 + 1);
  await assert.doesNotReject(issueCode(store, options));
});

test('concurrent requests reserve only one code', async () => {
  const options = {
    userId: 'employee-concurrent-limit',
    channel: 'sms',
    target: '13800004444',
  };
  const results = await Promise.allSettled([
    issueCode(store, options),
    issueCode(store, options),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'CODE_RATE_LIMIT').length, 1);
});

test('failed delivery releases the one-minute reservation', async () => {
  const options = {
    userId: 'employee-failed-delivery',
    channel: 'sms',
    target: '13800003333',
  };
  await assert.rejects(
    issueCode(store, {
      ...options,
      deliver: async () => { throw new Error('provider unavailable'); },
    }),
    /provider unavailable/,
  );
  await assert.doesNotReject(issueCode(store, options));
});
