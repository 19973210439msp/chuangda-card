const assert = require('node:assert/strict');
const test = require('node:test');
const { emptyCardState } = require('../../miniprogram/utils/card-home-state');
const { favoritePayload, sharedCardPath } = require('../../miniprogram/utils/favorite-flow');

test('zero-card home guides the employee according to certification and templates', () => {
  assert.equal(emptyCardState({}).kind, 'uncertified');
  assert.equal(emptyCardState({ pending: [{}] }).kind, 'pending');
  assert.equal(emptyCardState({ certified: [{}] }).kind, 'waiting-template');
  const ready = emptyCardState({ certified: [{}], templates: [{}, {}, {}] });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.action, '创建名片');
  assert.match(ready.description, /3 套可用模板/);
  assert.equal(emptyCardState({ hasCard: true }).visible, false);
});

test('favorite flow preserves the exact shared card and only reports a confirmed save', () => {
  assert.deepEqual(favoritePayload('employee-1', 'card-2'), {
    cardId: 'employee-1',
    shareCardId: 'card-2',
  });
  assert.equal(
    sharedCardPath('employee-1', 'card-2', true),
    '/pages/client/card?cardId=employee-1&shareCard=card-2&collected=1',
  );
  assert.equal(
    sharedCardPath('employee-1', 'card-2', false),
    '/pages/client/card?cardId=employee-1&shareCard=card-2',
  );
});
