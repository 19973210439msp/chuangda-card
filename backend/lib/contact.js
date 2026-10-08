const { httpError } = require('./errors');
const { assertPhoneAvailable, findOccupyingPhone } = require('./identity');
const { claimImportedCard } = require('./claim');
const { nowIso } = require('./person');
const { consumeCode } = require('./verify');
const {
  text,
  normalizePhone,
  normalizeEmail,
  assertMobile,
  assertEmail,
  normalizeAttachments,
} = require('./validate');

function keepLatestWechatQr(list) {
  const rest = [];
  let latest = null;
  for (const item of list) {
    if (item && item.name === '微信二维码') latest = item;
    else rest.push(item);
  }
  return latest ? rest.concat(latest) : rest;
}

async function saveSelfCard(store, person, body) {
  const next = { ...person, attachments: Array.isArray(person.attachments) ? person.attachments.slice() : [] };
  if (body.name !== undefined) next.name = text(body.name, 40);
  if (body.company !== undefined) next.company = text(body.company, 80);
  if (body.title !== undefined) next.title = text(body.title, 40);
  if (body.wechat !== undefined) next.wechat = text(body.wechat, 40);
  if (body.address !== undefined) next.address = text(body.address, 120);
  if (body.avatar !== undefined) next.avatar = text(body.avatar, 500);
  if (body.portrait !== undefined) next.portrait = text(body.portrait, 500);
  if (body.attachments !== undefined) next.attachments = keepLatestWechatQr(normalizeAttachments(body.attachments));

  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    if (phone !== person.phone) {
      assertMobile(phone);
      await consumeCode(store, { userId: person.id, channel: 'sms', target: phone, code: body.phoneCode });
      const occupying = await findOccupyingPhone(store, phone);
      if (occupying && occupying.id !== person.id && !occupying.openid) {
        throw httpError(409, 'PHONE_EXISTS', '该手机号已有导入名片，请到「我的」绑定手机号领取');
      }
      await assertPhoneAvailable(store, phone, person.id);
      next.phone = phone;
    }
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (email !== person.email) {
      assertEmail(email);
      await consumeCode(store, { userId: person.id, channel: 'email', target: email, code: body.emailCode });
      next.email = email;
    }
  }
  next.updatedAt = nowIso();
  return store.updatePerson(person.id, next);
}

async function changePhone(store, person, body, sessionToken) {
  const phone = normalizePhone(body && body.phone);
  assertMobile(phone);
  if (phone === person.phone) throw httpError(400, 'VALIDATION_ERROR', '与当前手机号相同');
  await consumeCode(store, { userId: person.id, channel: 'sms', target: phone, code: body && body.code });
  const claimed = await claimImportedCard(store, {
    phone,
    openid: person.openid,
    shell: person,
    sessionToken,
  });
  if (claimed) return claimed;
  await assertPhoneAvailable(store, phone, person.id);
  const next = { ...person, phone, updatedAt: nowIso() };
  const saved = await store.updatePerson(person.id, next);
  return { employee: saved, claimed: false };
}

async function changeEmail(store, person, body) {
  const email = normalizeEmail(body && body.email);
  assertEmail(email);
  if (email === person.email) throw httpError(400, 'VALIDATION_ERROR', '与当前邮箱相同');
  await consumeCode(store, { userId: person.id, channel: 'email', target: email, code: body && body.code });
  const next = { ...person, email, updatedAt: nowIso() };
  return store.updatePerson(person.id, next);
}

async function closeAccount(store, person) {
  const next = { ...person, status: 'closed', updatedAt: nowIso() };
  await store.updatePerson(person.id, next);
  await store.deleteSessionsForUser(person.id);
  return next;
}

module.exports = { saveSelfCard, changePhone, changeEmail, closeAccount };
