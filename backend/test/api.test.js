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
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';
delete process.env.DATABASE_URL;
process.env.TENCENT_SECRET_ID = '';
process.env.TENCENT_SECRET_KEY = '';
process.env.TENCENT_SMS_SDK_APP_ID = '';
process.env.TENCENT_SMS_SIGN_NAME = '';
process.env.TENCENT_SMS_TEMPLATE_ID = '';
process.env.OCR_PROVIDER = 'tencent';

const { app } = require('../server');

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
  const employeeId = wechat.json.employee.id;

  const saved = await api('/api/employee/me', {
    method: 'PUT',
    token,
    body: { name: '测试员工', title: '业务经理', portrait: '/uploads/portrait.png', phone: '13811112222' },
  });
  assert.equal(saved.status, 400);
  assert.equal(saved.json.error.code, 'CODE_INVALID');

  const me = await api('/api/employee/me', { token });
  assert.equal(me.json.employee.portrait, '');
  assert.notEqual(me.json.employee.name, '测试员工');

  const profile = await api('/api/employee/me', {
    method: 'PUT',
    token,
    body: { name: '测试员工', title: '业务经理', portrait: '/uploads/portrait.png', wechat: 'tester-wx' },
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.json.employee.name, '测试员工');
  assert.equal(profile.json.employee.portrait, '/uploads/portrait.png');

  const missingCode = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13811112222' },
  });
  assert.equal(missingCode.status, 400);

  const sms = await api('/api/account/phone/code', {
    method: 'POST',
    token,
    body: { phone: '13811112222' },
  });
  assert.equal(sms.status, 200);
  assert.match(sms.json.devCode, /^\d{6}$/);
  const phoneSaved = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13811112222', code: sms.json.devCode },
  });
  assert.equal(phoneSaved.status, 200);
  assert.equal(phoneSaved.json.employee.phone, '13811112222');

  const mail = await api('/api/account/email/code', {
    method: 'POST',
    token,
    body: { email: 'tester@chuangda.example' },
  });
  const emailSaved = await api('/api/account/email', {
    method: 'PUT',
    token,
    body: { email: 'tester@chuangda.example', code: mail.json.devCode },
  });
  assert.equal(emailSaved.status, 200);
  assert.equal(emailSaved.json.employee.email, 'tester@chuangda.example');
  const home = await api('/api/employee/me', { token });
  assert.equal(home.json.employee.phone, '13811112222');
  assert.equal(home.json.employee.email, 'tester@chuangda.example');

  const reused = await api('/api/account/phone', {
    method: 'PUT',
    token,
    body: { phone: '13811113333', code: sms.json.devCode },
  });
  assert.equal(reused.status, 400);
  assert.equal((await api('/api/employee/me', { token })).json.employee.phone, '13811112222');

  const unknown = await api('/api/holder', { method: 'POST', token, body: { cardId: 'emp-missing' } });
  assert.equal(unknown.status, 404);
  const noId = await api('/api/holder', { method: 'POST', token, body: {} });
  assert.equal(noId.status, 400);
  const selfFav = await api('/api/holder', { method: 'POST', token, body: { cardId: employeeId } });
  assert.equal(selfFav.status, 400);

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
  const hidden = await api('/api/cards/' + ocrId);
  assert.equal(hidden.status, 404);
  const owned = await api('/api/cards/' + ocrId, { token });
  assert.equal(owned.status, 200);
  assert.equal(owned.json.card.name, '纸质客户');
  assert.equal(owned.json.company, null);

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
  assert.equal(closedPerson.phone, '13811112222');
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
  assert.equal(visible.status, 200);
  assert.equal(visible.json.card.phone, '13811112222');

  const imported = await api('/api/employees/batch', {
    method: 'POST',
    token: adminToken,
    body: { list: [{ employeeNo: '1008', name: '沈知衡', title: '分析师', phone: '13800001008' }] },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.json.items[0].id, 'emp-1008');

  const viewed = await api('/api/analytics/view', {
    method: 'POST',
    body: { cardId: 'emp-1001', visitorId: 'visitor-test' },
  });
  assert.equal(viewed.status, 201);
  const duration = await api('/api/analytics/view/' + viewed.json.viewId, {
    method: 'PUT',
    body: { durationSec: 90, exchange: { name: '来访者', phone: '13700008888', company: '南市集团' } },
  });
  assert.equal(duration.status, 200);
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
  assert.equal(blocked.status, 409);

  const imported = await api('/api/employees', {
    method: 'POST',
    token: admin.json.token,
    body: { employeeNo: '2099', name: '同一人', phone: '13822223333', title: '经理' },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.merged, true);
  assert.equal(imported.json.employee.id, first.json.employee.id);
  assert.equal(imported.json.employee.employeeNo, '2099');

  const conflict = await api('/api/employees/' + imported.json.employee.id + '/merge', {
    method: 'POST',
    token: admin.json.token,
    body: { sourceId: second.json.employee.id },
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
  assert.equal(stolen.status, 409);
});
