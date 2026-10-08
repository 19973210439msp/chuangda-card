const { httpError } = require('./errors');
const { normalizePhone } = require('./validate');

async function findOccupyingPhone(store, phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  const people = await store.listPeople({ kind: 'employee' });
  return people.find((person) => person.status !== 'closed' && normalizePhone(person.phone) === target) || null;
}

async function assertPhoneAvailable(store, phone, exceptId) {
  const found = await findOccupyingPhone(store, phone);
  if (found && found.id !== exceptId) {
    const who = found.employeeNo ? '工号 ' + found.employeeNo : '另一名已注册员工';
    throw httpError(409, 'PHONE_EXISTS', '该手机号已绑定' + who);
  }
}

module.exports = { findOccupyingPhone, assertPhoneAvailable };
