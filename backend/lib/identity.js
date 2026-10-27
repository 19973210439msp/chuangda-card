const { httpError } = require('./errors');
const { normalizePhone } = require('./validate');
const { identityPhone } = require('./cards');

async function findOccupyingPhone(store, phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  const people = await store.listPeople({ kind: 'employee' });
  const matches = people.filter((person) => person.status !== 'closed' && normalizePhone(identityPhone(person)) === target);
  if (matches.length > 1) throw httpError(409, 'PHONE_CONFLICT', '该手机号对应多个账号，请联系总管理员处理');
  return matches[0] || null;
}

async function assertPhoneAvailable(store, phone, exceptId) {
  const found = await findOccupyingPhone(store, phone);
  if (found && found.id !== exceptId) {
    const who = found.employeeNo ? '工号 ' + found.employeeNo : '另一名已注册员工';
    throw httpError(409, 'PHONE_EXISTS', '该手机号已绑定' + who);
  }
}

module.exports = { findOccupyingPhone, assertPhoneAvailable };
