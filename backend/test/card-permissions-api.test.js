const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');

const dataFile = path.join(os.tmpdir(), `chuangda-permissions-${process.pid}.json`);
process.env.DATA_FILE = dataFile;
process.env.STORAGE_DRIVER = 'json';
process.env.NODE_ENV = 'test';
process.env.SKIP_WECHAT_AUTH = 'true';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';
process.env.REVIEW_TEST_MODE = 'true'; // Retired flag must not create a bypass.
process.env.WECHAT_REVIEW_ENTRY_ENABLED = 'false';
delete process.env.WECHAT_REVIEW_CODE_HASH;
process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'false';
delete process.env.DATABASE_URL;

const { app } = require('../server');

let server;
let base;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

test.before(async () => {
  fs.rmSync(dataFile, { force: true });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataFile, { force: true });
});

test('default policy is hidden and disabled; retired review mode cannot create an admin or enterprise', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const token = hq.json.token;
  const policy = await api('/api/card-permission-policy', { token });
  assert.equal(policy.json.enabled, false);
  assert.equal((await api('/api/card-permission-policy', { method: 'PUT', token, body: { level: 3 } })).status, 403);
  assert.equal((await api('/api/companies', { token })).json.items.some((item) => item.reviewOnly), false);
  assert.equal((await api('/api/login', { method: 'POST', body: { username: '123csmp', password: '123csmp' } })).status, 401);
});

test('review entry is isolated, resettable and revoked as soon as its flag is disabled', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const disabledOptions = await api('/api/auth/options');
  assert.equal(disabledOptions.json.reviewEntryEnabled, false);
  assert.equal((await api('/api/auth/review-login', {
    method: 'POST', body: { code: 'review-demo-code' },
  })).status, 404);

  process.env.WECHAT_REVIEW_ENTRY_ENABLED = 'true';
  process.env.WECHAT_REVIEW_CODE_HASH = crypto.createHash('sha256').update('review-demo-code').digest('hex');
  try {
    const options = await api('/api/auth/options');
    assert.equal(options.json.reviewEntryEnabled, true);
    assert.equal((await api('/api/auth/review-login', {
      method: 'POST', body: { code: 'wrong-code' },
    })).status, 401);

    const login = await api('/api/auth/review-login', {
      method: 'POST', body: { code: 'review-demo-code' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.reviewEntry, true);
    assert.equal(login.json.employee.name, '审核体验员工');
    assert.equal(login.json.employee.cards.length, 1);
    assert.equal(login.json.employee.cards[0].template, 'classic');
    const reviewToken = login.json.token;
    const reviewPersonId = login.json.employee.id;
    const initialCardId = login.json.employee.cards[0].id;

    const me = await api('/api/employee/me', { token: reviewToken });
    assert.equal(me.status, 200);
    assert.equal(me.json.reviewEntry, true);
    assert.equal(me.json.permission.level, 2);
    assert.deepEqual(me.json.permission.companyIds, ['wechat-review-demo']);
    assert.equal((await api('/api/account/phones', { token: reviewToken })).status, 403);
    assert.equal((await api('/api/account/close', {
      method: 'POST', token: reviewToken, body: {},
    })).status, 403);

    const shared = await api('/api/cards/' + reviewPersonId + '?shareCard=' + initialCardId);
    assert.equal(shared.status, 200);
    assert.equal(shared.json.card.activeCardId, initialCardId);

    const templates = await api('/api/employee/templates', { token: reviewToken });
    assert.equal(templates.status, 200);
    assert.deepEqual(templates.json.items.map((item) => item.id).sort(), ['classic', 'horizon', 'wave']);
    assert.ok(templates.json.items.every((item) => item.companyId === 'wechat-review-demo'));

    const created = await api('/api/employee/cards', {
      method: 'POST', token: reviewToken,
      body: { template: 'horizon', companyId: 'wechat-review-demo' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.employee.cards.length, 2);

    const viewed = await api('/api/analytics/view', {
      method: 'POST', body: {
        cardId: reviewPersonId, shareCard: initialCardId, visitorId: 'review-visitor',
      },
    });
    assert.equal(viewed.status, 201);

    const companies = await api('/api/companies', { token: hq.json.token });
    assert.equal(companies.json.items.some((item) => item.id === 'wechat-review-demo'), false);
    const adminTemplates = await api('/api/templates', { token: hq.json.token });
    assert.equal(adminTemplates.json.items.some((item) => item.companyIds.includes('wechat-review-demo')), false);
    const employees = await api('/api/employees', { token: hq.json.token });
    assert.equal(employees.json.items.some((item) => item.id === reviewPersonId), false);
    const permissionAccounts = await api('/api/account-permissions', { token: hq.json.token });
    assert.equal(permissionAccounts.json.items.some((item) => item.id === reviewPersonId), false);
    const analytics = await api('/api/analytics/list', { token: hq.json.token });
    assert.equal(analytics.json.items.some((item) => item.cardId === reviewPersonId), false);
    const summary = await api('/api/analytics/summary', { token: hq.json.token });
    assert.equal(summary.json.items.some((item) => item.cardId === reviewPersonId), false);
    assert.equal((await api('/api/analytics/visitors?cardId=' + reviewPersonId, {
      token: hq.json.token,
    })).status, 404);

    const resetLogin = await api('/api/auth/review-login', {
      method: 'POST', body: { code: 'review-demo-code' },
    });
    assert.equal(resetLogin.status, 200);
    assert.equal(resetLogin.json.employee.cards.length, 1);
    assert.equal(resetLogin.json.employee.cards[0].template, 'classic');
    assert.equal((await api('/api/employee/me', { token: reviewToken })).status, 401);

    process.env.WECHAT_REVIEW_ENTRY_ENABLED = 'false';
    assert.equal((await api('/api/employee/me', { token: resetLogin.json.token })).status, 401);
    assert.equal((await api('/api/auth/options')).json.reviewEntryEnabled, false);
  } finally {
    process.env.WECHAT_REVIEW_ENTRY_ENABLED = 'false';
    delete process.env.WECHAT_REVIEW_CODE_HASH;
  }
});

test('policy applies to registered, manually created and imported accounts and explicit ordinary overrides it', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const token = hq.json.token;
  const registered = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:policy-new', phoneCode: 'dev:13950100001' } });
  const manual = await api('/api/employees', { method: 'POST', token, body: { name: '后台建立', phone: '13950100002' } });
  assert.equal(manual.status, 201);
  const batch = await api('/api/employees/batch', { method: 'POST', token, body: { cardTemplate: 'classic', list: [{ name: '导入建立', phone: '13950100003' }] } });
  assert.equal(batch.status, 201);
  const manualLogin = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:policy-manual', phoneCode: 'dev:13950100002' } });
  const importLogin = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:policy-import', phoneCode: 'dev:13950100003' } });
  const users = [registered, manualLogin, importLogin];
  for (const user of users) assert.equal((await api('/api/employee/me', { token: user.json.token })).json.permission.level, 1);
  process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'true';
  assert.equal((await api('/api/card-permission-policy', { method: 'PUT', token, body: { level: 3 } })).status, 200);
  for (const user of users) assert.equal((await api('/api/employee/me', { token: user.json.token })).json.permission.level, 3);
  await api('/api/account-permissions/' + registered.json.employee.id, { method: 'PUT', token, body: { level: 1 } });
  assert.equal((await api('/api/employee/me', { token: registered.json.token })).json.permission.level, 1);
  process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'false';
  for (const user of users) assert.equal((await api('/api/employee/me', { token: user.json.token })).json.permission.level, 1);
  await api('/api/account-permissions/' + manual.json.employee.id, { method: 'PUT', token, body: { level: 3 } });
  assert.equal((await api('/api/employee/me', { token: manualLogin.json.token })).json.permission.level, 3);
});

test('two company admins grant independently and cannot grant global access or expose unrelated accounts', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const hqToken = hq.json.token;
  const admins = [];
  const companyIds = [];
  for (const suffix of ['a', 'b']) {
    const company = await api('/api/companies', { method: 'POST', token: hqToken, body: { name: '权限企业' + suffix } });
    companyIds.push(company.json.id);
    await api('/api/company-admins', { method: 'POST', token: hqToken, body: { companyId: company.json.id, username: 'perm-' + suffix, password: 'permission-pass' } });
    admins.push((await api('/api/login', { method: 'POST', body: { username: 'perm-' + suffix, password: 'permission-pass' } })).json.token);
  }
  const user = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:company-multi', phoneCode: 'dev:13950200001' } });
  const id = user.json.employee.id;
  assert.equal((await api('/api/account-permissions', { token: admins[0] })).json.items.some((row) => row.id === id), false);
  for (const token of admins) {
    assert.equal((await api('/api/account-permissions', { method: 'POST', token, body: { phone: '13950200001', level: 2 } })).status, 200);
  }
  assert.deepEqual((await api('/api/employee/me', { token: user.json.token })).json.permission.companyIds.sort(), [...companyIds].sort());
  assert.equal((await api('/api/account-permissions/' + id, { method: 'PUT', token: admins[0], body: { level: 3 } })).status, 403);
  assert.equal((await api('/api/account-permissions/' + id, { method: 'PUT', token: admins[0], body: { level: 2, companyIds: [companyIds[1]] } })).status, 403);
  await api('/api/account-permissions/' + id, { method: 'PUT', token: admins[0], body: { level: 1 } });
  const permission = (await api('/api/employee/me', { token: user.json.token })).json.permission;
  assert.equal(permission.companyIds.includes(companyIds[0]), false);
  assert.equal(permission.companyIds.includes(companyIds[1]), true);
  assert.equal((await api('/api/card-permission-policy', { token: admins[0] })).json.policy, null);
  assert.equal((await api('/api/card-permission-policy', { method: 'PUT', token: admins[0], body: { level: 3 } })).status, 403);
  assert.equal((await api('/api/employees', { token: user.json.token })).status, 403);
});

test('registered users receive imports without losing identity and repeated imports update one card without employee numbers', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const token = hq.json.token;
  const user = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:merge-new', phoneCode: 'dev:13950300001' } });
  const id = user.json.employee.id;
  for (const name of ['首次导入', '再次导入']) {
    const result = await api('/api/employees/batch', { method: 'POST', token, body: { cardTemplate: 'classic', list: [{ name, phone: '13950300001', employeeNo: name }] } });
    assert.equal(result.status, 201);
    assert.equal(result.json.items[0].id, id);
    assert.equal(result.json.items[0].merged, true);
    assert.equal(result.json.items[0].cards.length, 1);
  }
  const me = await api('/api/employee/me', { token: user.json.token });
  assert.equal(me.json.employee.id, id);
  assert.equal(me.json.employee.name, '再次导入');
  assert.equal(me.json.permission.level, 1);
  const bad = await api('/api/employees/batch', { method: 'POST', token, body: { cardTemplate: 'classic', list: [{ name: '无手机号' }, { name: '坏号码', phone: 'abc' }, { name: '正确', phone: '13950300002' }] } });
  assert.equal(bad.json.items.length, 1);
  assert.equal(bad.json.rejected.length, 2);
});

test('permissions can be assigned before registration and are claimed by verified phone', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const assigned = await api('/api/account-permissions', {
    method: 'POST', token: hq.json.token, body: { phone: '13950400001', level: 2, companyIds: ['default'] },
  });
  assert.equal(assigned.status, 200);
  const login = await api('/api/auth/wechat', {
    method: 'POST', body: { code: 'dev:permission-claim', phoneCode: 'dev:13950400001' },
  });
  assert.equal(login.json.employee.id, assigned.json.id);
  const me = await api('/api/employee/me', { token: login.json.token });
  assert.equal(me.json.permission.level, 2);
  assert.equal(me.json.employee.authPhone, '13950400001');
  assert.equal((await api('/api/employee/cards', {
    method: 'POST', token: login.json.token, body: { template: 'classic', companyId: 'default' },
  })).status, 201);
});

test('ambiguous account phone is rejected instead of merging into an arbitrary person', async () => {
  const { getStore } = require('../storage');
  const { blankPerson } = require('../lib/person');
  const store = getStore();
  for (const id of ['duplicate-phone-a', 'duplicate-phone-b']) {
    await store.insertPerson(blankPerson({ id, authPhone: '13950500001' }));
  }
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const imported = await api('/api/employees/batch', {
    method: 'POST', token: hq.json.token, body: {
      cardTemplate: 'classic', list: [{ name: '冲突', phone: '13950500001' }, { name: '正常', phone: '13950500002' }],
    },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.json.items.length, 1);
  assert.equal(imported.json.rejected.length, 1);
  assert.match(imported.json.rejected[0].reason, /多个账号/);
  assert.equal((await store.getPerson('duplicate-phone-a')).cards.length, 0);
});

test('batch import uses the imported phone as the account phone and never restores a disabled account', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const first = await api('/api/employees/batch', {
    method: 'POST', token: hq.json.token,
    body: { cardTemplate: 'classic', list: [{ name: '停用后再次导入', phone: '13950600001' }] },
  });
  assert.equal(first.status, 201);
  const employee = first.json.items[0];
  assert.equal(employee.accountPhone, '13950600001');
  assert.equal(employee.phone, '13950600001');

  const disabled = await api('/api/employees/' + employee.id, {
    method: 'PUT', token: hq.json.token, body: { status: 'disabled' },
  });
  assert.equal(disabled.status, 200);

  const importedAgain = await api('/api/employees/batch', {
    method: 'POST', token: hq.json.token,
    body: { cardTemplate: 'classic', list: [{ name: '仍然停用', phone: '13950600001' }] },
  });
  assert.equal(importedAgain.status, 201);
  assert.equal(importedAgain.json.items[0].id, employee.id);
  assert.equal(importedAgain.json.items[0].status, 'disabled');
});

test('manual creation separates account phone from editable card phone', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const created = await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: {
      name: '账号与名片分离', accountPhone: '13950600002', phone: '13850600002',
      cardTemplate: 'classic',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.employee.accountPhone, '13950600002');
  assert.equal(created.json.employee.phone, '13850600002');
  const cardId = created.json.employee.activeCardId;

  const edited = await api('/api/employees/' + created.json.employee.id, {
    method: 'PUT', token: hq.json.token,
    body: { cardId, phone: '13750600002' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.employee.accountPhone, '13950600002');
  assert.equal(edited.json.employee.phone, '13750600002');

  const claimed = await api('/api/auth/wechat', {
    method: 'POST', body: { code: 'dev:separate-account-card-phone', phoneCode: 'dev:13950600002' },
  });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.json.employee.id, created.json.employee.id);
});

test('zero-card accounts remain searchable and can be disabled in employee management', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const assigned = await api('/api/account-permissions', {
    method: 'POST', token: hq.json.token,
    body: { phone: '13950600003', level: 1 },
  });
  assert.equal(assigned.status, 200);

  const listed = await api('/api/employees?q=13950600003', { token: hq.json.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.items.length, 1);
  assert.equal(listed.json.items[0].id, assigned.json.id);
  assert.equal(listed.json.items[0].accountPhone, '13950600003');
  assert.deepEqual(listed.json.items[0].cards, []);

  const disabled = await api('/api/employees/' + assigned.json.id, {
    method: 'PUT', token: hq.json.token, body: { status: 'disabled' },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.employee.status, 'disabled');
});

test('company admins keep seeing related accounts with zero or archived cards', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const company = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '历史名片企业' },
  });
  await api('/api/templates/classic', {
    method: 'PUT', token: hq.json.token, body: { companyIds: [company.json.id] },
  });
  await api('/api/company-admins', {
    method: 'POST', token: hq.json.token,
    body: { companyId: company.json.id, username: 'history-admin', password: 'history-pass' },
  });
  const sub = await api('/api/login', {
    method: 'POST', body: { username: 'history-admin', password: 'history-pass' },
  });
  const assigned = await api('/api/account-permissions', {
    method: 'POST', token: sub.json.token,
    body: { phone: '13950600004', level: 2 },
  });
  assert.equal(assigned.status, 200);

  const zeroCardList = await api('/api/employees?q=13950600004', { token: sub.json.token });
  assert.equal(zeroCardList.status, 200);
  assert.equal(zeroCardList.json.items.length, 1);
  assert.deepEqual(zeroCardList.json.items[0].cards, []);

  const otherCompanyCard = await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: {
      name: '其他企业私有姓名', accountPhone: '13950600007', phone: '13850600007',
      cardTemplate: 'classic', companyId: 'default',
    },
  });
  assert.equal(otherCompanyCard.status, 201);
  await api('/api/account-permissions', {
    method: 'POST', token: sub.json.token,
    body: { phone: '13950600007', level: 2 },
  });
  const scopedEmpty = await api('/api/employees?q=13950600007', { token: sub.json.token });
  assert.equal(scopedEmpty.json.items.length, 1);
  assert.equal(scopedEmpty.json.items[0].accountPhone, '13950600007');
  assert.equal(scopedEmpty.json.items[0].name, '');
  assert.equal(scopedEmpty.json.items[0].phone, '');
  assert.deepEqual(scopedEmpty.json.items[0].cards, []);

  const created = await api('/api/employees', {
    method: 'POST', token: sub.json.token,
    body: {
      name: '保留历史记录', accountPhone: '13950600004', phone: '13850600004',
      cardTemplate: 'classic',
    },
  });
  assert.equal(created.status, 200);
  const archived = await api('/api/employees/' + assigned.json.id, {
    method: 'DELETE', token: sub.json.token,
  });
  assert.equal(archived.status, 200);

  const history = await api('/api/employees?q=13950600004', { token: sub.json.token });
  assert.equal(history.status, 200);
  assert.equal(history.json.items.length, 1);
  assert.equal(history.json.items[0].cards.length, 1);
  assert.equal(history.json.items[0].cards[0].lifecycle, 'archived');
});

test('hq employee merge transfers cards and effective card permissions to the kept account', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const target = await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: { name: '保留账号', accountPhone: '13950600005', phone: '13850600005', cardTemplate: 'classic' },
  });
  const source = await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: { name: '被合并账号', accountPhone: '13950600006', phone: '13850600006', cardTemplate: 'classic' },
  });
  await api('/api/account-permissions/' + target.json.employee.id, {
    method: 'PUT', token: hq.json.token, body: { level: 2, companyIds: ['default'] },
  });
  await api('/api/account-permissions/' + source.json.employee.id, {
    method: 'PUT', token: hq.json.token, body: { level: 3 },
  });

  const merged = await api('/api/employees/' + target.json.employee.id + '/merge', {
    method: 'POST', token: hq.json.token, body: { sourceId: source.json.employee.id },
  });
  assert.equal(merged.status, 200);
  assert.equal(merged.json.employee.cards.length, 2);
  assert.equal(new Set(merged.json.employee.cards.map((card) => card.id)).size, 2);

  const permissionRows = await api('/api/account-permissions?q=13950600005', { token: hq.json.token });
  assert.equal(permissionRows.json.items[0].permission.level, 3);
  const { getStore } = require('../storage');
  const retired = await getStore().getPerson(source.json.employee.id);
  assert.equal(retired.status, 'disabled');
  assert.deepEqual(retired.cards, []);
  assert.equal(retired.cardPermission, undefined);
  assert.equal(retired.companyCardPermissions, undefined);
});
