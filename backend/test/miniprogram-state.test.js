const assert = require('node:assert/strict');
const test = require('node:test');
const { emptyCardState } = require('../../miniprogram/utils/card-home-state');

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
