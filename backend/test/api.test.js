const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const dataFile = path.join(os.tmpdir(), `chuangda-card-${process.pid}.json`);
process.env.DATA_FILE = dataFile;
process.env.STORAGE_DRIVER = 'json';
process.env.NODE_ENV = 'test';
process.env.SKIP_WECHAT_AUTH = 'true';
// General API fixtures exercise writable cards; ordinary-role behavior is tested explicitly below.
process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'true';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';
delete process.env.DATABASE_URL;
process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = '';
process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = '';
process.env.ALIYUN_SMS_SIGN_NAME = '';
process.env.ALIYUN_SMS_TEMPLATE_CODE = '';
process.env.OCR_PROVIDER = 'aliyun';
process.env.LOGIN_FAIL_LIMIT = '5';
process.env.LOGIN_LOCK_MS = '200';

const { app } = require('../server');
const { getStore } = require('../storage');
const { blankPerson } = require('../lib/person');
const crypto = require('node:crypto');

let server;
let base;

async function api(pathname, { method = 'GET', token, body, form } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  }
  return { status: response.status, json };
}

test.before(async () => {
  fs.rmSync(dataFile, { force: true });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await api('/api/company');
  const root = await getStore().getCompany('default');
  await getStore().saveCompanyRecord('default', { ...root, defaultCardPermission: { level: 3, companyIds: [] } });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataFile, { force: true });
});

test('employee card, holder, account and analytics', async () => {
  const company = await api('/api/company');
  assert.equal(company.status, 200);
  assert.equal(company.json.company.name, '上海创大产控高新技术集团有限公司');

  const staffLogin = await api('/api/login', { method: 'POST', body: { username: '1001', password: '1001' } });
  assert.equal(staffLogin.status, 401);

  const adminLogin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.json.role, 'admin');
  const adminToken = adminLogin.json.token;

  const forbidden = await api('/api/employees', { token: adminToken });
  assert.equal(forbidden.status, 200);

  const wechat = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:tester' } });
  assert.equal(wechat.status, 200);
  assert.equal(wechat.json.role, 'employee');
  const token = wechat.json.token;
  let employeeId = wechat.json.employee.id;

  const saved = await api('/api/employee/me', {
    method: 'PUT',
    token,
    body: { name: '测试员工', title: '业务经理', phone: '123' },
  });
  assert.equal(saved.status, 409);
  assert.equal(saved.json.error.code, 'NO_ACTIVE_CARD');

  const phoneByWechat = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phoneCode: 'dev:13811112222' },
  });
  assert.equal(phoneByWechat.status, 200);
  assert.equal(phoneByWechat.json.employee.phone, '13811112222');

  const me = await api('/api/employee/me', { token });
  assert.equal(me.json.employee.avatar, undefined);
  assert.equal(me.json.employee.portrait, undefined);
  assert.notEqual(me.json.employee.name, '测试员工');

  const initialCard = await api('/api/employee/cards', { method: 'POST', token, body: { template: 'classic', companyId: 'default' } });
  assert.equal(initialCard.status, 201);
  const profile = await api('/api/employee/me', {
    method: 'PUT',
    token,
    body: { name: '测试员工', title: '业务经理', wechat: 'tester-wx' },
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.json.employee.name, '测试员工');
  assert.equal(profile.json.employee.avatar, undefined);
  assert.equal(profile.json.employee.portrait, undefined);

  const missingCode = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13800009999' },
  });
  assert.equal(missingCode.status, 400);

  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token,
    body: { phone: '13811113333' },
  });
  assert.equal(sms.status, 200);
  assert.match(sms.json.devCode, /^\d{6}$/);
  const repeatedSms = await api('/api/account/phone/code', {
    method: 'POST',
    token,
    body: { phone: '13811113333' },
  });
  assert.equal(repeatedSms.status, 429);
  assert.equal(repeatedSms.json.error.code, 'CODE_RATE_LIMIT');
  await api('/api/employee/cards/' + initialCard.json.employee.activeCardId, { method: 'DELETE', token });
  const phoneSaved = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13811113333', code: sms.json.devCode },
  });
  assert.equal(phoneSaved.status, 200);
  assert.equal(phoneSaved.json.employee.phone, '13811113333');
  assert.notEqual(phoneSaved.json.employee.id, employeeId);
  assert.equal(phoneSaved.json.employee.name || '', '');
  const kept = await api('/api/cards/' + employeeId);
  assert.equal(kept.status, 404);
  assert.equal(kept.json.error.code, 'NO_ACTIVE_CARD');
  employeeId = phoneSaved.json.employee.id;

  const emailCard = await api('/api/employee/cards', { method: 'POST', token, body: { template: 'classic', companyId: 'default' } });
  const emailSaved = await api('/api/employee/me', {
    method: 'PUT',
    token,
    body: { email: 'tester@chuangda.example' },
  });
  assert.equal(emailSaved.status, 200);
  assert.equal(emailSaved.json.employee.email, 'tester@chuangda.example');
  const home = await api('/api/employee/me', { token });
  assert.equal(home.json.employee.phone, '13811113333');
  assert.equal(home.json.employee.email, 'tester@chuangda.example');

  await api('/api/employee/cards/' + emailCard.json.employee.activeCardId, { method: 'DELETE', token });
  const reused = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13811114444', code: sms.json.devCode },
  });
  assert.equal(reused.status, 400);
  assert.equal((await api('/api/employee/me', { token })).json.employee.phone, '13811113333');

  const unknown = await api('/api/holder', { method: 'POST', token, body: { cardId: 'emp-missing' } });
  assert.equal(unknown.status, 404);
  const noId = await api('/api/holder', { method: 'POST', token, body: {} });
  assert.equal(noId.status, 400);
  const selfFav = await api('/api/holder', { method: 'POST', token, body: { cardId: employeeId } });
  assert.equal(selfFav.status, 404);

  const publicSharedCard = await api('/api/cards/emp-1001');
  assert.equal(publicSharedCard.status, 200);
  const anonymousFavorite = await api('/api/holder', { method: 'POST', body: { cardId: 'emp-1001' } });
  assert.equal(anonymousFavorite.status, 401);

  const favorite = await api('/api/holder', { method: 'POST', token, body: { cardId: 'emp-1001' } });
  assert.equal(favorite.status, 201);
  assert.equal(favorite.json.item.card.name, '林启明');
  const holder = await api('/api/holder', { token });
  assert.equal(holder.json.items.some((item) => item.cardId === 'emp-1001'), true);

  const confirmed = await api('/api/holder/confirm', {
    method: 'POST',
    token,
    body: { name: '纸质客户', company: '外滩制造', phone: '021-55556666', title: '厂长' },
  });
  assert.equal(confirmed.status, 201);
  const ocrId = confirmed.json.item.cardId;
  assert.equal(confirmed.json.item.card.cardTemplate, 'wave');
  assert.equal(confirmed.json.item.card.templateLabel, '蓝韵模板');
  const hidden = await api('/api/cards/' + ocrId);
  assert.equal(hidden.status, 404);
  const owned = await api('/api/cards/' + ocrId, { token });
  assert.equal(owned.status, 200);
  assert.equal(owned.json.card.name, '纸质客户');
  assert.equal(owned.json.card.cardTemplate, 'wave');
  assert.equal(owned.json.company, null);

  const blankConfirmed = await api('/api/holder/confirm', {
    method: 'POST',
    token,
    body: {},
  });
  assert.equal(blankConfirmed.status, 201);
  assert.equal(blankConfirmed.json.item.card.name, '');
  assert.equal(blankConfirmed.json.item.card.phone, '');

  const form = new FormData();
  form.append('photo', new Blob([Buffer.from('fake-image')]), 'card.jpg');
  const ocr = await api('/api/holder/recognize', { method: 'POST', token, form });
  assert.equal(ocr.status, 503);
  assert.equal(ocr.json.error.message, '识别未配置');

  const beforeClose = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const viewCount = beforeClose.views.length;
  const closed = await api('/api/account/close', { method: 'POST', token });
  assert.equal(closed.status, 200);
  const afterClose = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const closedPerson = afterClose.people.find((person) => person.id === employeeId);
  assert.equal(closedPerson.status, 'closed');
  assert.equal(closedPerson.phone, '13811113333');
  assert.equal(afterClose.views.length, viewCount);
  assert.equal(afterClose.holders.some((item) => item.userId === employeeId && item.cardId === 'emp-1001'), true);
  assert.equal(afterClose.holders.some((item) => item.cardId === ocrId), true);
  assert.equal(afterClose.people.some((person) => person.id === ocrId), true);
  assert.equal(afterClose.sessions.some((session) => session.userId === employeeId), false);

  const invisible = await api('/api/cards/' + employeeId);
  assert.equal(invisible.status, 404);
  assert.equal(invisible.json.error.code, 'CARD_UNAVAILABLE');
  const blocked = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:tester' } });
  assert.equal(blocked.status, 403);

  const restored = await api('/api/employees/' + employeeId, {
    method: 'PUT',
    token: adminToken,
    body: { status: 'active' },
  });
  assert.equal(restored.status, 200);
  const visible = await api('/api/cards/' + employeeId);
  assert.equal(visible.status, 404);
  assert.equal(visible.json.error.code, 'NO_ACTIVE_CARD');

  const imported = await api('/api/employees/batch', {
    method: 'POST',
    token: adminToken,
    body: { list: [{ employeeNo: '1008', name: '沈知衡', title: '分析师', phone: '13800001008' }] },
  });
  assert.equal(imported.status, 201);
  assert.match(imported.json.items[0].id, /^emp-/);
  assert.equal(imported.json.items[0].phone, '13800001008');

  const viewed = await api('/api/analytics/view', {
    method: 'POST',
    body: { cardId: 'emp-1001', visitorId: 'visitor-test' },
  });
  assert.equal(viewed.status, 201);
  assert.match(viewed.json.updateToken, /^[a-f0-9]{32}$/);
  const rejectedDuration = await api('/api/analytics/view/' + viewed.json.viewId, {
    method: 'PUT',
    body: { updateToken: 'wrong-token', durationSec: 90 },
  });
  assert.equal(rejectedDuration.status, 403);
  const guestList = await api('/api/analytics/list?cardId=emp-1001', { token: adminToken });
  const guest = guestList.json.items.find((item) => item.visitorId === 'visitor-test');
  assert.equal(guest.name, '游客访问');
  assert.equal(Object.prototype.hasOwnProperty.call(guest, 'updateTokenHash'), false);
  const duration = await api('/api/analytics/view/' + viewed.json.viewId, {
    method: 'PUT',
    body: { updateToken: viewed.json.updateToken, durationSec: 90, exchange: { name: '来访者', phone: '13700008888', company: '南市集团' } },
  });
  assert.equal(duration.status, 200);
  const securedList = await api('/api/analytics/list?cardId=emp-1001', { token: adminToken });
  const securedView = securedList.json.items.find((item) => item.visitorId === 'visitor-test');
  assert.ok(securedView.durationSec <= 31);
  const summary = await api('/api/analytics/summary?cardId=emp-1001', { token: adminToken });
  assert.equal(summary.status, 200);
  assert.ok(summary.json.items[0].views >= 3);
  assert.ok(summary.json.items[0].interestIndex > 0);

  const loggedOut = await api('/api/auth/logout', { method: 'POST', token: adminToken });
  assert.equal(loggedOut.status, 200);
  const afterLogout = await api('/api/me', { token: adminToken });
  assert.equal(afterLogout.status, 401);
});

test('two wechat accounts stay separate until phone matches an import', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const first = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:alpha-phone' } });
  const second = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:beta-phone' } });
  assert.notEqual(first.json.employee.id, second.json.employee.id);

  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token: first.json.token,
    body: { phone: '13822223333' },
  });
  const saved = await api('/api/account/phone', {
    method: 'PUT',
    token: first.json.token,
    body: { phone: '13822223333', code: sms.json.devCode },
  });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.json.employee.id, first.json.employee.id);

  const sms2 = await api('/api/account/phone/code', {
    method: 'POST',
    token: second.json.token,
    body: { phone: '13822223333' },
  });
  const blocked = await api('/api/account/phone', {
    method: 'PUT',
    token: second.json.token,
    body: { phone: '13822223333', code: sms2.json.devCode },
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.json.loggedIn, true);
  assert.equal(blocked.json.employee.id, saved.json.employee.id);

  const imported = await api('/api/employees', {
    method: 'POST',
    token: admin.json.token,
    body: { employeeNo: '2099', name: '同一人', phone: '13822223333', title: '经理' },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.merged, true);
  assert.equal(imported.json.employee.id, saved.json.employee.id);
  assert.equal(imported.json.employee.employeeNo, '2099');

  const left = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:merge-left' } });
  const right = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:merge-right' } });
  const conflict = await api('/api/employees/' + left.json.employee.id + '/merge', {
    method: 'POST',
    token: admin.json.token,
    body: { sourceId: right.json.employee.id },
  });
  assert.equal(conflict.status, 409);
});

test('binding the imported phone claims that card for the current wechat', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const imported = await api('/api/employees/batch', {
    method: 'POST',
    token: admin.json.token,
    body: {
      list: [{
        name: '导入员工',
        title: '顾问',
        phone: '13900001111',
        email: 'import@chuangda.example',
        company: '上海创大产控高新技术集团有限公司',
        address: '测试路1号',
      }],
    },
  });
  assert.equal(imported.status, 201);
  const importedId = imported.json.items[0].id;

  const login = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:claim-user' } });
  assert.equal(login.status, 200);
  assert.notEqual(login.json.employee.id, importedId);

  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token: login.json.token,
    body: { phone: '13900001111' },
  });
  const bound = await api('/api/account/phone', {
    method: 'PUT',
    token: login.json.token,
    body: { phone: '13900001111', code: sms.json.devCode },
  });
  assert.equal(bound.status, 200);
  assert.equal(bound.json.claimed, true);
  assert.equal(bound.json.employee.id, importedId);
  assert.equal(bound.json.employee.name, '导入员工');
  assert.equal(bound.json.employee.title, '顾问');
  assert.equal(bound.json.employee.address, '测试路1号');

  const me = await api('/api/employee/me', { token: login.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.employee.id, importedId);
  assert.equal(me.json.employee.email, 'import@chuangda.example');

  const again = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:claim-user' } });
  assert.equal(again.status, 200);
  assert.equal(again.json.employee.id, importedId);

  const other = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:claim-other' } });
  const sms2 = await api('/api/account/phone/code', {
    method: 'POST',
    token: other.json.token,
    body: { phone: '13900001111' },
  });
  const stolen = await api('/api/account/phone', {
    method: 'PUT',
    token: other.json.token,
    body: { phone: '13900001111', code: sms2.json.devCode },
  });
  assert.equal(stolen.status, 200);
  assert.equal(stolen.json.loggedIn, true);
  assert.equal(stolen.json.employee.id, importedId);
  const otherMe = await api('/api/employee/me', { token: other.json.token });
  assert.equal(otherMe.json.employee.id, importedId);
});

test('wechat phone login claims imported employee without SMS', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const imported = await api('/api/employees/batch', {
    method: 'POST',
    token: admin.json.token,
    body: {
      list: [{
        name: '登录直领',
        title: '销售',
        phone: '13900002222',
        email: 'direct@chuangda.example',
        company: '上海创大产控高新技术集团有限公司',
      }],
    },
  });
  assert.equal(imported.status, 201);
  const importedId = imported.json.items[0].id;

  const login = await api('/api/auth/wechat', {
    method: 'POST',
    body: { code: 'dev:direct-claim', phoneCode: 'dev:13900002222' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.claimed, true);
  assert.equal(login.json.matchedImport, true);
  assert.equal(login.json.employee.id, importedId);
  assert.equal(login.json.employee.name, '登录直领');
  assert.equal(login.json.employee.title, '销售');
  assert.equal(login.json.employee.email, 'direct@chuangda.example');

  const shellFirst = await api('/api/auth/wechat', {
    method: 'POST',
    body: { code: 'dev:shell-then-claim' },
  });
  assert.equal(shellFirst.status, 200);
  assert.notEqual(shellFirst.json.employee.id, importedId);

  const imported2 = await api('/api/employees/batch', {
    method: 'POST',
    token: admin.json.token,
    body: {
      list: [{
        name: '先壳后领',
        title: '顾问',
        phone: '13900003333',
      }],
    },
  });
  const imported2Id = imported2.json.items[0].id;
  const claimLater = await api('/api/auth/wechat', {
    method: 'POST',
    body: { code: 'dev:shell-then-claim', phoneCode: 'dev:13900003333' },
  });
  assert.equal(claimLater.status, 200);
  assert.equal(claimLater.json.claimed, true);
  assert.equal(claimLater.json.employee.id, imported2Id);
  assert.equal(claimLater.json.employee.name, '先壳后领');
});

test('deleting an employee also removes that card\'s view records', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const created = await api('/api/employees', {
    method: 'POST',
    token: admin.json.token,
    body: { employeeNo: '3099', name: '待删员工', phone: '13800003099', title: '测试' },
  });
  assert.equal(created.status, 201);
  const cardId = created.json.employee.id;

  const viewed = await api('/api/analytics/view', {
    method: 'POST',
    body: { cardId, visitorId: 'visitor-orphan' },
  });
  assert.equal(viewed.status, 201);

  const store = getStore();
  await store.createSession({
    token: 'session-' + cardId,
    userId: cardId,
    role: 'employee',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    secretStamp: '',
  });
  await store.putHolderRef({ userId: cardId, cardId: 'emp-1001', createdAt: new Date().toISOString() });
  await store.putHolderRef({ userId: 'emp-1002', cardId, createdAt: new Date().toISOString() });
  await store.insertCode({
    id: 'code-' + cardId,
    userId: cardId,
    channel: 'sms',
    target: '13800003099',
    codeHash: 'hash',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    used: false,
    createdAt: new Date().toISOString(),
  });
  await store.saveAccountLink({
    openid: 'openid-' + cardId,
    personId: cardId,
    createdAt: new Date().toISOString(),
  });
  const uploadName = 'del-' + cardId + '.png';
  const uploadPath = path.join(require('../config').uploadDir(), uploadName);
  fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
  fs.writeFileSync(uploadPath, Buffer.from('attachment'));
  await store.updatePerson(cardId, {
    ...(await store.getPerson(cardId)),
    attachments: [{ name: '附件', url: '/uploads/' + uploadName }],
    updatedAt: new Date().toISOString(),
  });

  const before = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const otherViewCount = before.views.filter((view) => view.cardId !== cardId).length;
  assert.equal(before.views.some((view) => view.id === viewed.json.viewId), true);
  assert.equal(before.codes.some((row) => row.userId === cardId), true);
  assert.equal(before.accountLinks.some((row) => row.personId === cardId), true);
  assert.equal(fs.existsSync(uploadPath), true);

  const removed = await api('/api/employees/' + cardId, { method: 'DELETE', token: admin.json.token });
  assert.equal(removed.status, 200);

  const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(after.people.some((person) => person.id === cardId), false);
  assert.equal(after.views.some((view) => view.cardId === cardId), false);
  assert.equal(after.views.some((view) => view.id === viewed.json.viewId), false);
  assert.equal(after.sessions.some((session) => session.userId === cardId), false);
  assert.equal(after.holders.some((item) => item.userId === cardId || item.cardId === cardId), false);
  assert.equal(after.codes.some((row) => row.userId === cardId), false);
  assert.equal(after.accountLinks.some((row) => row.personId === cardId), false);
  assert.equal(fs.existsSync(uploadPath), false);
  assert.equal(after.views.filter((view) => view.cardId !== cardId).length, otherViewCount);

  const listed = await api('/api/analytics/list?cardId=' + encodeURIComponent(cardId), { token: admin.json.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.items.length, 0);
  assert.equal(listed.json.total, 0);
});

test('admin update rejects a zero-card employee instead of reporting a false save', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const store = getStore();
  const person = blankPerson({
    id: 'emp-zero-card-admin-edit',
    employeeNo: 'zero-card-edit',
    name: '',
    phone: '13800003998',
    cards: [],
  });
  await store.insertPerson(person);

  const saved = await api('/api/employees/' + person.id, {
    method: 'PUT',
    token: admin.json.token,
    body: { name: '不会被假保存', phone: person.phone },
  });
  assert.equal(saved.status, 409);
  assert.equal(saved.json.error.code, 'NO_ACTIVE_CARD');
  assert.equal((await store.getPerson(person.id)).name, '');
  await store.deletePerson(person.id);
});

test('hq new-card action appends a card even when the company and template repeat', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const templates = ['classic', 'horizon', 'classic'];
  let latest;
  for (let index = 0; index < templates.length; index += 1) {
    latest = await api('/api/employees', {
      method: 'POST',
      token: admin.json.token,
      body: {
        name: '重复模板名片 ' + (index + 1),
        phone: '13800003997',
        companyId: 'default',
        cardTemplate: templates[index],
      },
    });
    assert.ok([200, 201].includes(latest.status), JSON.stringify(latest.json));
  }

  assert.equal(latest.json.employee.cards.length, 3);
  assert.equal(new Set(latest.json.employee.cards.map((card) => card.id)).size, 3);
  assert.deepEqual(latest.json.employee.cards.map((card) => card.template), templates);
  await getStore().deletePerson(latest.json.employee.id);
});

test('upload rejects content whose bytes do not match the file extension', async () => {
  const employee = await api('/api/auth/wechat', {
    method: 'POST',
    body: { code: 'dev:spoofed-upload' },
  });
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'text/html' }), 'avatar.png');

  const uploaded = await api('/api/upload', { method: 'POST', token: employee.json.token, form });
  assert.equal(uploaded.status, 400);
  assert.equal(uploaded.json.error.code, 'UNSUPPORTED_FILE_TYPE');
});

test('upload derives image content type from bytes and serves it with nosniff', async () => {
  const employee = await api('/api/auth/wechat', {
    method: 'POST',
    body: { code: 'dev:valid-upload' },
  });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = new FormData();
  form.append('file', new Blob([pngHeader], { type: 'text/html' }), 'safe.png');

  const uploaded = await api('/api/upload', { method: 'POST', token: employee.json.token, form });
  assert.equal(uploaded.status, 201);
  const response = await fetch(base + uploaded.json.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const filename = path.basename(uploaded.json.url);
  fs.rmSync(path.join(require('../config').uploadDir(), filename), { force: true });
});

test('analytics summary counts every view and list paginates', async () => {
  const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const created = await api('/api/employees', {
    method: 'POST',
    token: admin.json.token,
    body: { employeeNo: '3101', name: '聚合员工', phone: '13800003101', title: '测试' },
  });
  assert.equal(created.status, 201);
  const cardId = created.json.employee.id;
  for (let i = 0; i < 7; i += 1) {
    const viewed = await api('/api/analytics/view', {
      method: 'POST',
      body: { cardId, visitorId: 'pager-' + (i % 3) },
    });
    assert.equal(viewed.status, 201);
    await api('/api/analytics/view/' + viewed.json.viewId, {
      method: 'PUT',
      body: { updateToken: viewed.json.updateToken, durationSec: 30 + i },
    });
  }
  const summary = await api('/api/analytics/summary?cardId=' + encodeURIComponent(cardId), { token: admin.json.token });
  assert.equal(summary.status, 200);
  assert.equal(summary.json.items[0].views, 7);
  assert.equal(summary.json.items[0].visitors, 3);

  const page1 = await api(
    '/api/analytics/list?cardId=' + encodeURIComponent(cardId) + '&page=1&limit=3',
    { token: admin.json.token }
  );
  assert.equal(page1.status, 200);
  assert.equal(page1.json.total, 7);
  assert.equal(page1.json.page, 1);
  assert.equal(page1.json.limit, 3);
  assert.equal(page1.json.items.length, 3);

  const page3 = await api(
    '/api/analytics/list?cardId=' + encodeURIComponent(cardId) + '&page=3&limit=3',
    { token: admin.json.token }
  );
  assert.equal(page3.status, 200);
  assert.equal(page3.json.items.length, 1);
});

test('admin login locks after repeated failures', async () => {
  for (let i = 0; i < 5; i += 1) {
    const failed = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'wrong-pass' } });
    assert.equal(failed.status, 401);
  }
  const lockedWrong = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'wrong-pass' } });
  assert.equal(lockedWrong.status, 429);
  const lockedRight = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(lockedRight.status, 429);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const ok = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(ok.status, 200);
});

test('expired admin session is rejected', async () => {
  const store = getStore();
  await store.ready();
  const token = 'expired-' + crypto.randomBytes(4).toString('hex');
  await store.createSession({
    token,
    userId: 'admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    secretStamp: crypto.createHash('sha256').update('admin123').digest('hex'),
  });
  const me = await api('/api/me', { token });
  assert.equal(me.status, 401);
});

test('changing ADMIN_PASS invalidates existing admin sessions', async () => {
  const login = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(login.status, 200);
  const token = login.json.token;
  const previous = process.env.ADMIN_PASS;
  process.env.ADMIN_PASS = 'new-admin-pass';
  try {
    const me = await api('/api/me', { token });
    assert.equal(me.status, 401);
  } finally {
    process.env.ADMIN_PASS = previous;
  }
});

test('company admin template visibility, ownership isolation and pinned share links', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(hq.status, 200);
  const hqToken = hq.json.token;

  const created = await api('/api/companies', {
    method: 'POST',
    token: hqToken,
    body: { name: '子公司甲', shortName: '子甲' },
  });
  assert.equal(created.status, 201);
  const companyId = created.json.id;

  assert.equal((await api('/api/templates/classic', {
    method: 'PUT', token: hqToken, body: { companyIds: [companyId] },
  })).status, 200);

  const adminCreated = await api('/api/company-admins', {
    method: 'POST',
    token: hqToken,
    body: { companyId, username: 'subadmin', password: 'subpass1' },
  });
  assert.equal(adminCreated.status, 201);

  const subLogin = await api('/api/login', { method: 'POST', body: { username: 'subadmin', password: 'subpass1' } });
  assert.equal(subLogin.status, 200);
  assert.equal(subLogin.json.scope, 'company');
  const subToken = subLogin.json.token;

  const ownCompany = await api('/api/company', { token: subToken });
  assert.equal(ownCompany.status, 200);
  assert.equal(ownCompany.json.company.name, '子公司甲');
  assert.equal(Object.prototype.hasOwnProperty.call(ownCompany.json.company, 'certCode'), false);
  const otherCompany = await api('/api/company?id=default', { token: subToken });
  assert.equal(otherCompany.status, 403);
  assert.equal(otherCompany.json.error.code, 'FORBIDDEN');

  const companies = await api('/api/companies', { token: subToken });
  assert.equal(companies.status, 403);

  const hqCreatedForSubsidiary = await api('/api/employees', {
    method: 'POST', token: hqToken,
    body: {
      companyId,
      cardTemplate: 'classic',
      name: '总部代建子公司员工',
      phone: '13911110000',
      title: '平台主管',
    },
  });
  assert.equal(hqCreatedForSubsidiary.status, 201, JSON.stringify(hqCreatedForSubsidiary.json));
  assert.equal(hqCreatedForSubsidiary.json.employee.cards[0].companyId, companyId);
  assert.equal(hqCreatedForSubsidiary.json.employee.cards[0].company, '子公司甲');
  const hqImportedForSubsidiary = await api('/api/employees/batch', {
    method: 'POST', token: hqToken,
    body: {
      companyId,
      cardTemplate: 'classic',
      list: [{ name: '总部代导子公司员工', phone: '13911110004', title: '平台主管' }],
    },
  });
  assert.equal(hqImportedForSubsidiary.status, 201, JSON.stringify(hqImportedForSubsidiary.json));
  assert.equal(hqImportedForSubsidiary.json.items[0].cards[0].companyId, companyId);
  assert.equal(hqImportedForSubsidiary.json.items[0].cards[0].company, '子公司甲');

  const hqOnly = await api('/api/employees', {
    method: 'POST',
    token: hqToken,
    body: { name: '仅总部', phone: '13911110001', title: '经理', cardTemplate: 'wave' },
  });
  assert.equal(hqOnly.status, 201);
  const hqOnlyId = hqOnly.json.employee.id;

  const both = await api('/api/employees', {
    method: 'POST',
    token: hqToken,
    body: { name: '总部名片', phone: '13911110002', title: '顾问', company: '总部', cardTemplate: 'wave' },
  });
  assert.equal(both.status, 201);
  const personId = both.json.employee.id;
  const hqCardId = both.json.employee.cards[0].id;

  const imported = await api('/api/employees/batch', {
    method: 'POST',
    token: subToken,
    body: {
      cardTemplate: 'classic',
      list: [{ name: '子公司名片', phone: '13911110002', title: '专员', company: '子公司甲' }],
    },
  });
  assert.equal(imported.status, 201);
  assert.equal((await api('/api/employees/batch', {
    method: 'POST', token: subToken,
    body: { cardTemplate: 'wave', list: [{ name: '越权模板', phone: '13911110003' }] },
  })).status, 403);
  assert.equal(imported.json.items[0].cards.every((card) => card.companyId === companyId), true);
  const importedCard = imported.json.items[0].cards.find((card) => card.companyId === companyId);
  const accounts = await api('/api/account-permissions', { token: subToken });
  assert.equal(accounts.status, 200);
  assert.equal(accounts.json.items.some((item) => item.id === personId), true);

  const subList = await api('/api/employees', { token: subToken });
  assert.equal(subList.json.items.some((item) => item.id === hqOnlyId), false);
  const visible = subList.json.items.find((item) => item.id === personId);
  assert.ok(visible);
  assert.equal(visible.name, '子公司名片');
  assert.equal(visible.cards.every((card) => card.companyId === companyId), true);
  const ownCardId = visible.cards[0].id;

  assert.equal((await api('/api/employees/' + hqOnlyId, { token: subToken })).status, 404);
  assert.equal((await api('/api/employees/' + personId, {
    method: 'PUT',
    token: subToken,
    body: { name: '越权', phone: '13911110002' },
  })).status, 400);
  assert.equal((await api('/api/employees/' + personId, {
    method: 'PUT',
    token: subToken,
    body: { cardId: hqCardId, name: '越权改总部', phone: '13911110002' },
  })).status, 403);

  const renamed = await api('/api/employees/' + personId, {
    method: 'PUT',
    token: subToken,
    body: {
      cardId: ownCardId,
      name: '子公司已改',
      phone: '13911110002',
      title: '专员',
      department: '窃取部门',
      status: 'disabled',
    },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.employee.status, 'active');
  assert.equal(renamed.json.employee.department || '', '');
  assert.equal(renamed.json.employee.cards.every((card) => card.companyId === companyId), true);

  const hqView = await api('/api/employees/' + personId, { token: hqToken });
  assert.equal(hqView.json.employee.status, 'active');
  assert.equal(hqView.json.employee.department || '', '');
  assert.equal(hqView.json.employee.cards.find((card) => card.id === hqCardId).name, '总部名片');
  assert.equal(hqView.json.employee.cards.find((card) => card.id === ownCardId).name, '子公司已改');

  assert.equal((await api('/api/employees/' + personId + '/merge', {
    method: 'POST',
    token: subToken,
    body: { sourceId: hqOnlyId },
  })).status, 403);
  assert.equal((await api('/api/employees/' + personId + '/cards/' + hqCardId, {
    method: 'DELETE',
    token: subToken,
  })).status, 403);

  assert.equal((await api('/api/company', {
    method: 'PUT',
    token: subToken,
    body: { companyId: 'default', name: '被改掉的总部' },
  })).status, 403);
  const brandOk = await api('/api/company', {
    method: 'PUT',
    token: subToken,
    body: { name: '子公司甲新名' },
  });
  assert.equal(brandOk.status, 200);
  assert.equal(brandOk.json.company.name, '子公司甲新名');
  assert.equal((await api('/api/company')).json.company.name, '上海创大产控高新技术集团有限公司');

  const pinned = await api('/api/cards/' + personId + '?shareCard=' + encodeURIComponent(hqCardId));
  assert.equal(pinned.status, 200);
  assert.equal(pinned.json.card.name, '总部名片');
  const missing = await api('/api/cards/' + personId + '?shareCard=card-missing');
  assert.equal(missing.status, 404);
  assert.equal(JSON.stringify(missing.json).includes('13911110002'), false);
  assert.equal((await api('/api/cards/' + personId + '/qr?shareCard=card-missing')).status, 404);
  assert.equal((await api('/api/cards/' + personId + '/qr?shareCard=' + encodeURIComponent(ownCardId))).status, 200);

  const hqMixedView = await api('/api/analytics/view', {
    method: 'POST', body: { cardId: personId, shareCard: hqCardId, visitorId: 'v-hq-mixed' },
  });
  const subMixedView = await api('/api/analytics/view', {
    method: 'POST', body: { cardId: personId, shareCard: ownCardId, visitorId: 'v-sub-mixed' },
  });
  assert.equal(hqMixedView.status, 201);
  assert.equal(subMixedView.status, 201);
  const scopedViews = await api('/api/analytics/list?cardId=' + personId, { token: subToken });
  assert.equal(scopedViews.json.items.some((item) => item.id === hqMixedView.json.viewId), false);
  assert.equal(scopedViews.json.items.some((item) => item.id === subMixedView.json.viewId), true);
  const scopedSummary = await api('/api/analytics/summary?cardId=' + personId, { token: subToken });
  assert.equal(scopedSummary.json.items[0].views, 1);

  await api('/api/analytics/view', { method: 'POST', body: { cardId: hqOnlyId, visitorId: 'v-secret' } });
  const list = await api('/api/analytics/list', { token: subToken });
  assert.equal(list.status, 200);
  assert.equal(list.json.items.some((item) => item.cardId === hqOnlyId), false);
  assert.equal((await api('/api/analytics/visitors?cardId=' + hqOnlyId, { token: subToken })).status, 403);

  assert.equal((await api('/api/employees/' + personId, { method: 'DELETE', token: subToken })).status, 200);
  const still = await api('/api/employees/' + personId, { token: hqToken });
  assert.equal(still.status, 200);
  assert.equal(still.json.employee.cards.some((card) => card.id === hqCardId), true);
  assert.equal(still.json.employee.cards.some((card) => (
    card.id === ownCardId && card.lifecycle === 'archived'
  )), true);
  assert.equal((await api('/api/employees/' + personId, {
    method: 'PUT', token: hqToken,
    body: { cardId: ownCardId, name: '不能修改归档卡', phone: '13911110002' },
  })).status, 409);

  const subOnly = await api('/api/employees', {
    method: 'POST',
    token: subToken,
    body: {
      name: '只有子公司', phone: '13911110003', title: '助理', cardTemplate: 'classic',
    },
  });
  assert.equal(subOnly.status, 201, JSON.stringify(subOnly.json));
  const subOnlyId = subOnly.json.employee.id;
  assert.equal((await api('/api/employees/' + subOnlyId, { method: 'DELETE', token: subToken })).status, 200);
  const retained = await api('/api/employees/' + subOnlyId, { token: hqToken });
  assert.equal(retained.status, 200);
  assert.equal(retained.json.employee.cards[0].lifecycle, 'archived');
});

test('verified phones stay on this wechat and switch without a new code', async () => {
  const wechat = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:multi-phone' } });
  assert.equal(wechat.status, 200);
  const token = wechat.json.token;
  const oldId = wechat.json.employee.id;
  await api('/api/employee/cards', { method: 'POST', token, body: { template: 'classic', companyId: 'default' } });
  const named = await api('/api/employee/me', { method: 'PUT', token, body: { name: '旧账号' } });
  assert.equal(named.status, 200);
  const bound = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phoneCode: 'dev:13866667777' },
  });
  assert.equal(bound.status, 200);

  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token,
    body: { phone: '13866668888' },
  });
  const switched = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13866668888', code: sms.json.devCode },
  });
  assert.equal(switched.status, 200);
  assert.notEqual(switched.json.employee.id, oldId);
  assert.equal(switched.json.employee.name || '', '');

  const list = await api('/api/account/phones', { token });
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 2);
  assert.equal(list.json.items.some((item) => item.id === oldId && item.phone === '13866667777'), true);
  assert.equal(list.json.items.some((item) => item.current && item.phone === '13866668888'), true);

  const back = await api('/api/account/switch', { method: 'POST', token, body: { personId: oldId } });
  assert.equal(back.status, 200);
  assert.equal(back.json.employee.id, oldId);
  assert.equal(back.json.employee.name, '旧账号');

  const resume = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:multi-phone', resume: true } });
  assert.equal(resume.status, 200);
  assert.equal(resume.json.returning, true);
  assert.equal(resume.json.employee.id, oldId);

  const stranger = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:never-seen', resume: true } });
  assert.equal(stranger.status, 404);
});

test('restored account can be switched into even if another wechat still holds it', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const first = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:restore-switch' } });
  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token: first.json.token,
    body: { phone: '13877770001' },
  });
  const saved = await api('/api/account/phone', {
    method: 'PUT',
    token: first.json.token,
    body: { phone: '13877770001', code: sms.json.devCode },
  });
  assert.equal(saved.status, 200);
  const phoneId = saved.json.employee.id;

  const second = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:restore-other' } });
  const sms2 = await api('/api/account/phone/code', {
    method: 'POST',
    token: second.json.token,
    body: { phone: '13877770001' },
  });
  const taken = await api('/api/account/phone', {
    method: 'PUT',
    token: second.json.token,
    body: { phone: '13877770001', code: sms2.json.devCode },
  });
  assert.equal(taken.status, 200);
  assert.equal(taken.json.employee.id, phoneId);

  assert.equal((await api('/api/employees/' + phoneId, {
    method: 'PUT',
    token: hq.json.token,
    body: { status: 'disabled' },
  })).status, 200);
  assert.equal((await api('/api/employees/' + phoneId, {
    method: 'PUT',
    token: hq.json.token,
    body: { status: 'active' },
  })).status, 200);

  const again = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:restore-switch' } });
  assert.notEqual(again.json.employee.id, phoneId);
  const back = await api('/api/account/switch', {
    method: 'POST',
    token: again.json.token,
    body: { personId: phoneId },
  });
  assert.equal(back.status, 200);
  assert.equal(back.json.employee.id, phoneId);
  const me = await api('/api/employee/me', { token: again.json.token });
  assert.equal(me.json.employee.id, phoneId);
});

test('ordinary accounts require an explicit grant and demotion preserves issued cards', async () => {
  process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'false';
  try {
    const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    const company = await api('/api/companies', { method: 'POST', token: hq.json.token, body: { name: '名片权限企业' } });
    const companyId = company.json.id;
    await api('/api/templates/classic', { method: 'PUT', token: hq.json.token, body: { companyIds: [companyId] } });
    const login = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:permissions-user', phoneCode: 'dev:13900139876' } });
    const token = login.json.token;
    const personId = login.json.employee.id;
    assert.deepEqual((await api('/api/employee/templates', { token })).json.items, []);
    assert.equal((await api('/api/employee/cards', { method: 'POST', token, body: { template: 'classic', companyId } })).status, 403);
    const issued = await api('/api/employees', { method: 'POST', token: hq.json.token, body: { phone: '13900139876', name: '管理员发放', companyId } });
    assert.equal(issued.json.employee.id, personId);
    const cardId = issued.json.employee.activeCardId;
    assert.equal((await api('/api/employee/me', { method: 'PUT', token, body: { name: '越权修改' } })).status, 403);
    assert.equal((await api('/api/employee/cards/' + cardId, { method: 'DELETE', token })).status, 403);
    assert.equal((await api('/api/employee/cards/active', { method: 'PUT', token, body: { cardId } })).status, 200);
    assert.equal((await api('/api/account-permissions/' + personId, { method: 'PUT', token: hq.json.token, body: { level: 2, companyIds: [companyId] } })).status, 200);
    assert.equal((await api('/api/employee/me', { method: 'PUT', token, body: { name: '授权后填写', title: '经理', phone: '13800138999' } })).status, 200);
    const accounts = await api('/api/account-permissions', { token: hq.json.token });
    const row = accounts.json.items.find((item) => item.id === personId);
    assert.equal(row.name, '授权后填写');
    assert.equal(row.phone, '13900139876');
    assert.equal((await api('/api/employee/cards', { method: 'POST', token, body: { template: 'classic', companyId: 'default' } })).status, 403);
    assert.equal((await api('/api/employee/me', { method: 'PUT', token, body: { companyId: 'default' } })).status, 403);
    assert.equal((await api('/api/employee/me', { method: 'PUT', token, body: { cardTemplate: 'wave' } })).status, 403);
    await api('/api/account-permissions/' + personId, { method: 'PUT', token: hq.json.token, body: { level: 1 } });
    assert.equal((await api('/api/cards/' + personId + '?shareCard=' + cardId)).status, 200);
    assert.equal((await api('/api/employee/me', { method: 'PUT', token, body: { title: '旧页面保存' } })).status, 403);
    await api('/api/account-permissions/' + personId, { method: 'PUT', token: hq.json.token, body: { level: 3 } });
    const another = await api('/api/employee/cards', { method: 'POST', token, body: { template: 'wave', companyId } });
    assert.equal(another.status, 201);
    const addedId = another.json.employee.activeCardId;
    assert.equal((await api('/api/employees', { token })).status, 403);
    assert.equal((await api('/api/employee/cards/' + addedId, { method: 'DELETE', token })).status, 200);
    assert.equal((await api('/api/cards/' + personId + '?shareCard=' + addedId)).json.error.code, 'CARD_DELETED');
    const current = await api('/api/employee/me', { token });
    assert.equal(current.json.employee.activeCardId, cardId);
    assert.equal(current.json.employee.cards.some((card) => card.id === addedId), false);
    assert.equal((await getStore().getPerson(personId)).cards.find((card) => card.id === addedId).lifecycle, 'deleted');
    await api('/api/account-permissions/' + personId, { method: 'PUT', token: hq.json.token, body: { level: 2, companyIds: [companyId] } });
    assert.equal((await api('/api/employee/cards/' + cardId, { method: 'DELETE', token })).status, 200);
    assert.equal((await api('/api/employee/me', { token })).json.employee.activeCardId, '');
    assert.equal((await api('/api/cards/' + personId + '?shareCard=' + cardId)).json.error.code, 'CARD_DELETED');
  } finally { process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED = 'true'; }
});

test('hq admin sees a self-registered card that has no company', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const created = await api('/api/companies', {
    method: 'POST',
    token: hq.json.token,
    body: { name: '看不见的子公司', shortName: '不见' },
  });
  const adminCreated = await api('/api/company-admins', {
    method: 'POST',
    token: hq.json.token,
    body: { companyId: created.json.id, username: 'blindadmin', password: 'blindpass' },
  });
  assert.equal(adminCreated.status, 201);
  const sub = await api('/api/login', { method: 'POST', body: { username: 'blindadmin', password: 'blindpass' } });
  const wechat = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:no-company' } });
  const edited = await api('/api/employee/me', {
    method: 'PUT',
    token: wechat.json.token,
    body: { name: '未认证朋友', phone: '13900008888', title: '访客' },
  });
  assert.equal(edited.status, 409);
  assert.equal(edited.json.error.code, 'NO_ACTIVE_CARD');

  const hqList = await api('/api/employees', { token: hq.json.token });
  const seen = hqList.json.items.find((item) => item.id === wechat.json.employee.id);
  assert.ok(seen);
  assert.equal(seen.name, '');

  const subList = await api('/api/employees', { token: sub.json.token });
  assert.equal(subList.json.items.some((item) => item.id === wechat.json.employee.id), false);
});

test('retired certification endpoints cannot grant permissions', async () => {
  for (const url of ['/api/employee/certification', '/api/certifications', '/api/certifications/old/approve']) {
    assert.equal((await api(url, { method: 'POST', body: { companyId: 'default' } })).status, 410);
  }
});

test('hq creates a named classic template and assigns it to one subsidiary', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const first = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '模板授权公司', shortName: '模板公司' },
  });
  const second = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '未授权公司', shortName: '未授权' },
  });
  await api('/api/company-admins', {
    method: 'POST', token: hq.json.token,
    body: { companyId: first.json.id, username: 'tpladmin1', password: 'tplpass1' },
  });
  await api('/api/company-admins', {
    method: 'POST', token: hq.json.token,
    body: { companyId: second.json.id, username: 'tpladmin2', password: 'tplpass2' },
  });
  const admin1 = await api('/api/login', { method: 'POST', body: { username: 'tpladmin1', password: 'tplpass1' } });
  const admin2 = await api('/api/login', { method: 'POST', body: { username: 'tpladmin2', password: 'tplpass2' } });
  assert.equal((await api('/api/templates', { method: 'POST', token: admin1.json.token, body: { name: '越权' } })).status, 403);
  const made = await api('/api/templates', {
    method: 'POST', token: hq.json.token,
    body: {
      name: '苏州子公司模板', companyName: '苏州创新科技有限公司',
      companyNameEn: 'SUZHOU INNOVATION TECHNOLOGY CO., LTD.',
      shortName: '苏州创新', shortNameEn: 'SUZHOU INNOVATION',
      qrUrl: '/uploads/test-qr.png', companyIds: [first.json.id],
    },
  });
  assert.equal(made.status, 201);
  const templateId = made.json.template.id;
  assert.equal((await api('/api/templates', { token: admin1.json.token })).json.items.some((item) => item.id === templateId), true);
  assert.equal((await api('/api/templates', { token: admin2.json.token })).json.items.some((item) => item.id === templateId), false);
  assert.equal((await api('/api/employees', {
    method: 'POST', token: admin2.json.token,
    body: { name: '越权员工', phone: '13922220001', cardTemplate: templateId },
  })).status, 403);
  assert.equal((await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: {
      companyId: second.json.id,
      name: '总部跨企业使用模板', phone: '13922220003', cardTemplate: templateId,
    },
  })).status, 201);
  const hqAssigned = await api('/api/employees', {
    method: 'POST', token: hq.json.token,
    body: {
      companyId: first.json.id,
      name: '总部代建模板员工', phone: '13922220004', cardTemplate: templateId,
    },
  });
  assert.equal(hqAssigned.status, 201);
  assert.equal(hqAssigned.json.employee.cards[0].companyId, first.json.id);
  const employee = await api('/api/employees', {
    method: 'POST', token: admin1.json.token,
    body: { name: '模板员工', phone: '13922220002', cardTemplate: templateId },
  });
  assert.equal(employee.status, 201);
  assert.equal(employee.json.employee.cards[0].templateLabel, '苏州子公司模板');
  const publicCard = await api('/api/cards/' + employee.json.employee.id);
  assert.equal(publicCard.json.company.name, '苏州创新科技有限公司');
  assert.equal(publicCard.json.company.qrUrl, '/uploads/test-qr.png');
  const updated = await api('/api/templates/' + templateId, {
    method: 'PUT', token: hq.json.token,
    body: {
      name: '更新后的模板', companyName: '新公司名称', companyNameEn: 'NEW COMPANY',
      shortName: '新简称', shortNameEn: 'NEW NAME',
      qrUrl: '/uploads/new-qr.png', companyIds: [second.json.id],
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.template.id, templateId);
  assert.equal((await api('/api/templates', { token: admin1.json.token })).json.items.some((item) => item.id === templateId), false);
  assert.equal((await api('/api/templates', { token: admin2.json.token })).json.items.some((item) => item.id === templateId), true);
  const updatedCard = await api('/api/cards/' + employee.json.employee.id);
  assert.equal(updatedCard.json.company.name, '新公司名称');
  assert.equal(updatedCard.json.company.qrUrl, '/uploads/new-qr.png');
});

test('employee sees subsidiary templates after an individual enterprise grant', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const company = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '员工模板认证公司', shortName: '员工模板' },
  });
  const template = await api('/api/templates', {
    method: 'POST', token: hq.json.token,
    body: {
      name: '员工专属模板', companyName: '员工模板认证公司', companyNameEn: 'EMPLOYEE TEMPLATE CO',
      shortName: '员工模板', shortNameEn: 'EMPLOYEE TEMPLATE', companyIds: [company.json.id],
    },
  });
  const templateId = template.json.template.id;
  const user = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:employee-template-cert' } });
  const token = user.json.token;
  await api('/api/account-permissions/' + user.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 1 } });
  const before = await api('/api/employee/templates', { token });
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.items, []);
  assert.equal(before.json.items.some((item) => item.id === templateId), false);
  assert.equal((await api('/api/employee/cards', {
    method: 'POST', token, body: { template: templateId, companyId: company.json.id },
  })).status, 403);

  await api('/api/account-permissions/' + user.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 2, companyIds: [company.json.id] } });

  const available = await api('/api/employee/templates', { token });
  const choice = available.json.items.find((item) => item.id === templateId);
  assert.equal(choice.companyId, company.json.id);
  assert.equal(choice.company.name, '员工模板认证公司');
  const created = await api('/api/employee/cards', {
    method: 'POST', token, body: { template: templateId, companyId: company.json.id },
  });
  assert.equal(created.status, 201);
  const card = created.json.employee.cards.find((item) => item.id === created.json.employee.activeCardId);
  assert.equal(card.templateLabel, '员工专属模板');
  assert.equal(card.companyId, company.json.id);
  const me = await api('/api/employee/me', { token });
  assert.equal(me.json.cardCompanies[card.id].name, '员工模板认证公司');

  await api('/api/account-permissions/' + user.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 1 } });
  const after = await api('/api/employee/templates', { token });
  assert.equal(after.json.items.some((item) => item.id === templateId), false);
  assert.equal((await api('/api/employee/cards', {
    method: 'POST', token, body: { template: templateId, companyId: company.json.id },
  })).status, 403);
});

test('only hq can change template assignments', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const first = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '移除模板公司甲', shortName: '甲公司' },
  });
  const second = await api('/api/companies', {
    method: 'POST', token: hq.json.token, body: { name: '保留模板公司乙', shortName: '乙公司' },
  });
  await api('/api/company-admins', {
    method: 'POST', token: hq.json.token,
    body: { companyId: first.json.id, username: 'removeadmin1', password: 'removepass1' },
  });
  await api('/api/company-admins', {
    method: 'POST', token: hq.json.token,
    body: { companyId: second.json.id, username: 'removeadmin2', password: 'removepass2' },
  });
  const admin1 = await api('/api/login', { method: 'POST', body: { username: 'removeadmin1', password: 'removepass1' } });
  const admin2 = await api('/api/login', { method: 'POST', body: { username: 'removeadmin2', password: 'removepass2' } });
  const made = await api('/api/templates', {
    method: 'POST', token: hq.json.token,
    body: { name: '两家公司共用模板', companyIds: [first.json.id, second.json.id] },
  });
  const id = made.json.template.id;
  const visibleToFirst = (await api('/api/templates', { token: admin1.json.token })).json.items.find((item) => item.id === id);
  assert.deepEqual(visibleToFirst.companyIds, [first.json.id]);
  const employee = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:remove-template-employee' } });
  await api('/api/account-permissions/' + employee.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 2, companyIds: [first.json.id] } });
  assert.equal((await api('/api/employee/templates', { token: employee.json.token })).json.items.some((item) => item.id === id), true);
  assert.equal((await api('/api/templates/' + id + '/assignment', {
    method: 'DELETE', token: hq.json.token,
  })).status, 403);
  assert.equal((await api('/api/templates/classic/assignment', {
    method: 'DELETE', token: admin1.json.token,
  })).status, 403);
  assert.equal((await api('/api/templates/' + id + '/assignment', {
    method: 'DELETE', token: admin1.json.token,
  })).status, 403);
  const removed = await api('/api/templates/' + id, {
    method: 'PUT', token: hq.json.token,
    body: { name: '两家公司共用模板', companyIds: [second.json.id] },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.template.companyIds, [second.json.id]);
  assert.equal((await api('/api/templates', { token: admin1.json.token })).json.items.some((item) => item.id === id), false);
  assert.equal((await api('/api/templates', { token: admin2.json.token })).json.items.some((item) => item.id === id), true);
  assert.equal((await api('/api/templates', { token: hq.json.token })).json.items.some((item) => item.id === id), true);
  assert.equal((await api('/api/employee/templates', { token: employee.json.token })).json.items.some((item) => item.id === id), false);
  assert.equal((await api('/api/templates/' + id + '/assignment', {
    method: 'DELETE', token: admin1.json.token,
  })).status, 403);
});

test('hq can find an employee by an inactive card and receives every card', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const employee = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:hq-all-cards-search' } });
  const token = employee.json.token;
  await api('/api/account-permissions/' + employee.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 3 } });
  const first = await api('/api/employee/cards', {
    method: 'POST', token, body: { template: 'classic', companyId: 'default' },
  });
  assert.equal(first.status, 201);
  const firstCardId = first.json.employee.activeCardId;
  await api('/api/employee/me', { method: 'PUT', token, body: { name: '总部默认名片' } });
  const added = await api('/api/employee/cards', {
    method: 'POST', token, body: { template: 'horizon', companyId: 'default' },
  });
  assert.equal(added.status, 201);
  assert.equal((await api('/api/employee/me', {
    method: 'PUT', token, body: { name: '只在第二张名片的检索词' },
  })).status, 200);
  await api('/api/employee/cards/active', { method: 'PUT', token, body: { cardId: firstCardId } });

  const list = await api('/api/employees?q=' + encodeURIComponent('只在第二张名片的检索词'), { token: hq.json.token });
  assert.equal(list.status, 200);
  const found = list.json.items.find((item) => item.id === employee.json.employee.id);
  assert.ok(found);
  assert.equal(found.cards.length, 2);
  assert.equal(found.cards.some((card) => card.name === '只在第二张名片的检索词'), true);
});

test('holder pins one employee card and hides it after owner soft-deletes it', async () => {
  const hq = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const target = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:holder-pinned-target' } });
  const targetToken = target.json.token;
  await api('/api/account-permissions/' + target.json.employee.id, { method: 'PUT', token: hq.json.token, body: { level: 3 } });
  const first = await api('/api/employee/cards', { method: 'POST', token: targetToken, body: { template: 'classic', companyId: 'default' } });
  assert.equal(first.status, 201);
  const firstCardId = first.json.employee.activeCardId;
  const second = await api('/api/employee/cards', { method: 'POST', token: targetToken, body: { template: 'horizon', companyId: 'default' } });
  assert.equal(second.status, 201);
  const secondCardId = second.json.employee.activeCardId;
  await api('/api/employee/me', { method: 'PUT', token: targetToken, body: { name: '收藏测试第二张' } });
  const viewer = await api('/api/auth/wechat', { method: 'POST', body: { code: 'dev:holder-pinned-viewer' } });
  const saved = await api('/api/holder', { method: 'POST', token: viewer.json.token, body: { cardId: target.json.employee.id, shareCardId: secondCardId } });
  assert.equal(saved.status, 201);
  assert.equal(saved.json.item.card.cardTemplate, 'horizon');
  await api('/api/employee/cards/active', { method: 'PUT', token: targetToken, body: { cardId: firstCardId } });
  const pinned = await api('/api/holder', { token: viewer.json.token });
  const pinnedCard = pinned.json.items.find((item) => item.cardId === target.json.employee.id);
  assert.equal(pinnedCard.shareCardId, secondCardId);
  assert.equal(pinnedCard.card.name, '收藏测试第二张');
  assert.equal(pinnedCard.card.cardTemplate, 'horizon');
  assert.equal((await api('/api/employee/cards/' + secondCardId, { method: 'DELETE', token: targetToken })).status, 200);
  const revokedShared = await api('/api/cards/' + target.json.employee.id + '?shareCard=' + encodeURIComponent(secondCardId));
  assert.equal(revokedShared.status, 404);
  assert.equal(revokedShared.json.error.code, 'CARD_DELETED');
  assert.equal((await api('/api/cards/' + target.json.employee.id + '/qr?shareCard=' + encodeURIComponent(secondCardId))).status, 404);
  const afterRevoke = await api('/api/holder', { token: viewer.json.token });
  assert.equal(afterRevoke.json.items.some((item) => item.cardId === target.json.employee.id), false);
  const deletedArchived = await api('/api/employee/cards/' + secondCardId, {
    method: 'DELETE', token: targetToken,
  });
  assert.equal(deletedArchived.status, 404);
});
