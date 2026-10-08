const assert = require('node:assert/strict');
const test = require('node:test');

test('storage defaults to json and pg-oss refuses a partial setup', () => {
  const previousDriver = process.env.STORAGE_DRIVER;
  const previousDb = process.env.DATABASE_URL;
  const previousOss = ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET']
    .map((key) => [key, process.env[key]]);
  const config = require('../config');
  const { createStore } = require('../storage');
  const { pointerBody } = require('../storage/pgOssStore');

  delete process.env.STORAGE_DRIVER;
  assert.equal(config.storageDriver(), 'json');

  process.env.STORAGE_DRIVER = 'pg-oss';
  delete process.env.DATABASE_URL;
  for (const [key] of previousOss) delete process.env[key];
  assert.throws(() => createStore(), (err) => err.code === 'STORAGE_NOT_CONFIGURED' && /DATABASE_URL/.test(err.message));

  process.env.DATABASE_URL = 'postgres://localhost/chuangda';
  assert.throws(() => createStore(), (err) => err.code === 'STORAGE_NOT_CONFIGURED' && /OSS_REGION/.test(err.message));

  const pointer = pointerBody('emp-1', 'emp-2');
  assert.deepEqual(pointer, { userId: 'emp-1', cardId: 'emp-2' });
  assert.deepEqual(Object.keys(pointer).sort(), ['cardId', 'userId']);

  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
  for (const [key, value] of previousOss) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('production cannot skip WeChat auth', () => {
  const config = require('../config');
  const previousNode = process.env.NODE_ENV;
  const previousSkip = process.env.SKIP_WECHAT_AUTH;
  process.env.NODE_ENV = 'production';
  process.env.SKIP_WECHAT_AUTH = 'true';
  assert.equal(config.wechatSkipAllowed(), false);
  process.env.NODE_ENV = 'test';
  process.env.SKIP_WECHAT_AUTH = 'true';
  assert.equal(config.wechatSkipAllowed(), true);
  process.env.SKIP_WECHAT_AUTH = 'false';
  assert.equal(config.wechatSkipAllowed(), false);
  process.env.NODE_ENV = previousNode;
  if (previousSkip === undefined) delete process.env.SKIP_WECHAT_AUTH;
  else process.env.SKIP_WECHAT_AUTH = previousSkip;
});

test('ocr stays on Tencent and reports missing keys', () => {
  const { assertOcrReady, mapDraft } = require('../lib/tencentOcr');
  const previousProvider = process.env.OCR_PROVIDER;
  const previousId = process.env.TENCENT_SECRET_ID;
  const previousKey = process.env.TENCENT_SECRET_KEY;
  delete process.env.TENCENT_SECRET_ID;
  delete process.env.TENCENT_SECRET_KEY;
  process.env.OCR_PROVIDER = 'tencent';
  assert.throws(() => assertOcrReady(), (err) => err.code === 'OCR_NOT_CONFIGURED' && err.message === '识别未配置');
  process.env.OCR_PROVIDER = 'baidu';
  assert.throws(() => assertOcrReady(), (err) => err.code === 'OCR_PROVIDER_INVALID');
  const draft = mapDraft([
    { Name: '姓名', Value: '赵六' },
    { Name: '公司', Value: '北城实业' },
    { Name: '部门', Value: '市场部' },
    { Name: '职位', Value: '经理' },
    { Name: '手机', Value: '13600001111' },
    { Name: '邮箱', Value: 'zhao@bei.example' },
    { Name: '地址', Value: '杭州市西湖区' },
  ]);
  assert.equal(draft.name, '赵六');
  assert.equal(draft.company, '北城实业');
  assert.equal(draft.title, '市场部 经理');
  assert.equal(draft.phone, '13600001111');
  assert.equal(draft.email, 'zhao@bei.example');
  const noisy = mapDraft([
    { Name: '手机', Value: '19116390887G' },
    { Name: '邮箱', Value: 'shuman@universalteck.cnC' },
    { Name: '地址', Value: '上海市浦东新区金海路1809号O' },
  ]);
  assert.equal(noisy.phone, '19116390887');
  assert.equal(noisy.email, 'shuman@universalteck.cn');
  assert.equal(noisy.address, '上海市浦东新区金海路1809号');
  if (previousProvider === undefined) delete process.env.OCR_PROVIDER;
  else process.env.OCR_PROVIDER = previousProvider;
  if (previousId === undefined) delete process.env.TENCENT_SECRET_ID;
  else process.env.TENCENT_SECRET_ID = previousId;
  if (previousKey === undefined) delete process.env.TENCENT_SECRET_KEY;
  else process.env.TENCENT_SECRET_KEY = previousKey;
});

test('interest index uses views, duration, visitors and exchanges', () => {
  const { interestIndex } = require('../lib/interest');
  assert.equal(interestIndex([]), 0);
  const base = [{ durationSec: 60, visitorId: 'a', exchange: null }];
  assert.equal(interestIndex(base), 20);
  const withExchange = [{ durationSec: 60, visitorId: 'a', exchange: { name: '陈嘉树', phone: '13900002001' } }];
  assert.equal(interestIndex(withExchange), 40);
});
