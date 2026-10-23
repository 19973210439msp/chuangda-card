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
  assert.deepEqual(
    pointerBody('emp-1', 'emp-2', 'card-secondary', '2026-10-20T00:00:00.000Z'),
    {
      userId: 'emp-1',
      cardId: 'emp-2',
      shareCardId: 'card-secondary',
      createdAt: '2026-10-20T00:00:00.000Z',
    }
  );

  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
  for (const [key, value] of previousOss) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('production initial data keeps company branding but no demo people', () => {
  const previousNode = process.env.NODE_ENV;
  const { initialStoreData, seedData } = require('../lib/person');
  process.env.NODE_ENV = 'production';
  const production = initialStoreData();
  process.env.NODE_ENV = 'test';
  const development = initialStoreData();
  process.env.NODE_ENV = previousNode;
  assert.equal(production.company.name, seedData().company.name);
  assert.equal(production.people.length, 0);
  assert.equal(production.views.length, 0);
  assert.ok(development.people.length > 0);
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

test('card access audit reports migration risks without exposing card fields', () => {
  const { summarizeCardAccess } = require('../lib/cardAudit');
  const summary = summarizeCardAccess({
    people: [
      { kind: 'employee', cards: [] },
      {
        kind: 'employee',
        cards: [
          { id: 'card-default', companyId: '', lifecycle: 'active', source: 'legacy_unknown' },
          { id: 'card-real', companyId: '', name: '测试员工' },
        ],
      },
      { kind: 'ocr', cards: [] },
    ],
    companies: [{ id: 'default' }, { id: 'sub-1' }],
    certifications: [{ status: 'approved' }, { status: 'pending' }],
    rootCompany: {
      cardTemplateGrants: { classic: ['sub-1'], horizon: [] },
      cardTemplates: [{ id: 'tpl-1' }],
    },
  });
  assert.deepEqual(summary, {
    employees: 2,
    totalCards: 2,
    zeroCardAccounts: 1,
    unassignedRealCards: 1,
    legacySyntheticCards: 1,
    missingCompanyId: 0,
    missingLifecycle: 1,
    missingSource: 1,
    lifecycle: { active: 1, missing: 1 },
    companies: 2,
    certifications: 2,
    certificationStatus: { approved: 1, pending: 1 },
    customTemplates: 1,
    builtInGrantCount: 1,
  });
  assert.equal(JSON.stringify(summary).includes('测试员工'), false);
});

test('ocr uses Aliyun general structure extraction and reports missing keys', () => {
  const { assertOcrReady, mapDraft, mergeKvData, CARD_KEYS } = require('../lib/aliyunOcr');
  const previousProvider = process.env.OCR_PROVIDER;
  const previousId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const previousKey = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  process.env.OCR_PROVIDER = 'aliyun';
  assert.throws(() => assertOcrReady(), (err) => err.code === 'OCR_NOT_CONFIGURED' && err.message === '识别未配置');
  process.env.OCR_PROVIDER = 'tencent';
  assert.throws(() => assertOcrReady(), (err) => err.code === 'OCR_PROVIDER_INVALID');
  const extracted = mergeKvData([
    { kvInfo: { data: JSON.stringify({ 姓名: '赵六', 公司: '北城实业', 部门: '市场部' }) } },
    { kvInfo: { data: { 职位: '经理', 手机: '13600001111', 邮箱: 'zhao@bei.example', 地址: '杭州市西湖区' } } },
  ]);
  const draft = mapDraft(extracted);
  assert.equal(draft.name, '赵六');
  assert.equal(draft.company, '北城实业');
  assert.equal(draft.title, '市场部 经理');
  assert.equal(draft.phone, '13600001111');
  assert.equal(draft.email, 'zhao@bei.example');
  const noisy = mapDraft({
    手机: '19116390887G',
    邮箱: 'shuman@universalteck.cnC',
    地址: '上海市浦东新区金海路1809号O',
  });
  assert.equal(noisy.phone, '19116390887');
  assert.equal(noisy.email, 'shuman@universalteck.cn');
  assert.equal(noisy.address, '上海市浦东新区金海路1809号');
  assert.deepEqual(CARD_KEYS, ['姓名', '公司', '部门', '职位', '手机', '电话', '邮箱', '微信', '地址']);
  if (previousProvider === undefined) delete process.env.OCR_PROVIDER;
  else process.env.OCR_PROVIDER = previousProvider;
  if (previousId === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  else process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = previousId;
  if (previousKey === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  else process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = previousKey;
});

test('purgeExpiredCodes removes used and long-expired rows', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const previousFile = process.env.DATA_FILE;
  const previousDriver = process.env.STORAGE_DRIVER;
  const dataFile = path.join(os.tmpdir(), `chuangda-purge-${process.pid}.json`);
  process.env.DATA_FILE = dataFile;
  process.env.STORAGE_DRIVER = 'json';
  fs.rmSync(dataFile, { force: true });
  const { resetStoreForTests, getStore } = require('../storage');
  resetStoreForTests();
  const store = getStore();
  await store.ready();
  await store.insertCode({
    id: 'code-used',
    userId: 'emp-1',
    channel: 'sms',
    target: '13800000001',
    codeHash: 'a',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    used: true,
    createdAt: new Date().toISOString(),
  });
  await store.insertCode({
    id: 'code-old',
    userId: 'emp-1',
    channel: 'sms',
    target: '13800000001',
    codeHash: 'b',
    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    used: false,
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await store.insertCode({
    id: 'code-fresh',
    userId: 'emp-1',
    channel: 'sms',
    target: '13800000001',
    codeHash: 'c',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    used: false,
    createdAt: new Date().toISOString(),
  });
  const removed = await store.purgeExpiredCodes({ olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
  assert.equal(removed, 2);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(data.codes.length, 1);
  assert.equal(data.codes[0].id, 'code-fresh');
  resetStoreForTests();
  fs.rmSync(dataFile, { force: true });
  if (previousFile === undefined) delete process.env.DATA_FILE;
  else process.env.DATA_FILE = previousFile;
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
});

test('interest index from stats matches interest index from view rows', () => {
  const { interestIndex, interestIndexFromStats, averageDuration } = require('../lib/interest');
  const views = [
    { durationSec: 60, visitorId: 'a', exchange: null },
    { durationSec: 120, visitorId: 'b', exchange: { name: '客', phone: '13900000000' } },
    { durationSec: 30, visitorId: 'a', exchange: null },
  ];
  const fromRows = interestIndex(views);
  const fromStats = interestIndexFromStats({
    views: views.length,
    avgDurationSec: averageDuration(views),
    visitors: 2,
    exchanges: 1,
  });
  assert.equal(fromStats, fromRows);
});

test('interest index uses views, duration, visitors and exchanges', () => {
  const { interestIndex } = require('../lib/interest');
  assert.equal(interestIndex([]), 0);
  const base = [{ durationSec: 60, visitorId: 'a', exchange: null }];
  assert.equal(interestIndex(base), 20);
  const withExchange = [{ durationSec: 60, visitorId: 'a', exchange: { name: '陈嘉树', phone: '13900002001' } }];
  assert.equal(interestIndex(withExchange), 40);
});
