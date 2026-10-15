const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { getStore } = require('./db');
const { asyncRoute, httpError } = require('./lib/errors');
const { interestIndexFromStats } = require('./lib/interest');
const { blankPerson, nowIso, seedData, toCard, toSelf } = require('./lib/person');
const { stripAvatarPortrait } = require('./lib/media');
const { openIdFromCode, phoneFromWechatCode } = require('./lib/wechat');
const { claimImportedCard } = require('./lib/claim');
const { saveSelfCard, rememberOpenAccount } = require('./lib/contact');
const { writeDefault, writeCard, writeCompanyTemplateCard, removeCard, addCard, switchTo, ensureCards, projectCard, projectActive, TEMPLATES } = require('./lib/cards');
const { makeCertCode, subsidiaryId, hideCertCode } = require('./lib/certify');
const { listTemplates, visibleTemplates, templateFor, createTemplate, companyForTemplate } = require('./lib/templates');
const {
  text,
  normalizeAttachments,
  assertHexColor,
} = require('./lib/validate');
const { findOccupyingPhone, assertPhoneAvailable } = require('./lib/identity');
const { rowsFromSpreadsheet, rowsFromDocx, normalizeImportRow } = require('./lib/spreadsheet');
const {
  safeEqual,
  adminCredentials,
  assertAdminConfigured,
  hashPassword,
  createSession,
  sessionIsValid,
  requireUser,
  requireAdmin,
  requireEmployee,
} = require('./lib/access');
const { clientIp, assertLoginAllowed, recordLoginFailure, recordLoginSuccess } = require('./lib/loginLock');
const { applyCors } = require('./lib/cors');

let store;
try {
  store = getStore();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const ready = store.ready();
const app = express();
app.set('trust proxy', 1);
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const adminRoot = path.join(__dirname, '..', 'admin-web');
const uploadRoot = config.uploadDir();

app.disable('x-powered-by');
app.use((req, res, next) => {
  const decision = applyCors(req, res);
  if (!decision.allow) {
    return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: '只允许通过指定域名访问' } });
  }
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
  if (!sessionIsValid(session)) {
    await store.deleteSession(token);
    return next();
  }
  if (session.role === 'admin' && session.userId && session.userId !== 'admin') {
    const admin = await store.getAdmin(session.userId);
    if (!admin || admin.passwordHash !== session.secretStamp) {
      await store.deleteSession(token);
      return next();
    }
    req.admin = admin;
  } else if (session.role === 'admin') {
    req.admin = await store.getAdmin('admin') || {
      id: 'admin',
      username: adminCredentials().username,
      companyId: '',
      scope: 'hq',
      passwordHash: session.secretStamp,
    };
  }
  req.auth = session;
  if (session.role === 'employee') req.user = await store.getPerson(session.userId);
  next();
}));

function publicCard(person, shareCardId) {
  const pinned = shareCardId ? projectCard(person, shareCardId) : null;
  if (shareCardId && !pinned) throw httpError(404, 'CARD_NOT_FOUND', '这张名片不存在');
  const card = pinned ? toCard(pinned) : toCard(person);
  delete card.kind;
  delete card.status;
  return card;
}

function matchesQuery(person, q) {
  if (!q) return true;
  const cardFields = (person.cards || []).flatMap((card) => [
    card.name, card.phone, card.title, card.email, card.company,
  ]);
  const haystack = [person.name, person.phone, person.employeeNo, person.title, person.email, person.department, person.company, ...cardFields]
    .join('\n')
    .toLowerCase();
  return haystack.includes(String(q).trim().toLowerCase());
}

// Certification is a relationship between a user and a subsidiary. Older data
// may contain rows created per card, so expose exactly one effective row here.
function uniqueCertificationApplications(items) {
  const rank = { approved: 3, pending: 2, revoked: 1, rejected: 1 };
  const byCompany = new Map();
  for (const item of items || []) {
    const key = String(item.personId || '') + ':' + String(item.companyId || '');
    const previous = byCompany.get(key);
    if (!previous
      || (rank[item.status] || 0) > (rank[previous.status] || 0)
      || ((rank[item.status] || 0) === (rank[previous.status] || 0)
        && String(item.updatedAt || item.createdAt || '') > String(previous.updatedAt || previous.createdAt || ''))) {
      byCompany.set(key, item);
    }
  }
  return Array.from(byCompany.values());
}

function summaryOf(person, stats) {
  const row = stats || { views: 0, visitors: 0, avgDurationSec: 0, exchanges: 0 };
  return {
    cardId: person.id,
    name: person.name,
    employeeNo: person.employeeNo || '',
    views: row.views || 0,
    visitors: row.visitors || 0,
    avgDurationSec: row.avgDurationSec || 0,
    exchanges: row.exchanges || 0,
    interestIndex: interestIndexFromStats(row),
  };
}

function parsePage(query) {
  const page = Math.max(1, Number.parseInt(query && query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query && query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
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
  if (body.attachments !== undefined) next.attachments = normalizeAttachments(body.attachments);
  delete next.avatar;
  delete next.portrait;
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
      employeeNo: draft.employeeNo,
      status: draft.status || target.status || 'active',
    });
    next.id = target.id;
    next.openid = target.openid;
    next.createdAt = target.createdAt;
    const saved = await store.updatePerson(target.id, writeCompanyTemplateCard(next, {
      name: next.name,
      company: next.company,
      title: next.title,
      phone: next.phone,
      wechat: next.wechat,
      email: next.email,
      address: next.address,
      companyId: draft.companyId || 'default',
      cardTemplate: draft.cardTemplate || 'classic',
      templateName: draft.templateName || '',
    }));
    await ensureImportedCertification(saved, draft.companyId);
    return { employee: saved, merged: true };
  }
  const id = draft.employeeNo && /^[A-Za-z0-9_-]+$/.test(draft.employeeNo)
    ? 'emp-' + draft.employeeNo
    : 'emp-' + crypto.randomBytes(4).toString('hex');
  if (await store.getPerson(id)) throw httpError(409, 'EMPLOYEE_EXISTS', '名片编号已存在');
  const person = writeCompanyTemplateCard({ ...draft, id, kind: 'employee', createdAt: nowIso(), cards: [] }, {
    name: draft.name,
    company: draft.company,
    title: draft.title,
    phone: draft.phone,
    wechat: draft.wechat,
    email: draft.email,
    address: draft.address,
    companyId: draft.companyId || 'default',
    cardTemplate: draft.cardTemplate || 'classic',
    templateName: draft.templateName || '',
  });
  await store.insertPerson(person);
  await ensureImportedCertification(person, draft.companyId);
  return { employee: person, merged: false };
}

async function ensureImportedCertification(person, companyId) {
  if (!person || !companyId || companyId === 'default') return;
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.id === ready.activeCardId)
    || ready.cards.find((item) => item.companyId === companyId);
  if (!card) return;
  const company = await store.getCompany(companyId);
  const existing = (await store.listApplications()).find((item) => (
    item.personId === person.id
    && item.cardId === card.id
    && item.companyId === companyId
    && (item.status === 'approved' || item.status === 'pending')
  ));
  if (existing && existing.status === 'approved') return;
  const now = nowIso();
  await store.saveApplication({
    id: existing ? existing.id : 'cert-' + crypto.randomBytes(4).toString('hex'),
    personId: person.id,
    cardId: card.id,
    companyId,
    companyName: (company && company.name) || card.company || '',
    name: card.name || person.name || '',
    phone: card.phone || '',
    title: card.title || '',
    status: 'approved',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });
}

async function ensureHqAdmin() {
  const cred = adminCredentials();
  const existing = await store.getAdmin('admin');
  const admin = {
    id: 'admin',
    username: cred.username,
    passwordHash: hashPassword(cred.password),
    companyId: '',
    scope: 'hq',
  };
  if (!existing || existing.passwordHash !== admin.passwordHash || existing.username !== admin.username) {
    await store.saveAdmin(admin);
  }
  return admin;
}

function adminOf(req) {
  return req.admin || { id: 'admin', username: adminCredentials().username, companyId: '', scope: 'hq' };
}

function viewForAdmin(person, admin) {
  if (!person) return null;
  if (!admin || admin.scope === 'hq') return person;
  const ready = ensureCards(person);
  const cards = ready.cards.filter((card) => card.companyId === admin.companyId);
  if (!cards.length) return null;
  return projectActive({ ...ready, cards, activeCardId: cards[0].id });
}

function employeeForAdmin(person, admin) {
  if (!admin || admin.scope !== 'company') return person ? toSelf(person) : null;
  const view = viewForAdmin(person, admin);
  return view ? toSelf(view) : null;
}

async function visibleEmployeeIds(admin) {
  if (!admin || admin.scope !== 'company') return null;
  const people = await store.listPeople({ kind: 'employee' });
  return people.filter((person) => viewForAdmin(person, admin)).map((person) => person.id);
}

async function allowedCardTemplate(templateId, admin) {
  const root = await store.getCompany('default');
  const selected = templateFor(root, templateId || 'classic', admin);
  if (!selected) throw httpError(403, 'TEMPLATE_FORBIDDEN', '该模板未分配给当前子管理员');
  return selected;
}

async function companiesWithCodes() {
  const items = await store.listCompanies();
  const used = new Set(items.map((item) => item.certCode).filter(Boolean));
  const next = [];
  for (const item of items) {
    if (item.certCode) {
      next.push(item);
      continue;
    }
    let code = '';
    do { code = makeCertCode(); } while (used.has(code));
    used.add(code);
    const { id, ...rest } = item;
    const saved = { ...rest, certCode: code };
    await store.saveCompanyRecord(id, saved);
    next.push({ id, ...saved });
  }
  return next;
}

app.get('/api/companies', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以查看全部公司');
  res.json({ items: await companiesWithCodes() });
}));

app.post('/api/companies', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以新建公司');
  const name = text(req.body && req.body.name, 80);
  if (!name) throw httpError(400, 'VALIDATION_ERROR', '公司名称不能为空');
  const id = 'co-' + crypto.randomBytes(3).toString('hex');
  const base = seedData().company;
  const existing = await store.listCompanies();
  const used = new Set(existing.map((item) => item.certCode).filter(Boolean));
  let certCode = '';
  do { certCode = makeCertCode(); } while (used.has(certCode));
  const company = {
    ...base,
    name,
    shortName: text(req.body && req.body.shortName, 20) || name.slice(0, 8),
    address: text(req.body && req.body.address, 160) || '',
    phone: text(req.body && req.body.phone, 40) || '',
    certCode,
  };
  await store.saveCompanyRecord(id, company);
  res.status(201).json({ id, company });
}));

app.post('/api/company-admins', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以创建子公司管理员');
  const username = text(req.body && req.body.username, 40);
  const password = String((req.body && req.body.password) || '');
  const companyId = text(req.body && req.body.companyId, 40);
  if (!username || password.length < 6) throw httpError(400, 'VALIDATION_ERROR', '请填写账号，密码至少 6 位');
  if (!(await store.getCompany(companyId))) throw httpError(404, 'NOT_FOUND', '公司不存在');
  if (await store.findAdminByUsername(username)) throw httpError(409, 'ADMIN_EXISTS', '这个管理员账号已存在');
  const admin = {
    id: 'admin-' + crypto.randomBytes(3).toString('hex'),
    username,
    passwordHash: hashPassword(password),
    companyId,
    scope: 'company',
  };
  await store.saveAdmin(admin);
  res.status(201).json({ id: admin.id, username, companyId, scope: 'company' });
}));

app.get('/api/auth/options', asyncRoute(async (req, res) => {
  res.json({ wechatSkip: config.wechatSkipAllowed() });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  await ensureHqAdmin();
  const username = text(req.body && req.body.username, 40);
  const password = req.body && req.body.password;
  const ip = clientIp(req);
  assertLoginAllowed(ip, username);
  const account = await store.findAdminByUsername(username);
  if (!account || !safeEqual(hashPassword(password || ''), account.passwordHash)) {
    recordLoginFailure(ip, username);
    throw httpError(401, 'LOGIN_FAILED', '账号或密码错误');
  }
  recordLoginSuccess(ip, username);
  const session = await createSession(store, account.id, 'admin', account.passwordHash);
  res.json({
    token: session.token,
    role: 'admin',
    username: account.username,
    scope: account.scope || 'company',
    companyId: account.companyId || '',
  });
}));

app.post('/api/auth/wechat', asyncRoute(async (req, res) => {
  const openid = await openIdFromCode(req.body && req.body.code);
  let person = await store.findEmployeeByOpenid(openid);
  if (person && person.status !== 'active') {
    const message = person.status === 'closed' ? '账号已注销，请联系管理员恢复' : '账号已停用';
    throw httpError(403, 'ACCOUNT_INACTIVE', message);
  }

  if (req.body && req.body.resume) {
    if (!person || person.status !== 'active') {
      throw httpError(404, 'NO_SESSION', '需要微信授权手机号');
    }
    await rememberOpenAccount(store, openid, person.id);
    const session = await createSession(store, person.id, 'employee');
    res.json({
      token: session.token,
      role: 'employee',
      employee: toSelf(person),
      returning: true,
      claimed: false,
      matchedImport: false,
    });
    return;
  }

  const phoneCode = text(req.body && req.body.phoneCode, 256);
  const requirePhone = !config.wechatSkipAllowed();
  if (!(person && person.status === 'active') && requirePhone && !phoneCode) {
    throw httpError(400, 'PHONE_REQUIRED', '请授权微信绑定手机号后登录');
  }

  let phone = '';
  if (phoneCode) phone = await phoneFromWechatCode(phoneCode);

  let claimed = false;
  if (phone) {
    const result = await claimImportedCard(store, {
      phone,
      openid,
      shell: person || null,
    });
    if (result) {
      person = result.employee;
      claimed = true;
    }
  }

  if (!person) {
    const card = {
      id: 'card-default',
      template: 'classic',
      isDefault: true,
      name: '',
      company: '',
      title: '',
      phone,
      wechat: '',
      email: '',
      address: '',
      companyId: '',
      attachments: [],
    };
    person = blankPerson({
      id: 'emp-' + crypto.randomBytes(4).toString('hex'),
      kind: 'employee',
      openid,
      phone,
      authPhone: phone,
      company: '',
      cards: [card],
      activeCardId: card.id,
    });
    await store.insertPerson(person);
  } else if (phone && (!person.authPhone || !person.phone)) {
    person = await store.updatePerson(person.id, {
      ...person,
      authPhone: person.authPhone || phone,
      phone: person.phone || phone,
      updatedAt: nowIso(),
    });
  }

  await rememberOpenAccount(store, openid, person.id);
  const session = await createSession(store, person.id, 'employee');
  res.json({
    token: session.token,
    role: 'employee',
    employee: toSelf(person),
    returning: true,
    claimed,
    matchedImport: claimed,
  });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (req.auth) await store.deleteSession(req.auth.token);
  res.json({ ok: true });
}));

app.get('/api/me', asyncRoute(async (req, res) => {
  const auth = requireUser(req);
  if (auth.role === 'admin') {
    const admin = adminOf(req);
    res.json({
      role: 'admin',
      username: admin.username,
      scope: admin.scope || 'hq',
      companyId: admin.companyId || '',
    });
    return;
  }
  if (!req.user || req.user.status !== 'active') throw httpError(401, 'UNAUTHORIZED', '请先登录');
  res.json({ role: 'employee', employee: toSelf(req.user) });
}));

app.get('/api/company', asyncRoute(async (req, res) => {
  const id = text(req.query.id, 40) || 'default';
  let company = await store.getCompany(id);
  const isAdmin = req.auth && req.auth.role === 'admin';
  if (company && isAdmin && !company.certCode) {
    const items = await companiesWithCodes();
    company = items.find((item) => item.id === id) || company;
  }
  const visible = isAdmin
    ? (adminOf(req).scope === 'hq' || !company ? company : (({ cardTemplates, ...rest }) => rest)(company))
    : hideCertCode(company);
  res.json({ company: visible });
}));

app.put('/api/company', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const requested = text((req.body && req.body.companyId) || req.query.id, 40);
  const companyId = admin.scope === 'company' ? admin.companyId : (requested || 'default');
  if (admin.scope === 'company' && requested && requested !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能修改本公司的资料');
  }
  const current = (await store.getCompany(companyId)) || (companyId === 'default' ? seedData().company : null);
  if (!current) throw httpError(404, 'NOT_FOUND', '公司不存在');
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
  res.json({ company: await store.saveCompanyRecord(companyId, next) });
}));

app.get('/api/templates', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const root = await store.getCompany('default');
  const admin = adminOf(req);
  const custom = visibleTemplates(root, admin).map((item) => admin.scope === 'company'
    ? { ...item, companyIds: [admin.companyId] }
    : item);
  res.json({ items: [{ id: 'classic', name: '创大产控模板' }].concat(custom) });
}));

app.post('/api/templates', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以创建模板');
  const root = await store.getCompany('default');
  const row = createTemplate(req.body || {}, root);
  const companyIds = new Set((await store.listCompanies()).map((item) => item.id));
  if (row.companyIds.some((id) => id === 'default' || !companyIds.has(id))) {
    throw httpError(400, 'VALIDATION_ERROR', '分配的子公司不存在');
  }
  const saved = { ...root, cardTemplates: listTemplates(root).concat(row) };
  await store.saveCompanyRecord('default', saved);
  res.status(201).json({ template: row });
}));

app.put('/api/templates/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以修改模板');
  const root = await store.getCompany('default');
  const original = listTemplates(root).find((item) => item.id === req.params.id);
  if (!original) throw httpError(404, 'NOT_FOUND', '模板不存在');
  const row = { ...createTemplate(req.body || {}, root), id: original.id };
  const companyIds = new Set((await store.listCompanies()).map((item) => item.id));
  if (row.companyIds.some((id) => id === 'default' || !companyIds.has(id))) {
    throw httpError(400, 'VALIDATION_ERROR', '分配的子公司不存在');
  }
  await store.saveCompanyRecord('default', {
    ...root,
    cardTemplates: listTemplates(root).map((item) => item.id === row.id ? row : item),
  });
  res.json({ template: row });
}));

app.delete('/api/templates/:id/assignment', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  if (admin.scope !== 'company' || !admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只有子公司管理员可以移除本公司的模板分配');
  }
  const root = await store.getCompany('default');
  const original = listTemplates(root).find((item) =>
    item.id === req.params.id && (item.companyIds || []).includes(admin.companyId));
  if (!original) throw httpError(404, 'NOT_FOUND', '本公司没有该模板分配');
  const updated = {
    ...original,
    companyIds: original.companyIds.filter((id) => id !== admin.companyId),
  };
  await store.saveCompanyRecord('default', {
    ...root,
    cardTemplates: listTemplates(root).map((item) => item.id === updated.id ? updated : item),
  });
  res.json({ template: updated });
}));

app.get('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const q = req.query.q || '';
  const admin = adminOf(req);
  const people = await store.listPeople({ kind: 'employee' });
  const items = people
    .map((person) => viewForAdmin(person, admin))
    .filter((person) => person && matchesQuery(person, q))
    .map(toSelf);
  res.json({ items });
}));

app.post('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const companyId = admin.scope === 'company' ? admin.companyId : 'default';
  const company = await store.getCompany(companyId);
  const draft = applyAdminFields(blankPerson({
    id: 'pending',
    company: company ? company.name : '',
    companyId,
  }), req.body || {});
  draft.companyId = companyId;
  const cardTemplate = text(req.body && req.body.cardTemplate, 20);
  const selectedTemplate = await allowedCardTemplate(cardTemplate, admin);
  draft.cardTemplate = selectedTemplate.id;
  draft.templateName = selectedTemplate.name;
  assertStaffIdentity(draft);
  const result = await upsertImported(draft);
  res.status(result.merged ? 200 : 201).json({
    employee: employeeForAdmin(result.employee, admin),
    merged: result.merged,
  });
}));

async function importEmployeeList(list, res, options) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'VALIDATION_ERROR', '请提供 list 数组');
  const companyId = (options && options.companyId) || 'default';
  const selectedTemplate = await allowedCardTemplate(options && options.cardTemplate, options && options.admin);
  const cardTemplate = selectedTemplate.id;
  const company = await store.getCompany(companyId);
  const prepared = [];
  const rejected = [];
  const seenNo = new Set();
  const seenPhone = new Set();
  list.forEach((item, index) => {
    const source = normalizeImportRow(item || {});
    const row = index + 1;
    let draft;
    try {
      draft = applyAdminFields(blankPerson({
        id: 'pending',
        company: company ? company.name : '',
      }), source);
      draft.companyId = companyId;
      draft.cardTemplate = cardTemplate;
      draft.templateName = selectedTemplate.name;
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
  const admin = options && options.admin;
  res.status(201).json({
    items: saved.map((item) => ({ ...(employeeForAdmin(item.employee, admin) || toSelf(item.employee)), merged: item.merged })),
    rejected,
  });
}

app.post('/api/employees/batch', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const companyId = admin.scope === 'company' ? admin.companyId : 'default';
  await importEmployeeList(req.body && req.body.list, res, {
    companyId,
    cardTemplate: text(req.body && req.body.cardTemplate, 20),
    admin,
  });
}));

app.post('/api/employees/import-file', importUpload.single('file'), asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw httpError(400, 'VALIDATION_ERROR', '请选择表格文件');
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const allowed = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv', '.txt', '.tsv', '.ods', '.docx'];
  if (ext === '.doc') {
    throw httpError(400, 'VALIDATION_ERROR', '旧版 Word 请另存为 .docx 后再导入');
  }
  if (ext && !allowed.includes(ext)) {
    throw httpError(400, 'VALIDATION_ERROR', '请上传 xlsx、xls、csv、docx 或其他表格文件');
  }
  let rows = [];
  try {
    rows = ext === '.docx' ? await rowsFromDocx(req.file.buffer) : rowsFromSpreadsheet(req.file.buffer);
  } catch (err) {
    throw httpError(400, 'VALIDATION_ERROR', err.code && err.message ? err.message : '无法识别这个文件');
  }
  if (!rows.length) throw httpError(400, 'VALIDATION_ERROR', '表格里没有可导入的数据');
  await importEmployeeList(rows, res, {
    companyId: adminOf(req).scope === 'company' ? adminOf(req).companyId : 'default',
    cardTemplate: text(req.body && req.body.cardTemplate, 20),
    admin: adminOf(req),
  });
}));

app.post('/api/employees/:id/merge', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以合并员工');
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
  const view = viewForAdmin(person, adminOf(req));
  if (!person || person.kind !== 'employee' || !view) throw httpError(404, 'NOT_FOUND', '员工不存在');
  res.json({ employee: toSelf(view) });
}));

app.put('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const body = { ...(req.body || {}) };
  const cardId = text(body.cardId, 40);
  const admin = adminOf(req);
  if (admin.scope === 'company') {
    if (!cardId) throw httpError(400, 'VALIDATION_ERROR', '请指定要修改的名片');
    const ready = ensureCards(person);
    const owned = ready.cards.find((card) => card.id === cardId && card.companyId === admin.companyId);
    if (!owned) throw httpError(403, 'FORBIDDEN', '只能管理本公司的名片');
    delete body.status;
    delete body.employeeNo;
    delete body.department;
  }
  const next = applyAdminFields(person, body);
  const readyCards = (Array.isArray(person.cards) && person.cards.length) ? person.cards : [];
  const targetCard = readyCards.find((card) => card.id === cardId) || readyCards.find((card) => card.isDefault);
  const requirePhone = !targetCard || targetCard.isDefault || !cardId;
  if (requirePhone && !next.phone) throw httpError(400, 'VALIDATION_ERROR', '手机号不能为空');
  await assertEmployeeNoFree(next.employeeNo, person.id);
  if (requirePhone && next.phone) await assertPhoneAvailable(store, next.phone, person.id);
  const fields = {
    name: next.name,
    company: next.company,
    title: next.title,
    phone: next.phone,
    wechat: next.wechat,
    email: next.email,
    address: next.address,
  };
  const touchesCard = ['name', 'company', 'title', 'phone', 'wechat', 'email', 'address']
    .some((key) => body[key] !== undefined);
  let stored = next;
  if (touchesCard) {
    stored = cardId ? writeCard(next, cardId, fields) : writeDefault(next, fields);
    if (!stored) throw httpError(404, 'NOT_FOUND', '名片不存在');
  }
  const saved = await store.updatePerson(person.id, stored);
  const visible = employeeForAdmin(saved, admin);
  if (!visible) throw httpError(404, 'NOT_FOUND', '员工不存在');
  res.json({ employee: visible });
}));

app.delete('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const admin = adminOf(req);
  if (admin.scope === 'company') {
    const ready = ensureCards(person);
    const mine = ready.cards.filter((card) => card.companyId === admin.companyId);
    if (!mine.length) throw httpError(404, 'NOT_FOUND', '员工不存在');
    if (mine.length < ready.cards.length) {
      let next = person;
      for (const card of mine) next = removeCard(next, card.id);
      next.updatedAt = nowIso();
      await store.updatePerson(person.id, next);
      res.json({ ok: true });
      return;
    }
  }
  if (admin.scope !== 'company') await store.deleteApplicationsForPerson(person.id);
  await store.deletePerson(person.id);
  res.json({ ok: true });
}));

app.get('/api/employee/companies', asyncRoute(async (req, res) => {
  requireEmployee(req);
  const items = (await store.listCompanies())
    .filter((item) => item.id && item.id !== 'default')
    .map((item) => ({ id: item.id, name: item.name || '', shortName: item.shortName || '' }));
  res.json({ items });
}));

app.get('/api/employee/certification', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const cardId = text(req.query.cardId, 40);
  const ready = ensureCards(user);
  const card = ready.cards.find((item) => item.id === cardId);
  if (!card) throw httpError(404, 'NOT_FOUND', '名片不存在');
  const ownedId = subsidiaryId(card);
  const owned = ownedId ? await store.getCompany(ownedId) : null;
  const applications = uniqueCertificationApplications((await store.listApplications())
    .filter((item) => item.personId === user.id));
  const present = (item) => ({
    id: item.id,
    companyId: item.companyId,
    companyName: item.companyName || '',
    status: item.status,
  });
  const certified = applications.filter((item) => item.status === 'approved').map(present);
  if (ownedId && !certified.some((item) => item.companyId === ownedId)) {
    certified.push({
      id: '',
      companyId: ownedId,
      companyName: owned ? owned.name : '',
      status: 'approved',
    });
  }
  res.json({
    cardId,
    companyId: ownedId,
    companyName: owned ? owned.name : '',
    certified,
    pending: applications.filter((item) => item.status === 'pending').map(present),
  });
}));

app.post('/api/employee/certification', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const cardId = text(req.body && req.body.cardId, 40);
  const ready = ensureCards(user);
  const card = ready.cards.find((item) => item.id === cardId);
  if (!card) throw httpError(404, 'NOT_FOUND', '名片不存在');
  const code = text(req.body && req.body.code, 12).toUpperCase();
  let company = null;
  if (code) {
    company = (await store.listCompanies()).find((item) => String(item.certCode || '').toUpperCase() === code);
    if (!company) throw httpError(404, 'NOT_FOUND', '认证码不正确');
  } else {
    const companyId = text(req.body && req.body.companyId, 40);
    if (!companyId) throw httpError(400, 'VALIDATION_ERROR', '请选择公司或填写认证码');
    company = (await store.listCompanies()).find((item) => item.id === companyId);
    if (!company) throw httpError(404, 'NOT_FOUND', '公司不存在');
  }
  if (!company.id || company.id === 'default') throw httpError(400, 'VALIDATION_ERROR', '请选择子公司');
  const applications = await store.listApplications();
  const sameCompany = (item, status) => item.personId === user.id && item.companyId === company.id && item.status === status;
  if (applications.some((item) => sameCompany(item, 'approved')) || subsidiaryId(card) === company.id) {
    throw httpError(409, 'ALREADY_CERTIFIED', '这张名片已认证该公司');
  }
  const now = nowIso();
  // A certification belongs to a person and subsidiary, rather than to a single
  // version of that person's card. This prevents duplicate review rows when a
  // user retries from another card while the first request is still pending.
  const existing = applications.find((item) => sameCompany(item, 'pending'));
  const row = {
    id: existing ? existing.id : 'cert-' + crypto.randomBytes(4).toString('hex'),
    personId: user.id,
    cardId,
    companyId: company.id,
    companyName: company.name || '',
    name: card.name || user.name || '',
    phone: card.phone || '',
    title: card.title || '',
    status: 'pending',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  await store.saveApplication(row);
  res.status(existing ? 200 : 201).json({
    alreadyPending: !!existing,
    application: {
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      status: row.status,
    },
  });
}));

app.get('/api/certifications', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const items = uniqueCertificationApplications((await store.listApplications())
    .filter((item) => item.status === 'pending' || item.status === 'approved')
    .filter((item) => admin.scope !== 'company' || item.companyId === admin.companyId))
    .map((item) => ({
      id: item.id,
      personId: item.personId,
      cardId: item.cardId,
      companyId: item.companyId,
      companyName: item.companyName || '',
      name: item.name || '',
      phone: item.phone || '',
      title: item.title || '',
      status: item.status,
      createdAt: item.createdAt,
    }));
  res.json({ items });
}));

app.post('/api/certifications/:id/approve', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const row = (await store.listApplications()).find((item) => item.id === req.params.id);
  if (!row || row.status !== 'pending') throw httpError(404, 'NOT_FOUND', '申请不存在');
  if (admin.scope === 'company' && row.companyId !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能审核本公司的申请');
  }
  const person = await store.getPerson(row.personId);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.id === row.cardId);
  if (!card) throw httpError(404, 'NOT_FOUND', '名片不存在');
  const company = await store.getCompany(row.companyId);
  if (!company) throw httpError(404, 'NOT_FOUND', '公司不存在');
  const saved = { ...row, status: 'approved', updatedAt: nowIso() };
  await store.saveApplication(saved);
  res.json({ ok: true });
}));

app.post('/api/certifications/:id/reject', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const row = (await store.listApplications()).find((item) => item.id === req.params.id);
  if (!row || row.status !== 'pending') throw httpError(404, 'NOT_FOUND', '申请不存在');
  if (admin.scope === 'company' && row.companyId !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能审核本公司的申请');
  }
  await store.saveApplication({ ...row, status: 'rejected', updatedAt: nowIso() });
  res.json({ ok: true });
}));

app.post('/api/certifications/:id/revoke', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const row = (await store.listApplications()).find((item) => item.id === req.params.id);
  if (!row || row.status !== 'approved') throw httpError(404, 'NOT_FOUND', '认证不存在');
  if (admin.scope === 'company' && row.companyId !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能取消本公司的认证');
  }
  const person = await store.getPerson(row.personId);
  if (person && person.kind === 'employee') {
    const ready = ensureCards(person);
    const card = ready.cards.find((item) => item.id === row.cardId);
    if (card && subsidiaryId(card) === row.companyId) {
      const next = writeCard(person, row.cardId, { companyId: '', company: '' });
      if (next) {
        next.updatedAt = nowIso();
        await store.updatePerson(person.id, next);
      }
    }
  }
  await store.saveApplication({ ...row, status: 'revoked', updatedAt: nowIso() });
  res.json({ ok: true });
}));

app.get('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const employee = toSelf(user);
  const root = await store.getCompany('default');
  const company = await store.getCompany(employee.companyId || 'default');
  const cardCompanies = {};
  await Promise.all((employee.cards || []).map(async (card) => {
    const cardCompany = await store.getCompany(card.companyId || 'default');
    cardCompanies[card.id] = hideCertCode(companyForTemplate(cardCompany || root, root, card.template));
  }));
  res.json({ employee, templateCompany: hideCertCode(companyForTemplate(company || root, root, employee.cardTemplate)), cardCompanies });
}));

app.get('/api/employee/templates', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const root = await store.getCompany('default');
  const approvedIds = new Set((await store.listApplications())
    .filter((item) => item.personId === user.id && item.status === 'approved')
    .map((item) => item.companyId));
  const items = [
    { id: 'classic', name: '创大产控模板' },
    { id: 'horizon', name: '晴空模板' },
    { id: 'wave', name: '蓝韵模板' },
  ].map((item) => ({ ...item, companyId: '', companyName: '总公司', company: hideCertCode(root) }));
  for (const template of listTemplates(root)) {
    for (const companyId of template.companyIds || []) {
      if (!approvedIds.has(companyId)) continue;
      const company = await store.getCompany(companyId);
      if (!company) continue;
      items.push({
        id: template.id,
        name: template.name,
        companyId,
        companyName: company.name,
        company: hideCertCode(companyForTemplate(company, root, template.id)),
      });
    }
  }
  res.json({ items });
}));

app.put('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const saved = await saveSelfCard(store, user, req.body || {});
  res.json({ employee: toSelf(saved) });
}));

app.post('/api/employee/cards', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const template = text(req.body && req.body.template, 20);
  let cardOptions = {};
  if (template.startsWith('tpl-')) {
    const root = await store.getCompany('default');
    const selected = listTemplates(root).find((item) => item.id === template);
    if (!selected) {
      throw httpError(400, 'VALIDATION_ERROR', '模板不存在');
    }
    const companyId = text(req.body && req.body.companyId, 40);
    if (!companyId || !(selected.companyIds || []).includes(companyId)) {
      throw httpError(403, 'TEMPLATE_FORBIDDEN', '该企业未分配此模板');
    }
    const approved = (await store.listApplications()).some((item) =>
      item.personId === user.id && item.companyId === companyId && item.status === 'approved');
    if (!approved) throw httpError(403, 'TEMPLATE_FORBIDDEN', '请先完成该企业认证');
    const company = await store.getCompany(companyId);
    if (!company) throw httpError(404, 'NOT_FOUND', '公司不存在');
    cardOptions = { companyId, company: company.name, templateName: selected.name };
  }
  let next;
  try {
    next = addCard(user, template, cardOptions);
  } catch (err) {
    throw httpError(err.status || 400, err.code || 'VALIDATION_ERROR', err.message || '无法创建名片');
  }
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(user.id, next);
  res.status(201).json({ employee: toSelf(saved) });
}));

app.put('/api/employee/cards/active', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const cardId = text(req.body && req.body.cardId, 40);
  const next = switchTo(user, cardId);
  if (!next) throw httpError(404, 'NOT_FOUND', '名片不存在');
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(user.id, next);
  res.json({ employee: toSelf(saved) });
}));

app.delete('/api/employee/cards/:cardId', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  let next;
  try {
    next = removeCard(user, req.params.cardId);
  } catch (err) {
    throw httpError(err.status || 400, err.code || 'VALIDATION_ERROR', err.message || '无法删除名片');
  }
  if (!next) throw httpError(404, 'NOT_FOUND', '名片不存在');
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(user.id, next);
  res.json({ employee: toSelf(saved) });
}));

app.delete('/api/employees/:id/cards/:cardId', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.id === req.params.cardId);
  if (!card) throw httpError(404, 'NOT_FOUND', '名片不存在');
  const admin = adminOf(req);
  if (admin.scope === 'company' && card.companyId !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能删除本公司的名片');
  }
  let next;
  try {
    next = removeCard(person, req.params.cardId);
  } catch (err) {
    throw httpError(err.status || 400, err.code || 'VALIDATION_ERROR', err.message || '无法删除名片');
  }
  if (!next) throw httpError(404, 'NOT_FOUND', '名片不存在');
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(person.id, next);
  res.json({ employee: employeeForAdmin(saved, admin) });
}));

app.get('/api/cards/:id/qr', asyncRoute(async (req, res) => {
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee' || person.status !== 'active') {
    throw httpError(404, 'CARD_UNAVAILABLE', '名片不可见');
  }
  const shareCard = text(req.query.shareCard, 64);
  if (shareCard && !projectCard(person, shareCard)) throw httpError(404, 'CARD_NOT_FOUND', '这张名片不存在');
  const pinnedId = shareCard || ensureCards(person).activeCardId || '';
  const QRCode = require('qrcode');
  const target = config.publicBase(req) + '/card.html?cardId=' + encodeURIComponent(person.id)
    + (pinnedId ? '&shareCard=' + encodeURIComponent(pinnedId) : '');
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
  const card = publicCard(person, text(req.query.shareCard, 64));
  const root = await store.getCompany('default');
  const company = hideCertCode(companyForTemplate(
    await store.getCompany(card.companyId || 'default'), root, card.cardTemplate
  ));
  res.json({ card, company, owned: false });
}));

app.post('/api/analytics/view', asyncRoute(async (req, res) => {
  const cardId = text(req.body && req.body.cardId, 64);
  const person = await store.getPerson(cardId);
  if (!person || person.kind !== 'employee' || person.status !== 'active') {
    throw httpError(404, 'CARD_UNAVAILABLE', '名片不可见');
  }
  const viewer = req.user && req.user.kind === 'employee' ? req.user : null;
  const view = {
    id: 'view-' + crypto.randomBytes(6).toString('hex'),
    cardId,
    visitorId: text(req.body && req.body.visitorId, 64),
    visitorName: viewer ? text(viewer.name, 40) : '',
    visitorPhone: viewer ? text(viewer.phone, 20) : '',
    visitorTitle: viewer ? text(viewer.title, 40) : '',
    visitorCompany: viewer ? text(viewer.company, 80) : '',
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
  let people = [];
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    people = [req.user];
  } else {
    requireAdmin(req);
    people = await store.listPeople({ kind: 'employee' });
    people = people.filter((person) => viewForAdmin(person, adminOf(req)));
    if (req.query.cardId) people = people.filter((person) => person.id === req.query.cardId);
  }
  const from = text(req.query.from, 10);
  const to = text(req.query.to, 10);
  const statsRows = await store.summarizeViews({
    cardIds: people.map((person) => person.id),
    from: from || undefined,
    to: to || undefined,
  });
  const byCard = new Map(statsRows.map((row) => [row.cardId, row]));
  const items = people.map((person) => summaryOf(person, byCard.get(person.id)));
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
    const allowed = await visibleEmployeeIds(adminOf(req));
    if (allowed) {
      if (cardId && !allowed.includes(cardId)) throw httpError(403, 'FORBIDDEN', '只能查看本公司的名片数据');
      if (!cardId) req.companyCardIds = allowed;
    }
  }
  const { page, limit, offset } = parsePage(req.query);
  const from = text(req.query.from, 10);
  const to = text(req.query.to, 10);
  const pageResult = await store.listViewsPage({
    cardId: cardId || undefined,
    cardIds: req.companyCardIds,
    from: from || undefined,
    to: to || undefined,
    limit,
    offset,
  });
  const people = await store.listPeople({ kind: 'employee' });
  const names = new Map(people.map((person) => [person.id, person.name]));
  const items = pageResult.items.map((view) => {
    const exchange = view.exchange || null;
    return {
      id: view.id,
      cardId: view.cardId,
      cardName: names.get(view.cardId) || '',
      visitorId: view.visitorId || '',
      name: (exchange && exchange.name) || view.visitorName || '游客访问',
      phone: (exchange && exchange.phone) || view.visitorPhone || '',
      title: view.visitorTitle || '',
      company: (exchange && exchange.company) || view.visitorCompany || '',
      startedAt: view.startedAt,
      durationSec: view.durationSec || 0,
      exchange,
    };
  });
  res.json({ items, total: pageResult.total, page, limit });
}));

app.get('/api/analytics/visitors', asyncRoute(async (req, res) => {
  const auth = requireUser(req);
  let cardId = text(req.query.cardId, 64);
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    if (cardId && cardId !== req.user.id) throw httpError(403, 'FORBIDDEN', '只能查看自己的名片数据');
    cardId = req.user.id;
  } else {
    requireAdmin(req);
    if (!cardId) throw httpError(400, 'VALIDATION_ERROR', '请指定名片');
    const allowed = await visibleEmployeeIds(adminOf(req));
    if (allowed && !allowed.includes(cardId)) throw httpError(403, 'FORBIDDEN', '只能查看本公司的名片数据');
  }
  const views = await store.listViews({ cardId });
  const groups = new Map();
  for (const view of views) {
    const key = view.visitorId || view.id;
    let row = groups.get(key);
    if (!row) {
      row = {
        visitorId: view.visitorId || '',
        name: '',
        phone: '',
        title: '',
        company: '',
        visits: 0,
        durationSec: 0,
        lastAt: '',
      };
      groups.set(key, row);
    }
    row.visits += 1;
    row.durationSec += Number(view.durationSec) || 0;
    if (!row.lastAt || String(view.startedAt || '') > row.lastAt) row.lastAt = view.startedAt || '';
    const exchange = view.exchange || {};
    if (exchange.name) row.name = exchange.name;
    if (exchange.phone) row.phone = exchange.phone;
    if (exchange.company) row.company = exchange.company;
    if (!row.name && view.visitorName) row.name = view.visitorName;
    if (!row.phone && view.visitorPhone) row.phone = view.visitorPhone;
    if (!row.title && view.visitorTitle) row.title = view.visitorTitle;
    if (!row.company && view.visitorCompany) row.company = view.visitorCompany;
    if (!row.name) row.name = '游客访问';
  }
  const items = Array.from(groups.values()).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  res.json({ items, total: items.length });
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
app.get('/official-qr.jpg', (req, res) => {
  res.sendFile(path.join(adminRoot, 'official-qr.jpg'));
});
app.get('/wechat-logo.jpg', (req, res) => {
  res.sendFile(path.join(adminRoot, 'wechat-logo.jpg'));
});
app.get('/brand-logo.png', (req, res) => {
  res.sendFile(path.join(adminRoot, 'brand-logo.png'));
});
app.get('/wave-front.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'miniprogram', 'assets', 'wave-front.jpg'));
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

function scheduleCodePurge() {
  if (process.env.NODE_ENV === 'test') return;
  const intervalMs = Number(process.env.CODE_PURGE_MS);
  const every = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 6 * 60 * 60 * 1000;
  const run = () => {
    store.purgeExpiredCodes().then((count) => {
      if (count) console.log('已清理过期验证码 ' + count + ' 条');
    }).catch((err) => console.error('清理验证码失败', err.message || err));
  };
  run();
  setInterval(run, every).unref();
}

function start(port = process.env.PORT || 3000) {
  assertAdminConfigured();
  return ready.then(() => new Promise((resolve) => {
    const server = app.listen(port, () => {
      const shown = server.address().port;
      console.log('创大产控电子名片 API  http://localhost:' + shown);
      console.log('管理后台  http://localhost:' + shown + '/admin');
      console.log('存储驱动  ' + store.driver);
      scheduleCodePurge();
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
