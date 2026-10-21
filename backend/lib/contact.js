const crypto = require('crypto');
const { httpError } = require('./errors');
const { assertPhoneAvailable, findOccupyingPhone } = require('./identity');
const { claimImportedCard } = require('./claim');
const { blankPerson, nowIso } = require('./person');
const { consumeCode } = require('./verify');
const { phoneFromWechatCode } = require('./wechat');
const { writeActive, assignCardCompany, ensureCards } = require('./cards');
const { approvedCompanyIds } = require('./certifications');
const { templateGrantedTo } = require('./templates');
const {
  text,
  normalizePhone,
  normalizeEmail,
  assertMobile,
  assertEmail,
  normalizeAttachments,
} = require('./validate');

function dropWechatQr(list) {
  return (list || []).filter((item) => !item || item.name !== '微信二维码');
}

async function saveSelfCard(store, person, body) {
  const next = { ...person, attachments: Array.isArray(person.attachments) ? person.attachments.slice() : [] };
  if (body.name !== undefined) next.name = text(body.name, 40);
  if (body.company !== undefined) next.company = text(body.company, 80);
  if (body.title !== undefined) next.title = text(body.title, 40);
  if (body.wechat !== undefined) next.wechat = text(body.wechat, 40);
  if (body.address !== undefined) next.address = text(body.address, 120);
  if (body.attachments !== undefined) next.attachments = dropWechatQr(normalizeAttachments(body.attachments));
  delete next.avatar;
  delete next.portrait;

  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    if (phone) assertMobile(phone);
    next.phone = phone;
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (email !== person.email) {
      if (email) assertEmail(email);
      next.email = email;
    }
  }
  next.updatedAt = nowIso();
  let synced = writeActive(next, {
    name: next.name,
    company: next.company,
    title: next.title,
    phone: next.phone,
    wechat: next.wechat,
    email: next.email,
    address: next.address,
    attachments: next.attachments,
  });
  if (body.companyId !== undefined) {
    const wanted = String(body.companyId || '');
    const ready = ensureCards(person);
    const active = ready.cards.find((card) => card.id === ready.activeCardId) || ready.cards[0];
    if (!active) throw httpError(409, 'NO_ACTIVE_CARD', '请先通过企业认证并创建名片');
    if (!wanted) throw httpError(400, 'VALIDATION_ERROR', '请选择已认证企业');
    const owned = String(active.companyId || '');
    const allowed = await approvedCompanyIds(store, person.id);
    if (owned) allowed.add(owned);
    if (!allowed.has(wanted)) {
      throw httpError(403, 'FORBIDDEN', '只能选择已认证企业');
    }
    const root = await store.getCompany('default');
    if (!templateGrantedTo(root, active.template, wanted)) {
      throw httpError(403, 'TEMPLATE_FORBIDDEN', '该企业未获得这套名片模板');
    }
    const company = await store.getCompany(wanted);
    if (!company) throw httpError(404, 'NOT_FOUND', '企业不存在');
    const assigned = assignCardCompany(synced, synced.activeCardId, wanted, company.name || '');
    if (assigned) synced = assigned;
  }
  synced.updatedAt = next.updatedAt;
  return store.updatePerson(person.id, synced);
}

async function resolveChangePhone(body) {
  const wechatCode = text(body && body.phoneCode, 256);
  const smsCode = text(body && body.code, 16);
  const typed = normalizePhone(body && body.phone);

  // 优先微信手机号授权；短信仅保留给自动化测试兼容
  if (wechatCode && !smsCode) {
    return phoneFromWechatCode(wechatCode);
  }
  if (typed && smsCode) {
    assertMobile(typed);
    return typed;
  }
  throw httpError(400, 'VALIDATION_ERROR', '请通过微信授权手机号');
}

async function changePhone(store, person, body, sessionToken) {
  const phone = await resolveChangePhone(body || {});
  const currentAccount = person.authPhone || person.phone;
  if (phone === currentAccount) throw httpError(400, 'VALIDATION_ERROR', '与当前手机号相同');

  const smsCode = text(body && body.code, 16);
  if (smsCode) {
    await consumeCode(store, { userId: person.id, channel: 'sms', target: phone, code: smsCode });
    return openPhoneAccount(store, person, phone, sessionToken);
  }

  const claimed = await claimImportedCard(store, {
    phone,
    openid: person.openid,
    shell: person,
    sessionToken,
  });
  if (claimed) return claimed;
  await assertPhoneAvailable(store, phone, person.id);
  const next = writeActive({ ...person, phone, authPhone: phone, updatedAt: nowIso() }, {
    name: person.name,
    company: person.company,
    title: person.title,
    phone,
    wechat: person.wechat,
    email: person.email,
    address: person.address,
    attachments: person.attachments,
  });
  next.updatedAt = nowIso();
  const saved = await store.updatePerson(person.id, next);
  return { employee: saved, claimed: false };
}

async function rememberOpenAccount(store, openid, personId) {
  if (!openid || !personId) return null;
  return store.saveAccountLink({ openid, personId, updatedAt: nowIso() });
}

async function listLinkedAccounts(store, person) {
  const openid = person.openid || '';
  const links = openid ? await store.listAccountLinks(openid) : [];
  const ids = new Set(links.map((item) => item.personId));
  ids.add(person.id);
  const items = [];
  for (const id of ids) {
    const row = await store.getPerson(id);
    if (!row || row.kind !== 'employee' || row.status !== 'active') continue;
    items.push({
      id: row.id,
      name: row.name || '',
      phone: row.authPhone || row.phone || '',
      current: row.id === person.id,
    });
  }
  return items;
}

async function switchLinkedAccount(store, person, personId, sessionToken) {
  const openid = person.openid || '';
  if (!openid) throw httpError(403, 'FORBIDDEN', '当前微信还没有绑定账号');
  const links = await store.listAccountLinks(openid);
  const allowed = new Set(links.map((item) => item.personId));
  allowed.add(person.id);
  if (!allowed.has(personId)) throw httpError(403, 'FORBIDDEN', '只能切换曾经验证过的账号');
  if (personId === person.id) return { employee: person };
  const target = await store.getPerson(personId);
  if (!target || target.kind !== 'employee' || target.status !== 'active') {
    throw httpError(404, 'NOT_FOUND', '账号不存在');
  }
  await store.updatePerson(person.id, { ...person, openid: '', updatedAt: nowIso() });
  const saved = await store.updatePerson(target.id, { ...target, openid, updatedAt: nowIso() });
  if (sessionToken) await store.reassignSessionUser(sessionToken, target.id);
  await rememberOpenAccount(store, openid, person.id);
  await rememberOpenAccount(store, openid, saved.id);
  return { employee: saved };
}

async function openPhoneAccount(store, person, phone, sessionToken) {
  const openid = person.openid || '';
  await rememberOpenAccount(store, openid, person.id);
  const found = await findOccupyingPhone(store, phone);
  if (found && found.id !== person.id && found.openid && found.openid !== openid) {
    if (found.status !== 'active') {
      throw httpError(409, 'PHONE_EXISTS', '该手机号已绑定另一名已注册员工');
    }
    await store.updatePerson(person.id, {
      ...person,
      openid: '',
      updatedAt: nowIso(),
    });
    const saved = await store.updatePerson(found.id, {
      ...found,
      openid,
      authPhone: phone,
      updatedAt: nowIso(),
    });
    if (sessionToken) await store.reassignSessionUser(sessionToken, saved.id);
    await rememberOpenAccount(store, openid, saved.id);
    return { employee: saved, claimed: true, loggedIn: true };
  }
  const claimed = await claimImportedCard(store, {
    phone,
    openid: person.openid,
    shell: person,
    sessionToken,
  });
  if (claimed) {
    const saved = await store.updatePerson(claimed.employee.id, {
      ...claimed.employee,
      authPhone: phone,
      updatedAt: nowIso(),
    });
    await rememberOpenAccount(store, openid, saved.id);
    return { employee: saved, claimed: true };
  }
  await assertPhoneAvailable(store, phone, person.id);
  const fresh = blankPerson({
    id: 'emp-' + crypto.randomBytes(4).toString('hex'),
    kind: 'employee',
    openid: person.openid || '',
    phone,
    authPhone: phone,
    cards: [],
    activeCardId: '',
  });
  await store.insertPerson(fresh);
  if (sessionToken) await store.reassignSessionUser(sessionToken, fresh.id);
  await store.updatePerson(person.id, {
    ...person,
    openid: '',
    updatedAt: nowIso(),
  });
  await rememberOpenAccount(store, openid, fresh.id);
  return { employee: fresh, claimed: false };
}

async function closeAccount(store, person) {
  const next = { ...person, status: 'closed', updatedAt: nowIso() };
  await store.updatePerson(person.id, next);
  await store.deleteSessionsForUser(person.id);
  return next;
}

module.exports = {
  saveSelfCard,
  changePhone,
  closeAccount,
  rememberOpenAccount,
  listLinkedAccounts,
  switchLinkedAccount,
};
