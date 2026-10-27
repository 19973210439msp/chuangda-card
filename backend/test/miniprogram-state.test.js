const assert = require('node:assert/strict');
const test = require('node:test');
const { emptyCardState } = require('../../miniprogram/utils/card-home-state');
const {
  favoritePayload,
  sharedCardPath,
  holderCardPath,
  cardDetailRequest,
} = require('../../miniprogram/utils/favorite-flow');

test('zero-card home guides according to permissions without a certification entry', () => {
  assert.equal(emptyCardState({}).kind, 'ordinary');
  assert.equal(emptyCardState({}).action, '');
  assert.match(emptyCardState({}).description, /联系管理员/);
  assert.equal(emptyCardState({ permission: { level: 2 } }).kind, 'ordinary');
  const ready = emptyCardState({ templates: [{}, {}, {}], permission: { level: 2 } });
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

test('holder card flow keeps the exact card and authenticates owner-only OCR details', () => {
  assert.equal(
    holderCardPath('employee-1', 'card-2'),
    '/pages/client/card?cardId=employee-1&shareCard=card-2&from=holder',
  );
  assert.equal(
    holderCardPath('ocr-1', ''),
    '/pages/client/card?cardId=ocr-1&from=holder',
  );
  assert.deepEqual(cardDetailRequest('ocr-1', '', 'holder'), {
    url: '/api/cards/ocr-1',
    redirectOnAuth: false,
    auth: true,
  });
  assert.deepEqual(cardDetailRequest('employee-1', 'card-2', ''), {
    url: '/api/cards/employee-1?shareCard=card-2',
    redirectOnAuth: false,
    auth: false,
  });
});
