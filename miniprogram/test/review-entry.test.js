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
  assert.match(wxml, /confirm-type="done"/);
  assert.match(wxml, /bindconfirm="onReviewLogin"/);
  assert.match(wxml, /disabled="\{\{loading \|\| !reviewCodeReady\}\}"/);
  assert.match(js, /setStorageSync\('reviewEntrySession', true\)/);
  assert.match(js, /removeStorageSync\('reviewEntrySession'\)/);
  assert.doesNotMatch(js + wxml, /review-demo-code/);
});

test('review account can switch to personal login but cannot close the demo account', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

  assert.match(js, /reviewEntry/);
  assert.match(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onPhone"/);
  assert.match(wxml, /wx:if="\{\{reviewEntry\}\}" bindtap="onSwitchAccount"/);
  assert.match(wxml, /bindtap="onClose"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onClose"/);
  assert.match(wxml, /微信审核体验/);
  assert.match(wxml, /切换账号/);
  assert.match(wxml, /注销账号/);
  assert.match(js, /onSwitchAccount\(\)/);
  assert.match(js, /api\/auth\/logout/);
  assert.match(js, /审核体验账号不允许注销/);
  assert.match(js, /removeStorageSync\('reviewEntrySession'\)/);
});

test('expired review sessions are removed when the server returns to formal mode', () => {
  const root = path.join(__dirname, '..');
  const login = fs.readFileSync(path.join(root, 'pages/login/index.js'), 'utf8');
  const request = fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8');

  assert.match(login, /getStorageSync\('reviewEntrySession'\)/);
  assert.match(login, /reviewEntryEnabled/);
  assert.match(login, /removeStorageSync\('reviewEntrySession'\)/);
  assert.match(request, /removeStorageSync\('reviewEntrySession'\)/);
});
