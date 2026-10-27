const test = require('node:test');
const assert = require('node:assert/strict');
const { effectivePermission, canManageCompany, setPermission } = require('../lib/cardPermissions');

test('default policy covers every account and the flag disables only defaults', () => {
  const root = { defaultCardPermission: { level: 3, companyIds: [] } };
  for (const source of ['mini_program', 'admin', 'import', undefined]) {
    assert.equal(effectivePermission({ source }, root, true).level, 3);
    assert.equal(effectivePermission({ source }, root, false).level, 1);
  }
  const explicit = { cardPermission: { level: 1, companyIds: [] } };
  assert.equal(effectivePermission(explicit, root, true).level, 1);
  assert.equal(effectivePermission({ cardPermission: { level: 3 } }, root, false).level, 3);
});

test('company permissions remain isolated and never grant a backend role', () => {
  const person = setPermission({}, { scope: 'company', companyId: 'a' }, { level: 2 });
  const both = setPermission(person, { scope: 'company', companyId: 'b' }, { level: 2 });
  const permission = effectivePermission(both, {}, false);
  assert.equal(canManageCompany(permission, 'a'), true);
  assert.equal(canManageCompany(permission, 'b'), true);
  assert.equal(canManageCompany(permission, 'c'), false);
  assert.equal(both.scope, undefined);
  const demoted = setPermission(both, { scope: 'company', companyId: 'a' }, { level: 1 });
  assert.equal(canManageCompany(effectivePermission(demoted, {}, false), 'a'), false);
  assert.equal(canManageCompany(effectivePermission(demoted, {}, false), 'b'), true);
  assert.throws(() => setPermission(person, { scope: 'company', companyId: 'a' }, { level: 3 }));
  assert.throws(() => setPermission(person, { scope: 'company', companyId: 'a' }, { level: 2, companyIds: ['b'] }));
});

test('explicit ordinary permission survives default upgrades and reset follows defaults', () => {
  const root = { defaultCardPermission: { level: 3 } };
  const person = setPermission({}, { scope: 'hq' }, { level: 1 });
  assert.equal(effectivePermission(person, root, true).level, 1);
  assert.throws(() => setPermission(person, { scope: 'company', companyId: 'a' }, { level: 2 }));
  const reset = setPermission(person, { scope: 'hq' }, { level: null });
  assert.equal(effectivePermission(reset, root, true).level, 3);
});
