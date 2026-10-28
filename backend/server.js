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
const { writeDefault, writeCard, writeCompanyTemplateCard, removeCard, archiveCard, addCard, switchTo, ensureCards, projectCard, projectActive } = require('./lib/cards');
const { publicCardState } = require('./lib/cardAccess');
const { canViewAdminCard, canEditAdminCard } = require('./lib/adminCardAccess');
const { allTemplates, listTemplates, visibleTemplates, templateGrantedTo, setBuiltInAssignments, createTemplate, companyForTemplate } = require('./lib/templates');
const { defaultPermissionEnabled, normalizePermission, effectivePermission, canManageCompany, assertManageCompany, canManageTemplate, assertManageTemplate, setPermission, mergePermissions } = require('./lib/cardPermissions');
const { migrateCardRecords } = require('./lib/cardMigration');
const {
  text,
  normalizeAttachments,
  assertHexColor,
  normalizePhone,
  assertMobile,
} = require('./lib/validate');
const { findOccupyingPhone } = require('./lib/identity');
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
const { validatedFileType } = require('./lib/fileType');
const {
  reviewCompanyVisible,
  stripCertificationCode,
} = require('./lib/reviewTest');
const {
  REVIEW_COMPANY_ID,
  REVIEW_PERSON_ID,
  isReviewEntryPerson,
  isReviewEntryCompany,
  resetReviewEntry,
} = require('./lib/reviewEntry');

let store;
try {
  store = getStore();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const ready = store.ready().then(async () => {
  await migrateCardRecords(store);
});
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
    if (!admin || admin.passwordHash !== session.secretStamp || admin.reviewOnly) {
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
  if (session.role === 'employee') {
    const user = await store.getPerson(session.userId);
    if (isReviewEntryPerson(user) && (
      !config.reviewEntryEnabled() || session.secretStamp !== config.reviewEntryCodeHash()
    )) {
      await store.deleteSession(token);
      return next();
    }
    req.user = user;
  }
  next();
}));

function publicCard(person, shareCardId) {
  const state = publicCardState(person, shareCardId);
  if (!state.ok) throw httpError(404, state.code, state.message);
  const card = toCard(state.person);
  delete card.kind;
  delete card.status;
  return card;
}

function viewUpdateTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function matchesQuery(person, q) {
  if (!q) return true;
  const cardFields = (person.cards || []).flatMap((card) => [
    card.name, card.phone, card.title, card.email, card.company,
  ]);
  const haystack = [person.name, person.phone, person.authPhone, person.accountPhone, person.employeeNo, person.title, person.email, person.department, person.company, ...cardFields]
    .join('\n')
    .toLowerCase();
  return haystack.includes(String(q).trim().toLowerCase());
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
  assertMobile(normalizePhone(person.phone));
}



async function upsertImported(draft, options = {}) {
  const companyId = String(draft.companyId || '');
  const accountPhone = normalizePhone(draft.accountPhone || draft.phone);
  assertMobile(accountPhone);
  draft.phone = normalizePhone(draft.phone);
  assertMobile(draft.phone);
  const cardTemplate = String(draft.cardTemplate || '');
  if (!companyId) throw httpError(400, 'VALIDATION_ERROR', '创建企业名片必须指定企业');
  if (!cardTemplate) throw httpError(400, 'VALIDATION_ERROR', '创建企业名片必须指定模板');
  const target = await findOccupyingPhone(store, accountPhone);
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
    });
    next.id = target.id;
    next.openid = target.openid;
    next.createdAt = target.createdAt;
    next.accountPhone = target.accountPhone || target.authPhone || accountPhone;
    const cardFields = {
      name: next.name,
      company: next.company,
      title: next.title,
      phone: next.phone,
      wechat: next.wechat,
      email: next.email,
      address: next.address,
      companyId,
      cardTemplate,
      templateName: draft.templateName || '',
    };
    const withCard = options.createNewCard
      ? addCard(next, cardTemplate, { ...cardFields, source: 'company_issued' })
      : writeCompanyTemplateCard(next, cardFields);
    const saved = await store.updatePerson(target.id, withCard);

    return { employee: saved, merged: true };
  }
  const id = 'emp-' + crypto.randomBytes(6).toString('hex');
  if (await store.getPerson(id)) throw httpError(409, 'EMPLOYEE_EXISTS', '名片编号已存在');
  const person = writeCompanyTemplateCard({ ...draft, id, kind: 'employee', accountPhone, createdAt: nowIso(), cards: [] }, {
    name: draft.name,
    company: draft.company,
    title: draft.title,
    phone: draft.phone,
    wechat: draft.wechat,
    email: draft.email,
    address: draft.address,
    companyId,
    cardTemplate,
    templateName: draft.templateName || '',
  });
  await store.insertPerson(person);

  return { employee: person, merged: false };
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

function personRelatedToCompany(person, companyId) {
  return Object.prototype.hasOwnProperty.call(person.companyCardPermissions || {}, companyId)
    || !!(person.cardPermission && (person.cardPermission.companyIds || []).includes(companyId))
    || ensureCards(person).cards.some((card) => card.companyId === companyId);
}

function redactUnrelatedAccount(view, person, admin) {
  if (!view || !admin || admin.scope !== 'company' || personRelatedToCompany(person, admin.companyId)) return view;
  return {
    ...view,
    authPhone: '',
    accountPhone: '',
    employeeNo: '',
    department: '',
  };
}

function viewForAdmin(person, admin, root) {
  if (!person) return null;
  if (!admin || admin.scope === 'hq') return person;
  if (isReviewEntryPerson(person)) return null;
  const ready = ensureCards(person);
  const cards = ready.cards.filter((card) => canViewAdminCard(root, admin, card));
  if (!cards.length && !personRelatedToCompany(person, admin.companyId)) return null;
  const active = cards.find((card) => card.id === ready.activeCardId && card.lifecycle === 'active')
    || cards.find((card) => card.lifecycle === 'active');
  const finish = (view) => redactUnrelatedAccount(view, person, admin);
  if (active) return finish(projectCard({ ...ready, cards }, active.id));
  if (cards.length) return finish({ ...projectCard({ ...ready, cards }, cards[0].id), activeCardId: '' });
  return finish({
    ...ready,
    cards: [],
    activeCardId: '',
    name: '',
    company: '',
    title: '',
    department: '',
    phone: '',
    wechat: '',
    email: '',
    address: '',
    attachments: [],
    companyId: '',
    cardTemplate: '',
    templateName: '',
  });
}

function employeeForAdmin(person, admin, root) {
  const view = viewForAdmin(person, admin, root);
  if (!view) return null;
  const result = toSelf(view);
  result.cards = result.cards.map((card) => ({ ...card, canAdminEdit: canEditAdminCard(root, admin, card) }));
  result.canManageAccount = !admin || admin.scope === 'hq';
  result.canRemoveCompanyCards = result.canManageAccount || result.cards.some((card) => card.canAdminEdit);
  if (admin && admin.scope === 'company' && !personRelatedToCompany(person, admin.companyId)) {
    result.authPhone = '';
    result.accountPhone = '';
    result.employeeNo = '';
    result.department = '';
  }
  return result;
}

async function visibleCompanyScope(admin) {
  if (!admin || admin.scope !== 'company') return null;
  const people = await store.listPeople({ kind: 'employee' });
  const root = await store.getCompany('default');
  const personIds = [];
  const cardIds = [];
  const visiblePeople = [];
  for (const person of people) {
    if (isReviewEntryPerson(person)) continue;
    const cards = ensureCards(person).cards.filter((card) => (
      canViewAdminCard(root, admin, card) && card.lifecycle === 'active'
    ));
    if (!cards.length) continue;
    personIds.push(person.id);
    cardIds.push(...cards.map((card) => card.id));
    visiblePeople.push(viewForAdmin(person, admin, root));
  }
  return { personIds, cardIds, people: visiblePeople };
}

async function companyTargetForAdmin(admin, requestedCompanyId) {
  const requested = text(requestedCompanyId, 40);
  const companyId = admin && admin.scope === 'company' ? admin.companyId : (requested || 'default');
  const company = await store.getCompany(companyId);
  if (!company) throw httpError(404, 'NOT_FOUND', '公司不存在');
  return { companyId, company };
}

async function allowedCardTemplate(templateId, admin, companyId) {
  const root = await store.getCompany('default');
  const requested = templateId || (admin && admin.scope === 'hq' ? 'classic' : '');
  if (!requested) throw httpError(400, 'VALIDATION_ERROR', '当前企业没有可用模板');
  const selected = allTemplates(root).find((item) => item.id === requested);
  if (!selected) throw httpError(400, 'VALIDATION_ERROR', '模板不存在');
  if (admin.scope !== 'hq' && !templateGrantedTo(root, requested, companyId)) {
    throw httpError(403, 'TEMPLATE_FORBIDDEN', '该模板未分配给目标企业');
  }
  return selected;
}

async function managedCompanies({ includeReviewEntry = false } = {}) {
  return (await store.listCompanies())
    .filter((company) => reviewCompanyVisible(company) || (includeReviewEntry && isReviewEntryCompany(company)))
    .map(stripCertificationCode);
}

function publicCompany(company) {
  if (!company) return company;
  const { cardTemplates, cardTemplateGrants, defaultCardPermission, reviewOnly, reviewEntry, ...rest } = stripCertificationCode(company);
  return rest;
}

function publicTemplate(template) {
  return {
    ...template,
    companyIds: (template.companyIds || []).filter((id) => id !== REVIEW_COMPANY_ID),
  };
}

app.get('/api/companies', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以查看全部公司');
  res.json({ items: await managedCompanies() });
}));

app.post('/api/companies', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以新建公司');
  const name = text(req.body && req.body.name, 80);
  if (!name) throw httpError(400, 'VALIDATION_ERROR', '公司名称不能为空');
  const id = 'co-' + crypto.randomBytes(3).toString('hex');
  const base = seedData().company;
  const company = {
    ...base,
    name,
    shortName: text(req.body && req.body.shortName, 20) || name.slice(0, 8),
    address: text(req.body && req.body.address, 160) || '',
    phone: text(req.body && req.body.phone, 40) || '',
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
  res.json({
    wechatSkip: config.wechatSkipAllowed(),
    reviewEntryEnabled: config.reviewEntryEnabled(),
  });
}));

app.post('/api/auth/review-login', asyncRoute(async (req, res) => {
  if (!config.reviewEntryEnabled()) {
    throw httpError(404, 'REVIEW_ENTRY_DISABLED', '审核体验入口未开启');
  }
  const ip = clientIp(req);
  const loginKey = 'wechat-review-entry';
  assertLoginAllowed(ip, loginKey);
  const code = text(req.body && req.body.code, 128);
  if (!code || !safeEqual(hashPassword(code), config.reviewEntryCodeHash())) {
    recordLoginFailure(ip, loginKey);
    throw httpError(401, 'REVIEW_CODE_INVALID', '审核码不正确');
  }
  recordLoginSuccess(ip, loginKey);
  const person = await resetReviewEntry(store);
  const session = await createSession(store, person.id, 'employee', config.reviewEntryCodeHash());
  res.json({
    token: session.token,
    role: 'employee',
    employee: toSelf(person),
    returning: true,
    reviewEntry: true,
  });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  await ensureHqAdmin();
  const username = text(req.body && req.body.username, 40);
  const password = req.body && req.body.password;
  const ip = clientIp(req);
  assertLoginAllowed(ip, username);
  const account = await store.findAdminByUsername(username);
  if (!account || account.reviewOnly
    || !safeEqual(hashPassword(password || ''), account.passwordHash)) {
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
    person = blankPerson({
      id: 'emp-' + crypto.randomBytes(4).toString('hex'),
      kind: 'employee',
      openid,
      phone,
      authPhone: phone,
      company: '',
      cards: [],
      activeCardId: '',
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
  const requested = text(req.query.id, 40);
  const isAdmin = req.auth && req.auth.role === 'admin';
  const admin = isAdmin ? adminOf(req) : null;
  if (admin && admin.scope === 'company' && requested && requested !== admin.companyId) {
    throw httpError(403, 'FORBIDDEN', '只能查看本公司的资料');
  }
  const id = admin && admin.scope === 'company' ? admin.companyId : (requested || 'default');
  let company = await store.getCompany(id);
  if (company && !reviewCompanyVisible(company)) company = null;
  const visible = isAdmin
    ? (admin.scope === 'hq' || !company ? stripCertificationCode(company) : publicCompany(company))
    : publicCompany(company);
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
  const items = visibleTemplates(root, admin).map((item) => publicTemplate(admin.scope === 'company'
    ? { ...item, companyIds: [admin.companyId] }
    : item));
  res.json({ items });
}));

app.post('/api/templates', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以创建模板');
  const root = await store.getCompany('default');
  const row = createTemplate(req.body || {}, root);
  const companyIds = new Set((await store.listCompanies()).filter((item) => !isReviewEntryCompany(item)).map((item) => item.id));
  if (row.companyIds.some((id) => !companyIds.has(id))) {
    throw httpError(400, 'VALIDATION_ERROR', '分配的企业不存在');
  }
  const saved = { ...root, cardTemplates: listTemplates(root).concat(row) };
  await store.saveCompanyRecord('default', saved);
  res.status(201).json({ template: row });
}));

app.put('/api/templates/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总部管理员可以修改模板');
  const root = await store.getCompany('default');
  const original = allTemplates(root).find((item) => item.id === req.params.id);
  if (!original) throw httpError(404, 'NOT_FOUND', '模板不存在');
  const requestedPublicCompanyIds = Array.isArray(req.body && req.body.companyIds)
    ? req.body.companyIds.map((id) => text(id, 40)).filter(Boolean)
    : publicTemplate(original).companyIds;
  const companyIds = new Set((await store.listCompanies()).filter((item) => !isReviewEntryCompany(item)).map((item) => item.id));
  if (requestedPublicCompanyIds.some((id) => !companyIds.has(id))) {
    throw httpError(400, 'VALIDATION_ERROR', '分配的企业不存在');
  }
  const requestedCompanyIds = original.builtIn && original.companyIds.includes(REVIEW_COMPANY_ID)
    ? requestedPublicCompanyIds.concat(REVIEW_COMPANY_ID)
    : requestedPublicCompanyIds;
  const builtInRoot = setBuiltInAssignments(root, original.id, requestedCompanyIds);
  if (builtInRoot) {
    await store.saveCompanyRecord('default', builtInRoot);
    res.json({ template: publicTemplate(allTemplates(builtInRoot).find((item) => item.id === original.id)) });
    return;
  }
  const row = { ...createTemplate(req.body || {}, root), id: original.id, companyIds: requestedPublicCompanyIds };
  await store.saveCompanyRecord('default', {
    ...root,
    cardTemplates: listTemplates(root).map((item) => item.id === row.id ? row : item),
  });
  res.json({ template: row });
}));

app.delete('/api/templates/:id/assignment', asyncRoute(async (req, res) => {
  requireAdmin(req);
  throw httpError(403, 'FORBIDDEN', '模板授权由总部管理员统一管理');
}));

app.get('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const q = req.query.q || '';
  const admin = adminOf(req);
  const people = await store.listPeople({ kind: 'employee' });
  const root = await store.getCompany('default');
  const items = people
    .filter((person) => !isReviewEntryPerson(person))
    .map((person) => employeeForAdmin(person, admin, root))
    .filter((person) => person && matchesQuery(person, q));
  res.json({ items });
}));

app.post('/api/employees', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const { companyId, company } = await companyTargetForAdmin(admin, req.body && req.body.companyId);
  const draft = applyAdminFields(blankPerson({
    id: 'pending',
    company: company ? company.name : '',
    companyId,
  }), req.body || {});
  draft.accountPhone = normalizePhone((req.body && req.body.accountPhone) || draft.phone);
  assertMobile(draft.accountPhone);
  draft.companyId = companyId;
  draft.company = company.name || '';
  const cardTemplate = text(req.body && req.body.cardTemplate, 20);
  const selectedTemplate = await allowedCardTemplate(cardTemplate, admin, companyId);
  draft.cardTemplate = selectedTemplate.id;
  draft.templateName = selectedTemplate.name;
  assertStaffIdentity(draft);
  const result = await upsertImported(draft, { createNewCard: true });
  res.status(result.merged ? 200 : 201).json({
    employee: employeeForAdmin(result.employee, admin, await store.getCompany('default')),
    merged: result.merged,
  });
}));

async function importEmployeeList(list, res, options) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'VALIDATION_ERROR', '请提供 list 数组');
  const companyId = text(options && options.companyId, 40);
  if (!companyId) throw httpError(400, 'VALIDATION_ERROR', '创建企业名片必须指定企业');
  const selectedTemplate = await allowedCardTemplate(options && options.cardTemplate, options && options.admin, companyId);
  const cardTemplate = selectedTemplate.id;
  const company = await store.getCompany(companyId);
  const prepared = [];
  const rejected = [];

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
      draft.company = company ? company.name : '';
      draft.cardTemplate = cardTemplate;
      draft.templateName = selectedTemplate.name;
      draft.phone = normalizePhone(draft.phone);
      draft.accountPhone = draft.phone;
      if (!draft.phone) {
        rejected.push({ row, name: draft.name || '', reason: '缺少手机号，未创建' });
        return;
      }
      assertStaffIdentity(draft);
    } catch (err) {
      rejected.push({ row, name: (source && source.name) || '', reason: err.message || '未创建' });
      return;
    }

    if (seenPhone.has(draft.phone)) {
      rejected.push({ row, name: draft.name || '', reason: '导入列表中手机号重复：' + draft.phone });
      return;
    }
    seenPhone.add(draft.phone);
    draft.importRow = row;
    prepared.push(draft);
  });
  const saved = [];
  for (const draft of prepared) {
    try { saved.push(await upsertImported(draft)); }
    catch (err) { rejected.push({ row: draft.importRow, name: draft.name || '', reason: err.message }); }
  }
  const admin = options && options.admin;
  const root = await store.getCompany('default');
  res.status(201).json({
    items: saved.map((item) => ({ ...employeeForAdmin(item.employee, admin, root), merged: item.merged })),
    rejected,
  });
}

app.post('/api/employees/batch', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const { companyId } = await companyTargetForAdmin(admin, req.body && req.body.companyId);
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
  const allowed = ['.xlsx', '.xlsm', '.csv', '.txt', '.tsv', '.docx'];
  if (ext === '.doc') {
    throw httpError(400, 'VALIDATION_ERROR', '旧版 Word 请另存为 .docx 后再导入');
  }
  if (ext && !allowed.includes(ext)) {
    throw httpError(400, 'VALIDATION_ERROR', '请上传 xlsx、xlsm、csv、tsv 或 docx 文件');
  }
  let rows = [];
  try {
    rows = ext === '.docx'
      ? await rowsFromDocx(req.file.buffer)
      : await rowsFromSpreadsheet(req.file.buffer, ext);
  } catch (err) {
    throw httpError(400, 'VALIDATION_ERROR', err.code && err.message ? err.message : '无法识别这个文件');
  }
  if (!rows.length) throw httpError(400, 'VALIDATION_ERROR', '表格里没有可导入的数据');
  const admin = adminOf(req);
  const { companyId } = await companyTargetForAdmin(admin, req.body && req.body.companyId);
  await importEmployeeList(rows, res, {
    companyId,
    cardTemplate: text(req.body && req.body.cardTemplate, 20),
    admin,
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
  const targetReady = ensureCards(target);
  const sourceReady = ensureCards(source);
  const usedCardIds = new Set(targetReady.cards.map((card) => card.id));
  const transferredCards = sourceReady.cards.map((card) => {
    let id = card.id;
    while (usedCardIds.has(id)) id = 'card-' + crypto.randomBytes(4).toString('hex');
    usedCardIds.add(id);
    return { ...card, id, isDefault: false };
  });
  const withPermissions = mergePermissions(target, source);
  const kept = projectActive({
    ...withPermissions,
    openid: target.openid || source.openid || '',
    authPhone: target.authPhone || source.authPhone || '',
    accountPhone: target.accountPhone || target.authPhone || source.accountPhone || source.authPhone || '',
    cards: targetReady.cards.concat(transferredCards),
    activeCardId: targetReady.activeCardId || (transferredCards[0] && transferredCards[0].id) || '',
    updatedAt: nowIso(),
  });
  await store.updatePerson(target.id, kept);
  const retired = {
    ...source,
    openid: '',
    status: 'disabled',
    cards: [],
    activeCardId: '',
    updatedAt: nowIso(),
  };
  delete retired.cardPermission;
  delete retired.companyCardPermissions;
  await store.updatePerson(source.id, retired);
  await store.deleteSessionsForUser(source.id);
  await store.reassignHolderUser(source.id, target.id);
  await store.reassignViews(source.id, target.id);
  res.json({ employee: toSelf(kept), retiredId: source.id });
}));

app.get('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  const view = employeeForAdmin(person, adminOf(req), await store.getCompany('default'));
  if (!person || person.kind !== 'employee' || !view) throw httpError(404, 'NOT_FOUND', '员工不存在');
  res.json({ employee: view });
}));

app.put('/api/employees/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee') throw httpError(404, 'NOT_FOUND', '员工不存在');
  const body = { ...(req.body || {}) };
  const cardId = text(body.cardId, 40);
  const admin = adminOf(req);
  const ready = ensureCards(person);
  const root = await store.getCompany('default');
  if (admin.scope === 'company') {
    if (!cardId) throw httpError(400, 'VALIDATION_ERROR', '请指定要修改的名片');
    const owned = ready.cards.find((card) => (
      card.id === cardId && canEditAdminCard(root, admin, card)
    ));
    if (!owned) throw httpError(403, 'FORBIDDEN', '只能管理本公司的名片');
    delete body.status;
    delete body.employeeNo;
    delete body.department;
  }
  const next = applyAdminFields(person, body);
  const targetCard = ready.cards.find((card) => card.id === cardId) || ready.cards.find((card) => card.isDefault);
  const touchesCard = ['name', 'company', 'title', 'phone', 'wechat', 'email', 'address']
    .some((key) => body[key] !== undefined);
  if (touchesCard && !targetCard) {
    throw httpError(409, 'NO_ACTIVE_CARD', '该员工没有可编辑名片，请先创建名片');
  }
  if (touchesCard && targetCard && targetCard.lifecycle !== 'active') {
    throw httpError(409, 'CARD_ARCHIVED', '已归档名片不能修改');
  }
  const requirePhone = touchesCard && (!targetCard || targetCard.isDefault || !cardId);
  if (requirePhone && !next.phone) throw httpError(400, 'VALIDATION_ERROR', '手机号不能为空');
  const fields = {
    name: next.name,
    company: next.company,
    title: next.title,
    phone: next.phone,
    wechat: next.wechat,
    email: next.email,
    address: next.address,
  };
  let stored = next;
  if (touchesCard) {
    stored = cardId ? writeCard(next, cardId, fields) : writeDefault(next, fields);
    if (!stored) throw httpError(404, 'NOT_FOUND', '名片不存在');
  }
  const saved = await store.updatePerson(person.id, stored);
  const visible = employeeForAdmin(saved, admin, root);
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
    const root = await store.getCompany('default');
    const mine = ready.cards.filter((card) => (
      canEditAdminCard(root, admin, card)
    ));
    if (!mine.length) throw httpError(404, 'NOT_FOUND', '员工不存在');
    const next = mine.reduce((value, card) => archiveCard(value, card.id), person);
    next.updatedAt = nowIso();
    await store.updatePerson(person.id, next);

    res.json({ ok: true });
    return;
  }
  await store.deleteApplicationsForPerson(person.id);
  if (store.deleteCertificationsForPerson) await store.deleteCertificationsForPerson(person.id);
  await store.deletePerson(person.id);
  res.json({ ok: true });
}));

// Certification is retired. Old clients cannot acquire permissions through it.
app.all(['/api/employee/certification', '/api/certifications', '/api/certifications/:id/:action'], (req, res) => {
  res.status(410).json({ error: { code: 'CERTIFICATION_REMOVED', message: '企业认证已取消，请联系管理员分配名片权限' } });
});

async function permissionCompanies(admin) {
  return (await managedCompanies()).filter((company) => admin.scope !== 'company' || company.id === admin.companyId);
}

app.get('/api/card-permission-policy', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const root = await store.getCompany('default');
  res.json({
    enabled: admin.scope === 'hq' && defaultPermissionEnabled(),
    policy: admin.scope === 'hq' ? (root.defaultCardPermission || { level: 1, companyIds: [] }) : null,
    companies: (await permissionCompanies(admin)).map(({ id, name }) => ({ id, name })),
  });
}));

app.put('/api/card-permission-policy', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (adminOf(req).scope !== 'hq') throw httpError(403, 'FORBIDDEN', '只有总管理员可以设置默认权限');
  if (!defaultPermissionEnabled()) throw httpError(403, 'DEFAULT_PERMISSION_DISABLED', '请先在配置文件开启默认名片权限策略');
  const policy = normalizePermission(req.body || {});
  await validatePermissionCompanies(policy);
  const root = await store.getCompany('default');
  await store.saveCompanyRecord('default', { ...root, defaultCardPermission: policy });
  res.json({ ok: true, policy });
}));

async function validatePermissionCompanies(permission) {
  const ids = new Set((await managedCompanies()).map((company) => company.id));
  if ((permission.companyIds || []).some((id) => !ids.has(id))) throw httpError(400, 'VALIDATION_ERROR', '授权企业不存在');
}

function permissionAccountVisible(person, admin) {
  return admin.scope === 'hq' || personRelatedToCompany(person, admin.companyId);
}

function permissionAccount(person, admin, root) {
  const permission = effectivePermission(person, root);
  const cards = ensureCards(person).cards.filter((card) => card.lifecycle === 'active'
    && (admin.scope === 'hq' || (card.companyId === admin.companyId && canViewAdminCard(root, admin, card))));
  const card = cards.find((item) => item.id === person.activeCardId) || cards[0];
  return {
    id: person.id,
    name: card ? card.name : (admin.scope === 'hq' ? person.name : ''),
    phone: person.authPhone || person.accountPhone || '',
    status: person.status,
    permission: admin.scope === 'hq' ? permission : {
      level: canManageCompany(permission, admin.companyId) ? 2 : 1,
      companyIds: canManageCompany(permission, admin.companyId) ? [admin.companyId] : [],
      source: permission.source,
    },
    individual: !!person.cardPermission,
    locked: admin.scope === 'company' && (!!person.cardPermission || permission.level === 3),
  };
}

app.get('/api/account-permissions', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const root = await store.getCompany('default');
  const people = await store.listPeople({ kind: 'employee' });
  const q = String(req.query.q || '').trim();
  const items = people.filter((person) => !isReviewEntryPerson(person) && permissionAccountVisible(person, admin))
    .map((person) => permissionAccount(person, admin, root))
    .filter((person) => !q || (person.name || '').includes(q) || person.phone.includes(q));
  res.json({ items });
}));

async function updateAccountPermission(person, admin, body) {
  const root = await store.getCompany('default');
  if (admin.scope === 'company' && effectivePermission(person, root).level === 3) {
    throw httpError(403, 'FORBIDDEN', '全企业权限只能由总管理员修改');
  }
  const next = setPermission(person, admin, body);
  if (next.cardPermission) await validatePermissionCompanies(next.cardPermission);
  next.updatedAt = nowIso();
  return next;
}

app.put('/api/account-permissions/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const person = await store.getPerson(req.params.id);
  if (!person || person.kind !== 'employee' || !permissionAccountVisible(person, admin)) {
    throw httpError(404, 'NOT_FOUND', '账号不存在');
  }
  const next = await updateAccountPermission(person, admin, req.body || {});
  await store.updatePerson(person.id, next);
  res.json({ ok: true });
}));

app.post('/api/account-permissions', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const admin = adminOf(req);
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  assertMobile(phone);
  let person = await findOccupyingPhone(store, phone);
  const exists = !!person;
  if (!person) person = blankPerson({ id: 'emp-' + crypto.randomBytes(6).toString('hex'), accountPhone: phone });
  const next = await updateAccountPermission(person, admin, body);
  if (exists) await store.updatePerson(person.id, next);
  else await store.insertPerson(next);
  res.json({ ok: true, id: next.id, merged: exists });
}));

app.get('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const employee = toSelf(user);
  const root = await store.getCompany('default');
  const permission = effectivePermission(user, root);
  employee.cards = employee.cards.filter((card) => card.lifecycle !== 'deleted').map((card) => ({
    ...card,
    canEdit: card.lifecycle === 'active' && canManageTemplate(permission, root, card.template),
    canDelete: canManageTemplate(permission, root, card.template),
  }));
  const company = employee.companyId ? await store.getCompany(employee.companyId) : null;
  const cardCompanies = {};
  await Promise.all((employee.cards || []).map(async (card) => {
    const cardCompany = card.companyId ? await store.getCompany(card.companyId) : null;
    cardCompanies[card.id] = cardCompany
      ? publicCompany(companyForTemplate(cardCompany, root, card.template))
      : null;
  }));
  res.json({
    employee,
    templateCompany: company ? publicCompany(companyForTemplate(company, root, employee.cardTemplate)) : null,
    cardCompanies,
    permission,
    reviewEntry: isReviewEntryPerson(user),
    canEdit: employee.cards.some((card) => card.id === employee.activeCardId && card.canEdit),
  });
}));

app.get('/api/employee/templates', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const root = await store.getCompany('default');
  const permission = effectivePermission(user, root);
  const companies = (await managedCompanies({ includeReviewEntry: isReviewEntryPerson(user) }))
    .filter((company) => canManageCompany(permission, company.id));
  const items = [];
  for (const template of allTemplates(root)) {
    const companyOptions = [];
    for (const company of companies) {
      if (permission.level !== 3 && !templateGrantedTo(root, template.id, company.id)) continue;
      companyOptions.push({
        companyId: company.id, companyName: company.name,
        company: publicCompany(companyForTemplate(company, root, template.id)),
      });
    }
    const preferred = companyOptions.find((option) => (template.companyIds || []).includes(option.companyId))
      || companyOptions[0];
    if (preferred) items.push({ id: template.id, name: template.name, ...preferred, companyOptions });
  }
  res.json({ items, permission });
}));

app.put('/api/employee/me', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const saved = await saveSelfCard(store, user, req.body || {});
  res.json({ employee: toSelf(saved) });
}));

app.post('/api/employee/cards', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const template = text(req.body && req.body.template, 20);
  const companyId = text(req.body && req.body.companyId, 40);
  if (!companyId) throw httpError(400, 'VALIDATION_ERROR', '请选择企业');
  const root = await store.getCompany('default');
  const selected = allTemplates(root).find((item) => item.id === template);
  if (!selected) throw httpError(400, 'VALIDATION_ERROR', '模板不存在');
  const permission = effectivePermission(user, root);
  assertManageCompany(permission, companyId);
  if (permission.level !== 3 && !templateGrantedTo(root, template, companyId)) {
    throw httpError(403, 'TEMPLATE_FORBIDDEN', '该企业未分配此模板');
  }

  const company = await store.getCompany(companyId);
  const reviewAllowed = isReviewEntryPerson(user) && isReviewEntryCompany(company);
  if (!reviewCompanyVisible(company) && !reviewAllowed) throw httpError(404, 'NOT_FOUND', '公司不存在');
  const cardOptions = {
    companyId,
    company: company.name,
    templateName: selected.name,
    source: 'employee_created',
  };
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
  const card = ensureCards(user).cards.find((item) => item.id === req.params.cardId && item.lifecycle !== 'deleted');
  if (!card) throw httpError(404, 'NOT_FOUND', '名片不存在');
  const root = await store.getCompany('default');
  assertManageTemplate(effectivePermission(user, root), root, card.template);
  let next;
  try {
    next = projectActive({ ...user, cards: user.cards.map((item) => item.id === card.id
      ? { ...item, lifecycle: 'deleted', deletedAt: nowIso() } : item) });
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
  const root = await store.getCompany('default');
  if (admin.scope === 'company' && !canEditAdminCard(root, admin, card)) {
    throw httpError(403, 'FORBIDDEN', '只能删除本公司的名片');
  }
  let next;
  try {
    next = admin.scope === 'company'
      ? archiveCard(person, req.params.cardId)
      : removeCard(person, req.params.cardId);
  } catch (err) {
    throw httpError(err.status || 400, err.code || 'VALIDATION_ERROR', err.message || '无法删除名片');
  }
  if (!next) throw httpError(404, 'NOT_FOUND', '名片不存在');
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(person.id, next);
  res.json({ employee: employeeForAdmin(saved, admin, root) });
}));

app.get('/api/cards/:id/qr', asyncRoute(async (req, res) => {
  const person = await store.getPerson(req.params.id);
  const shareCard = text(req.query.shareCard, 64);
  const state = publicCardState(person, shareCard);
  if (!state.ok) throw httpError(404, state.code, state.message);
  const pinnedId = state.card.id;
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
    const card = toCard(person);
    delete card.kind;
    delete card.status;
    res.json({ card, company: null, owned: true });
    return;
  }
  const card = publicCard(person, text(req.query.shareCard, 64));
  const root = await store.getCompany('default');
  const assignedCompany = card.companyId ? await store.getCompany(card.companyId) : null;
  const company = assignedCompany
    ? publicCompany(companyForTemplate(assignedCompany, root, card.cardTemplate))
    : null;
  res.json({ card, company, owned: false });
}));

app.post('/api/analytics/view', asyncRoute(async (req, res) => {
  const cardId = text(req.body && req.body.cardId, 64);
  const person = await store.getPerson(cardId);
  const shareCard = text(req.body && req.body.shareCard, 64);
  const state = publicCardState(person, shareCard);
  if (!state.ok) throw httpError(404, state.code, state.message);
  const viewer = req.user && req.user.kind === 'employee' ? req.user : null;
  const updateToken = crypto.randomBytes(16).toString('hex');
  const view = {
    id: 'view-' + crypto.randomBytes(6).toString('hex'),
    cardId,
    shareCardId: state.card.id,
    visitorId: text(req.body && req.body.visitorId, 64),
    visitorName: viewer ? text(viewer.name, 40) : '',
    visitorPhone: viewer ? text(viewer.phone, 20) : '',
    visitorTitle: viewer ? text(viewer.title, 40) : '',
    visitorCompany: viewer ? text(viewer.company, 80) : '',
    startedAt: nowIso(),
    durationSec: 0,
    exchange: null,
    updateTokenHash: viewUpdateTokenHash(updateToken),
  };
  await store.insertView(view);
  res.status(201).json({ viewId: view.id, updateToken });
}));

app.put('/api/analytics/view/:id', asyncRoute(async (req, res) => {
  const view = await store.getView(req.params.id);
  if (!view) throw httpError(404, 'NOT_FOUND', '浏览记录不存在');
  const updateToken = text(req.body && req.body.updateToken, 128);
  if (!updateToken || !view.updateTokenHash || !safeEqual(view.updateTokenHash, viewUpdateTokenHash(updateToken))) {
    throw httpError(403, 'FORBIDDEN', '浏览记录更新凭证无效');
  }
  const next = { ...view };
  if (req.body && req.body.durationSec != null) {
    const duration = Number(req.body.durationSec);
    if (!Number.isFinite(duration) || duration < 0 || duration > 60 * 60 * 12) {
      throw httpError(400, 'VALIDATION_ERROR', '停留时长不正确');
    }
    const startedAt = Date.parse(view.startedAt);
    const elapsedLimit = Number.isFinite(startedAt)
      ? Math.max(0, Math.ceil((Date.now() - startedAt) / 1000) + 30)
      : 0;
    next.durationSec = Math.max(
      Number(view.durationSec) || 0,
      Math.min(Math.round(duration), elapsedLimit),
    );
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
  let shareCardIds;
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    people = [req.user];
  } else {
    requireAdmin(req);
    const scope = await visibleCompanyScope(adminOf(req));
    people = (await store.listPeople({ kind: 'employee' })).filter((person) => !isReviewEntryPerson(person));
    if (scope) {
      people = scope.people;
      shareCardIds = scope.cardIds;
    }
    if (req.query.cardId) people = people.filter((person) => person.id === req.query.cardId);
  }
  const from = text(req.query.from, 10);
  const to = text(req.query.to, 10);
  const statsRows = await store.summarizeViews({
    cardIds: people.map((person) => person.id),
    shareCardIds,
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
  let scopedPeople;
  if (auth.role === 'employee') {
    if (!req.user || req.user.status !== 'active') throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
    if (cardId && cardId !== req.user.id) throw httpError(403, 'FORBIDDEN', '只能查看自己的名片数据');
    cardId = req.user.id;
  } else {
    requireAdmin(req);
    const scope = await visibleCompanyScope(adminOf(req));
    if (scope) {
      scopedPeople = scope.people;
      if (cardId && !scope.personIds.includes(cardId)) throw httpError(403, 'FORBIDDEN', '只能查看本公司的名片数据');
      if (!cardId) req.companyCardIds = scope.personIds;
      req.companyShareCardIds = scope.cardIds;
    } else {
      const visiblePeople = (await store.listPeople({ kind: 'employee' }))
        .filter((person) => !isReviewEntryPerson(person));
      const allowed = new Set(visiblePeople.map((person) => person.id));
      if (cardId === REVIEW_PERSON_ID) throw httpError(404, 'NOT_FOUND', '名片不存在');
      if (!cardId) req.companyCardIds = [...allowed];
    }
  }
  const { page, limit, offset } = parsePage(req.query);
  const from = text(req.query.from, 10);
  const to = text(req.query.to, 10);
  const pageResult = await store.listViewsPage({
    cardId: cardId || undefined,
    cardIds: req.companyCardIds,
    shareCardIds: req.companyShareCardIds,
    from: from || undefined,
    to: to || undefined,
    limit,
    offset,
  });
  const people = scopedPeople || await store.listPeople({ kind: 'employee' });
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
    if (cardId === REVIEW_PERSON_ID) throw httpError(404, 'NOT_FOUND', '名片不存在');
    const scope = await visibleCompanyScope(adminOf(req));
    if (scope && !scope.personIds.includes(cardId)) throw httpError(403, 'FORBIDDEN', '只能查看本公司的名片数据');
    req.companyShareCardIds = scope ? scope.cardIds : undefined;
  }
  const views = await store.listViews({ cardId, shareCardIds: req.companyShareCardIds });
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
  const fileType = validatedFileType(req.file.originalname, req.file.buffer);
  if (!fileType) throw httpError(400, 'UNSUPPORTED_FILE_TYPE', '文件内容与扩展名不匹配或格式不受支持');
  const filename = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + fileType.ext;
  if (config.storageDriver() === 'pg-oss') {
    const owner = String(req.auth.userId || 'admin').replace(/[^a-zA-Z0-9_-]/g, '');
    const key = 'uploads/' + owner + '/' + filename;
    const url = await store.putPublicObject(key, req.file.buffer, fileType.contentType);
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
  if (file.contentType === 'application/pdf') res.setHeader('Content-Disposition', 'attachment');
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
  if (!err.status || status >= 500 && !['OCR_NOT_CONFIGURED', 'WECHAT_NOT_CONFIGURED', 'SMS_NOT_CONFIGURED'].includes(err.code)) {
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
