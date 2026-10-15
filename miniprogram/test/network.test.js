const test = require('node:test');
const assert = require('node:assert/strict');

function mockWx(onRequest) {
  const storage = new Map();
  global.wx = {
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request: onRequest,
  };
  global.getApp = () => null;
}

test('single configured backend resolves without opening a probe connection', async () => {
  let calls = 0;
  mockWx((options) => {
    calls += 1;
    options.fail({ errMsg: 'request:fail net::ERR_CONNECTION_RESET' });
  });
  const apiBase = require('../utils/api-base');
  assert.equal(await apiBase.resolve(true), 'https://business-card.cdckgroup.com');
  assert.equal(calls, 0);
});

test('a failed login request does not retry with the same WeChat code', async () => {
  let calls = 0;
  let seen = null;
  mockWx((options) => {
    calls += 1;
    seen = options;
    options.fail({ errMsg: 'request:fail net::ERR_CONNECTION_RESET' });
  });
  const { request } = require('../utils/request');
  await assert.rejects(
    request({ url: '/api/auth/wechat', method: 'POST', data: { code: 'one-use-code' } }),
    /ERR_CONNECTION_RESET/,
  );
  assert.equal(calls, 1);
  assert.equal(seen.enableHttp2, false);
  assert.equal(seen.enableQuic, false);
});
