const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { accessDecision } = require('../lib/cors');

const ORIGIN = 'https://business-card.cdckgroup.com';
const APPID = 'wxc742ba65cb64153d';

function withEnv(extra, fn) {
  const keys = ['NODE_ENV', 'CORS_ORIGINS', 'PUBLIC_BASE_URL', 'WECHAT_APPID'];
  const previous = keys.map((key) => [key, process.env[key]]);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, extra);
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production accepts the official site and rejects other origins and hosts', () => {
  withEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS: ORIGIN,
    WECHAT_APPID: APPID,
  }, () => {
    assert.deepEqual(accessDecision({
      headers: { host: 'business-card.cdckgroup.com', origin: ORIGIN },
    }), { allow: true, reflect: true });

    assert.equal(accessDecision({
      headers: { host: 'business-card.cdckgroup.com', origin: 'https://evil.example' },
    }).allow, false);

    assert.equal(accessDecision({
      headers: { host: '121.40.25.109' },
    }).allow, false);

    assert.equal(accessDecision({
      headers: {
        host: 'business-card.cdckgroup.com',
        origin: 'http://127.0.0.1:43591',
        referer: `https://servicewechat.com/${APPID}/0/page-frame.html`,
      },
    }).allow, true);

    assert.equal(accessDecision({
      headers: {
        host: 'business-card.cdckgroup.com',
        origin: 'https://evil.example',
        referer: 'https://servicewechat.com/wxotherapp/0/page-frame.html',
      },
    }).allow, false);
  });
});

test('development still allows localhost when no public origin is configured', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    assert.equal(accessDecision({
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    }).allow, true);
  });
});

test('live server reflects only the configured origin', async () => {
  process.env.DATA_FILE = require('node:path').join(require('node:os').tmpdir(), `chuangda-cors-${process.pid}.json`);
  process.env.STORAGE_DRIVER = 'json';
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGINS = ORIGIN;
  process.env.PUBLIC_BASE_URL = ORIGIN;
  process.env.WECHAT_APPID = APPID;
  process.env.SKIP_WECHAT_AUTH = 'false';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'admin123';
  delete process.env.DATABASE_URL;

  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  function request(headers) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/api/company',
        method: 'GET',
        headers,
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({
          status: res.statusCode,
          allowOrigin: res.headers['access-control-allow-origin'] || '',
        }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    const allowed = await request({
      Host: 'business-card.cdckgroup.com',
      Origin: ORIGIN,
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.allowOrigin, ORIGIN);

    const blocked = await request({
      Host: 'business-card.cdckgroup.com',
      Origin: 'https://evil.example',
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.allowOrigin, '');

    const byIp = await request({ Host: '121.40.25.109' });
    assert.equal(byIp.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
