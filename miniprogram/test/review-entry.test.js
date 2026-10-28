const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

test('login page exposes a server-controlled review entry without embedding its code', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'pages/login/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/login/index.wxml'), 'utf8');

  assert.match(js, /reviewEntryEnabled/);
  assert.match(js, /api\/auth\/review-login/);
  assert.match(wxml, /wx:if="\{\{reviewEntryEnabled\}\}"/);
  assert.match(wxml, /微信审核体验/);
  assert.match(wxml, /审核码/);
  assert.doesNotMatch(js + wxml, /review-demo-code/);
});

test('review account hides account-changing actions from the mine page', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

  assert.match(js, /reviewEntry/);
  assert.match(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onPhone"/);
  assert.match(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onClose"/);
  assert.match(wxml, /微信审核体验/);
});
