const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { getStore } = require('./db');
const { asyncRoute, httpError } = require('./lib/errors');
const { interestIndex, averageDuration } = require('./lib/interest');
const { blankPerson, nowIso, seedData, toCard, toSelf } = require('./lib/person');
const { openIdFromCode, phoneFromWechatCode } = require('./lib/wechat');
const { claimImportedCard } = require('./lib/claim');
const { saveSelfCard } = require('./lib/contact');
const {
  text,
  normalizeAttachments,
  assertHexColor,
} = require('./lib/validate');
const { findOccupyingPhone, assertPhoneAvailable } = require('./lib/identity');
const { rowsFromSpreadsheet, normalizeImportRow } = require('./lib/spreadsheet');
const {
  safeEqual,
  adminCredentials,
  assertAdminConfigured,
  createSession,
  requireUser,
  requireAdmin,
  requireEmployee,
} = require('./lib/access');

let store;
try {
  store = getStore();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const ready = store.ready();
const app = express();
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const adminRoot = path.join(__dirname, '..', 'admin-web');
const uploadRoot = config.uploadDir();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(asyncRoute(async (req, res, next) => {
  await ready;
  next();
}));
app.use(asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next();
  const session = await store.getSession(token);
  if (!session) return next();
  req.auth = session;
  if (session.role === 'employee') req.user = await store.getPerson(session.userId);
  next();
}));

function publicCard(person) {
  const card = toCard(person);
  delete card.kind;
  delete card.status;
  return card;
}

function matchesQuery(person, q) {
  if (!q) return true;
  const haystack = [person.name, person.phone, person.employeeNo, person.title, person.email, person.department, person.company]
    .join('\n')
    .toLowerCase();
  return haystack.includes(String(q).trim().toLowerCase());
}

function inDateRange(view, from, to) {
  const day = String(view.startedAt || '').slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function summaryOf(person, views) {
  return {
    cardId: person.id,
    name: person.name,
    employeeNo: person.employeeNo || '',
    views: views.length,
    visitors: new Set(views.map((view) => view.visitorId).filter(Boolean)).size,
    avgDurationSec: averageDuration(views),
    exchanges: views.filter((view) => view.exchange && (view.exchange.phone || view.exchange.name)).length,
    interestIndex: interestIndex(views),
  };
}

function applyAdminFields(existing, body) {
  const next = { ...existing };
  if (body.name !== undefined) next.name = text(body.name, 40);
  if (body.company !== undefined) next.company = text(body.company, 80);
  if (body.title !== undefined) next.title = text(body.title, 40);
  if (body.department !== undefined) next.department = text(body.department, 40);
  if (body.phone !== undefined) next.phone = text(body.phone, 20);
  if (body.wechat !== undefined) next.wechat = text(body.wechat, 40);
  if (body.email !== undefined) next.email = text(body.email, 80);
  if (body.address !== undefined) next.address = text(body.address, 120);
  if (body.avatar !== undefined) next.avatar = text(body.avatar, 500);
  if (body.portrait !== undefined) next.portrait = text(body.portrait, 500);
  if (body.attachments !== undefined) next.attachments = normalizeAttachments(body.attachments);
  if (body.employeeNo !== undefined && String(body.employeeNo).trim()) {
    next.employeeNo = text(body.employeeNo, 32);
  }
  if (body.status !== undefined) {
    if (!['active', 'disabled', 'closed'].includes(body.status)) {
      throw httpError(400, 'VALIDATION_ERROR', '状态只能是 active、disabled 或 closed');
    }
    next.status = body.status;
  }
  if (body.name !== undefined && !next.name) throw httpError(400, 'VALIDATION_ERROR', '姓名不能为空');
  next.updatedAt = nowIso();
  return next;
}

function assertStaffIdentity(person) {
  if (!person.name) throw httpError(400, 'VALIDATION_ERROR', '姓名不能为空');
  if (!person.phone) throw httpError(400, 'VALIDATION_ERROR', '手机号不能为空');
}

async function assertEmployeeNoFree(employeeNo, exceptId) {
  const found = await store.findByEmployeeNo(employeeNo);
  if (found && found.id !== exceptId) throw httpError(409, 'EMPLOYEE_EXISTS', '工号已存在：' + employeeNo);
}

async function upsertImported(draft) {
  const byNo = draft.employeeNo ? await store.findByEmployeeNo(draft.employeeNo) : null;
  const byPhone = draft.phone ? await findOccupyingPhone(store, draft.phone) : null;
  if (byNo && byPhone && byNo.id !== byPhone.id) {
    throw httpError(409, 'IDENTITY_CONFLICT', '工号与手机号分别属于两名员工，请先在后台合并');
  }
  if (!byNo && byPhone && draft.employeeNo && byPhone.employeeNo && byPhone.employeeNo !== draft.employeeNo) {
    throw httpError(409, 'PHONE_EXISTS', '手机号已属于另一名员工');
  }
  const target = byNo || byPhone;
  if (target) {
    const next = applyAdminFields(target, {
      name: draft.name,
      company: draft.company,
      title: draft.title,
      department: draft.department,
      phone: draft.phone,
      wechat: draft.wechat,
      email: draft.email,
      address: draft.address,
      avatar: draft.avatar,
      portrait: draft.portrait,
      employeeNo: draft.employeeNo,
      status: draft.status || target.status || 'active',
    });
    next.id = target.id;
    next.openid = target.openid;
    next.createdAt = target.createdAt;
    const saved = await store.updatePerson(target.id, next);
    return { employee: saved, merged: true };
  }
  const id = draft.employeeNo && /^[A-Za-z0-9_-]+$/.test(draft.employeeNo)
    ? 'emp-' + draft.employeeNo
    : 'emp-' + crypto.randomBytes(4).toString('hex');
  if (await store.getPerson(id)) throw httpError(409, 'EMPLOYEE_EXISTS', '名片编号已存在');
  const person = { ...draft, id, kind: 'employee', createdAt: nowIso() };
  await store.insertPerson(person);
  return { employee: person, merged: false };
}

app.get('/api/auth/options', asyncRoute(async (req, res) => {
  res.json({ wechatSkip: config.wechatSkipAllowed() });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const admin = adminCredentials();
  const username = req.body && req.body.username;
  const password = req.body && req.body.password;
  if (!safeEqual(username || '', admin.username) || !safeEqual(password || '', admin.password)) {
    throw httpError(401, 'LOGIN_FAILED', '账号或密码错误');
  }
  const session = await createSession(store, 'admin', 'admin');
  res.json({ token: session.token, role: 'admin', username: admin.username });
}));

app.post('/api/auth/wechat', asyncRoute(async (req, res) => {
  const openid = await openIdFromCode(req.body && req.body.code);
  let person = await store.findEmployeeByOpenid(openid);
  if (person && person.status !== 'active') {
    const message = person.status === 'closed' ? '账号已注销，请联系管理员恢复' : '账号已停用';
    throw httpError(403, 'ACCOUNT_INACTIVE', message);
  }
  let claimed = false;
  if (!person) {
    const phoneCode = text(req.body && req.body.phoneCode, 256);
    const phone = phoneCode ? await phoneFromWechatCode(phoneCode) : '';
    if (phone) {
      const result = await claimImportedCard(store, { phone, openid, shell: null });
      if (result) {
        person = result.employee;
        claimed = true;
      }
    }
    if (!person) {
      const company = await store.getCompany();
      person = blankPerson({
        id: 'emp-' + crypto.randomBytes(4).toString('hex'),
        kind: 'employee',
        openid,
        phone,
        company: company ? company.name : '',
      });
      await store.insertPerson(person);
    }
  }
  const session = await createSession(store, person.id, 'employee');
  res.json({ token: session.token, role: 'employee', employee: toSelf(person), claimed });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (req.auth) await store.deleteSession(req.auth.token);
  res.json({ ok: true });
}));

app.get('/api/me', asyncRoute(async (req, res) => {
  const auth = requireUser(req);
  if (auth.role === 'admin') {
    res.json({ role: 'admin', username: adminCredentials().username });
    return;
  }
  if (!req.user || req.user.status !== 'active') throw httpError(401, 'UNAUTHORIZED', '请先登录');
  res.json({ role: 'employee', employee: toSelf(req.user) });
}));

app.get('/api/company', asyncRoute(async (req, res) => {
  res.json({ company: await store.getCompany() });
}));

app.put('/api/company', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const current = (await store.getCompany()) || seedData().company;
  const body = req.body || {};
  const next = { ...current };
  for (const key of ['name', 'nameEn', 'shortName', 'brandEn', 'slogan', 'intro', 'website', 'address', 'phone', 'wechat', 'logo']) {
    if (body[key] !== undefined) next[key] = text(body[key], key === 'intro' ? 400 : 160);
  }
  if (body.template !== undefined) {
    if (!['classic', 'ink', 'light'].includes(body.template)) {
      throw httpError(400, 'VALIDATION_ERROR', '模板只能是 classic、ink 或 light');
    }
    next.template = body.template;
  }
  if (body.primaryColor !== undefined) {
    assertHexColor(body.primaryColor, '主题色');
    next.primaryColor = body.primaryColor;
  }
  if (body.accentColor !== undefined) {
    assertHexColor(body.accentColor, '辅色');
    next.accentColor = body.accentColor;
  }
  if (!next.name) throw httpError(400, 'VALIDATION_ERROR', '公司名称不能为空');
  res.json({ company: await store.saveCompany(next) });
}));

app.get('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const q = req.query.q || '';
  const people = await store.listPeople({ kind: 'employee' });
  res.json({ items: people.filter((person) => matchesQuery(person, q)).map(toSelf) });
}));

app.post('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const company = await store.getCompany();
  const draft = applyAdminFields(blankPerson({
    id: 'pending',
    company: company ? company.name : '',
  }), req.body || {});
  assertStaffIdentity(draft);
  const result = await upsertImported(draft);
  res.status(result.merged ? 200 : 201).json({ employee: toSelf(result.employee), merged: result.merged });
}));

async function importEmployeeList(list, res) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'VALIDATION_ERROR', '请提供 list 数组');
  const company = await store.getCompany();
  const prepared = [];
  const rejected = [];
  const seenNo = new Set();
  const seenPhone = new Set();
  list.forEach((item, index) => {
    const source = normalizeImportRow(item || {});
    const row = index + 1;
    if (source.qr && !source.attachments) {
      source.attachments = [{ name: '微信二维码', url: text(source.qr, 500) }];
    }
    let draft;
    try {
      draft = applyAdminFields(blankPerson({
        id: 'pending',
        company: company ? company.name : '',
      }), source);
      if (!draft.phone) {
        rejected.push({ row, name: draft.name || '', reason: '缺少手机号，未创建' });
        return;
      }
      assertStaffIdentity(draft);
    } catch (err) {
      rejected.push({ row, name: (source && source.name) || '', reason: err.message || '未创建' });
      return;
    }
    if (draft.employeeNo) {
      if (seenNo.has(draft.employeeNo)) {
        rejected.push({ row, name: draft.name || '', reason: '导入列表中工号重复：' + draft.employeeNo });
        return;
      }
      seenNo.add(draft.employeeNo);
    }
    if (seenPhone.has(draft.phone)) {
      rejected.push({ row, name: draft.name || '', reason: '导入列表中手机号重复：' + draft.phone });
      return;
    }
    seenPhone.add(draft.phone);
    prepared.push(draft);
  });
  const saved = [];
  for (const draft of prepared) saved.push(await upsertImported(draft));
  res.status(201).json({
    items: saved.map((item) => ({ ...toSelf(item.employee), merged: item.merged })),
    rejected,
  });
}

app.post('/api/employees/batch', asyncRoute(async (req, res) => {
  requireAdmin(req);
  await importEmployeeList(req.body && req.body.list, res);
}));

app.post('/api/employees/import-file', importUpload.single('file'), asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw httpError(400, 'VALIDATION_ERROR', '请选择表格文件');
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const allowed = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv', '.txt', '.tsv', '.ods'];
  if (ext && !allowed.includes(ext)) {
    throw httpError(400, 'VALIDATION_ERROR', '请上传 xlsx、xls、csv 或其他表格文件');
  }
  let rows = [];
  try {
    rows = rowsFromSpreadsheet(req.file.buffer);
  } catch (err) {
    throw httpError(400, 'VALIDATION_ERROR', '无法识别这个表格');
  }
  if (!rows.length) throw httpError(400, 'VALIDATION_ERROR', '表格里没有可导入的数据');
  await importEmployeeList(rows, res);
}));

app.post('/api/employees/:id/merge', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const sourceId = text(req.body && req.body.sourceId, 64);
  if (!sourceId) throw httpError(400, 'VALIDATION_ERROR', '请填写要并入的员工编号');
  const target = await store.getPerson(req.params.id);
  const source = await store.getPerson(sourceId);
  if (!target || target.kind !== 'employee' || !source || source.kind !== 'employee') {
    throw httpError(404, 'NOT_FOUND', '员工不存在');
  }
  if (target.id === source.id) throw httpError(400, 'VALIDATION_ERROR', '不能和自己合并');
  if (target.openid && source.openid && target.openid !== source.openid) {
    throw httpError(409, 'WECHAT_CONFLICT', '两名员工已绑定不同微信，不能合成一个人');
  }
  const kept = {
    ...target,
    openid: target.openid || source.openid || '',
    updatedAt: nowIso(),
  };
  await store.updatePerson(target.id, kept);
  await store.updatePerson(source.id, {
    ...source,
    openid: '',
    status: 'disabled',
    updatedAt: nowIso(),
  });
  await store.deleteSessionsForUser(source.id);
  await store.reassignHolderUser(source.id, target.id);
  await store.reassignViews(source.id, target.id);
  res.json({ employee: toSelf(kept), retiredId: source.id });
}));

app.get('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  res.json({ employee: toSelf(person) });
}));

app.put('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const next = applyAdminFields(person, req.body || {});
  if (!next.phone) throw httpError(400, 'VALIDATION_ERROR', '手机号不能为空');
  await assertEmployeeNoFree(next.employeeNo, person.id);
  if (next.phone) await assertPhoneAvailable(store, next.phone, person.id);
  const saved = await store.updatePerson(person.id, next);
  res.json({ employee: toSelf(saved) });
}));

app.delete('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  await store.deletePerson(person.id);
  res.json({ ok: true });
}));

app.get('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  res.json({ employee: toSelf(user) });
}));

app.put('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const saved = await saveSelfCard(store, user, req.body || {});
  res.json({ employee: toSelf(saved) });
}));

app.get('/api/cards/:id/qr', asyncRoute(async (req, res) => {
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee' || person.status !== 'active') {
    throw httpError(404, 'CARD_UNAVAILABLE', '名片不可见');
  }
  const QRCode = require('qrcode');
  const target = config.publicBase(req) + '/card.html?cardId=' + encodeURIComponent(person.id);
  const png = await QRCode.toBuffer(target, {
    width: 280,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(png);
}));

app.get('/api/cards/:id', asyncRoute(async (req, res) => {
  const person = await store.getPerson(req.params.id);
  if (!person) throw httpError(404, 'CARD_NOT_FOUND', '名片不存在');
  if (person.kind === 'ocr') {
    if (!req.auth || req.auth.userId !== person.ownerId) {
      throw httpError(404, 'CARD_NOT_FOUND', '名片不存在');
    }
    res.json({ card: publicCard(person), company: null, owned: true });
    return;
  }
  if (person.status !== 'active') throw httpError(404, 'CARD_UNAVAILABLE', '名片不可见');
  res.json({ card: publicCard(person), company: await store.getCompany(), owned: false });
}));

app.post('/api/analytics/view', asyncRoute(async (req, res) => {
  const cardId = text(req.body && req.body.cardId, 64);
  const person = await store.getPerson(cardId);
  if (!person || person.kind !== 'employee' || person.status !== 'active') {
    throw httpError(404, 'CARD_UNAVAILABLE', '名片不可见');
  }
  const view = {
    id: 'view-' + crypto.randomBytes(6).toString('hex'),
    cardId,
    visitorId: text(req.body && req.body.visitorId, 64),
    startedAt: nowIso(),
    durationSec: 0,
    exchange: null,
  };
  await store.insertView(view);
  res.status(201).json({ viewId: view.id });
}));

app.put('/api/analytics/view/:id', asyncRoute(async (req, res) => {
  const view = await store.getView(req.params.id);
  if (!view) throw httpError(404, 'NOT_FOUND', '浏览记录不存在');
  const next = { ...view };
  if (req.body && req.body.durationSec != null) {
    const duration = Number(req.body.durationSec);
    if (!Number.isFinite(duration) || duration < 0 || duration > 60 * 60 * 12) {
      throw httpError(400, 'VALIDATION_ERROR', '停留时长不正确');
    }
    next.durationSec = Math.max(Number(view.durationSec) || 0, Math.round(duration));
  }
  if (req.body && req.body.exchange) {
    const exchange = req.body.exchange;
    next.exchange = {
      name: text(exchange.name, 40),
      phone: text(exchange.phone, 20),
      company: text(exchange.company, 80),
    };
    if (!next.exchange.name && !next.exchange.phone) {
      throw httpError(400, 'VALIDATION_ERROR', '交换名片请留下姓名或电话');
    }
  }
  await store.updateView(view.id, next);
  res.json({ ok: true });
}));

app.get('/api/analytics/summary', asyncRoute(async (req, res) => {
  const auth = requireUser(req);
  const allViews = await store.listViews({});
  let people = [];
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    people = [req.user];
  } else {
    requireAdmin(req);
    people = await store.listPeople({ kind: 'employee' });
    if (req.query.cardId) people = people.filter((person) => person.id === req.query.cardId);
  }
  const items = people.map((person) => summaryOf(
    person,
    allViews.filter((view) => view.cardId === person.id && inDateRange(view, req.query.from, req.query.to))
  ));
  res.json({ items });
}));

app.get('/api/analytics/list', asyncRoute(async (req, res) => {
  const auth = requireUser(req);
  let cardId = text(req.query.cardId, 64);
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    if (cardId && cardId !== req.user.id) throw httpError(403, 'FORBIDDEN', '只能查看自己的名片数据');
    cardId = req.user.id;
  } else {
    requireAdmin(req);
  }
  const views = await store.listViews(cardId ? { cardId } : {});
  const people = await store.listPeople({ kind: 'employee' });
  const names = new Map(people.map((person) => [person.id, person.name]));
  const items = views
    .filter((view) => inDateRange(view, req.query.from, req.query.to))
    .map((view) => ({
      id: view.id,
      cardId: view.cardId,
      cardName: names.get(view.cardId) || '',
      visitorId: view.visitorId || '',
      startedAt: view.startedAt,
      durationSec: view.durationSec || 0,
      exchange: view.exchange || null,
    }));
  res.json({ items });
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.post('/api/upload', upload.single('file'), asyncRoute(async (req, res) => {
  requireUser(req);
  if (req.auth.role === 'employee') requireEmployee(req);
  if (!req.file) throw httpError(400, 'VALIDATION_ERROR', '请选择文件');
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf'];
  const safeExt = allowed.includes(ext) ? ext : '';
  const filename = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + safeExt;
  if (config.storageDriver() === 'pg-oss') {
    const owner = String(req.auth.userId || 'admin').replace(/[^a-zA-Z0-9_-]/g, '');
    const key = 'uploads/' + owner + '/' + filename;
    const url = await store.putPublicObject(key, req.file.buffer, req.file.mimetype);
    const absoluteUrl = /^https?:\/\//.test(url) ? url : config.publicBase(req) + url;
    res.status(201).json({ url, absoluteUrl, name: req.file.originalname || filename });
    return;
  }
  fs.mkdirSync(uploadRoot, { recursive: true });
  fs.writeFileSync(path.join(uploadRoot, filename), req.file.buffer);
  const url = '/uploads/' + filename;
  res.status(201).json({ url, absoluteUrl: config.publicBase(req) + url, name: req.file.originalname || req.file.filename });
}));

app.get('/api/files/*', asyncRoute(async (req, res) => {
  const key = req.params[0] || '';
  if (!key.startsWith('uploads/') || key.includes('..')) {
    throw httpError(404, 'NOT_FOUND', '文件不存在');
  }
  const file = await store.getObject(key);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(file.content);
}));

app.use('/api/holder', require('./routes/holder'));
app.use('/api/account', require('./routes/account'));
app.use('/api', require('./routes/card-ocr'));

app.use('/uploads', express.static(uploadRoot));
app.use('/css', express.static(path.join(adminRoot, 'css')));
app.use('/js', express.static(path.join(adminRoot, 'js')));
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(adminRoot, 'index.html'));
});
app.get('/card.html', (req, res) => {
  res.sendFile(path.join(adminRoot, 'card.html'));
});
app.get('/wechat-logo.jpg', (req, res) => {
  res.sendFile(path.join(adminRoot, 'wechat-logo.jpg'));
});
app.get('/brand-logo.png', (req, res) => {
  res.sendFile(path.join(adminRoot, 'brand-logo.png'));
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    err.status = 400;
    err.code = 'FILE_TOO_LARGE';
    err.message = '文件不能超过 8MB';
  }
  const status = err.status || 500;
  if (!err.status || status >= 500 && !['OCR_NOT_CONFIGURED', 'WECHAT_NOT_CONFIGURED', 'SMS_NOT_CONFIGURED', 'EMAIL_NOT_CONFIGURED'].includes(err.code)) {
    console.error(err);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL',
      message: err.status ? err.message : '服务器错误',
    },
  });
});

function start(port = process.env.PORT || 3000) {
  assertAdminConfigured();
  return ready.then(() => new Promise((resolve) => {
    const server = app.listen(port, () => {
      const shown = server.address().port;
      console.log('创大产控电子名片 API  http://localhost:' + shown);
      console.log('管理后台  http://localhost:' + shown + '/admin');
      console.log('存储驱动  ' + store.driver);
      resolve(server);
    });
  }));
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { app, start };
