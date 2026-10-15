const { httpError } = require('./errors');
const { findOccupyingPhone } = require('./identity');
const { nowIso } = require('./person');

function shellIsBlank(person) {
  if (!person) return true;
  const attachments = Array.isArray(person.attachments) ? person.attachments : [];
  return !person.name && !person.email && !person.wechat && !person.title
    && !attachments.length;
}

async function claimImportedCard(store, { phone, openid, shell, sessionToken }) {
  const found = await findOccupyingPhone(store, phone);
  if (!found || (shell && found.id === shell.id)) return null;
  if (found.openid && found.openid !== openid) {
    throw httpError(409, 'PHONE_EXISTS', '该手机号已绑定另一名已注册员工');
  }
  const saved = await store.updatePerson(found.id, {
    ...found,
    openid,
    updatedAt: nowIso(),
  });
  if (shell && shell.id !== found.id) {
    await store.reassignHolderUser(shell.id, found.id);
    await store.reassignViews(shell.id, found.id);
    if (sessionToken) await store.reassignSessionUser(sessionToken, found.id);
    await store.deleteSessionsForUser(shell.id);
    if (shellIsBlank(shell)) {
      await store.deletePerson(shell.id);
    } else {
      await store.updatePerson(shell.id, {
        ...shell,
        openid: '',
        status: 'disabled',
        updatedAt: nowIso(),
      });
    }
  }
  return { employee: saved, claimed: true };
}

module.exports = { claimImportedCard };
