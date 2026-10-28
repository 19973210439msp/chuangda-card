const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sharedEntryPath } = require('../utils/favorite-flow');

test('a collected card hides the favorite action without rendering a saved notice', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../pages/client/card.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{canFavorite\}\}"/);
  assert.doesNotMatch(markup, /已收入名片夹|已收藏/);
});

test('a shared card opened on the login page goes straight to the card', () => {
  const path = sharedEntryPath({
    path: 'pages/login/index',
    scene: 1007,
    query: { cardId: 'emp-1', shareCard: 'card-9' },
  }, '');
  assert.equal(path, '/pages/client/card?cardId=emp-1&shareCard=card-9');
});

test('leaving the shared card for login still returns to that card', () => {
  const path = sharedEntryPath({
    path: 'pages/client/card',
    scene: 1007,
    query: { cardId: 'emp-1', shareCard: 'card-9' },
  }, '');
  assert.equal(path, '/pages/client/card?cardId=emp-1&shareCard=card-9');
});

test('saving a shared card still stays on the login page', () => {
  const path = sharedEntryPath({
    path: 'pages/client/card',
    scene: 1007,
    query: { cardId: 'emp-1' },
  }, 'emp-1');
  assert.equal(path, '');
});

test('opening the app normally does not skip login', () => {
  const path = sharedEntryPath({ path: 'pages/login/index', scene: 1001, query: { cardId: 'emp-1' } }, '');
  assert.equal(path, '');
});
