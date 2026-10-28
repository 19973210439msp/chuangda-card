const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

test('login page exposes a server-controlled review entry without embedding its code', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'pages/login/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/login/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/login/index.wxss'), 'utf8');

  assert.match(js, /reviewEntryEnabled/);
  assert.match(js, /wechatSkip:\s*false/);
  assert.match(js, /api\/auth\/review-login/);
  assert.match(wxml, /wx:if="\{\{reviewEntryEnabled\}\}"/);
  assert.match(wxml, /手机号快捷登录/);
  assert.match(wxml, /审核人员登录/);
  assert.match(wxml, /登录审核账号/);
  assert.doesNotMatch(wxml, /微信授权手机号登录|微信审核体验|进入审核体验|演示账号/);
  assert.match(wxml, /审核码/);
  assert.match(wxml, /confirm-type="done"/);
  assert.match(wxml, /bindconfirm="onReviewLogin"/);
  assert.match(wxml, /disabled="\{\{loading \|\| !reviewCodeReady\}\}"/);
  assert.match(wxml, /class="review-toggle" wx:if="\{\{!reviewOpen\}\}"/);
  assert.match(wxml, /class="review-title" wx:else>审核人员登录<\/text>/);
  assert.match(wxss, /\.review-submit\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*100%;[^}]*box-sizing:\s*border-box;/s);
  assert.match(js, /setStorageSync\('reviewEntrySession', true\)/);
  assert.match(js, /removeStorageSync\('reviewEntrySession'\)/);
  assert.doesNotMatch(js + wxml, /review-demo-code/);
  assert.equal(fs.existsSync(path.join(root, 'assets/icons/wechat-action.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'assets/icons/wechat.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'assets/wechat-logo.jpg')), false);
});

test('review account can switch to personal login but cannot close the dedicated account', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');

  assert.match(js, /reviewEntry/);
  assert.match(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onPhone"/);
  assert.match(wxml, /wx:if="\{\{reviewEntry\}\}" bindtap="onSwitchAccount"/);
  assert.match(wxml, /bindtap="onClose"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{!reviewEntry\}\}" bindtap="onClose"/);
  assert.match(wxml, /审核专用账号/);
  assert.match(wxml, /切换账号/);
  assert.match(wxml, /注销账号/);
  assert.match(js, /onSwitchAccount\(\)/);
  assert.match(js, /api\/auth\/logout/);
  assert.match(js, /审核专用账号不允许注销/);
  assert.doesNotMatch(js + wxml + home, /微信授权手机号登录|微信审核体验/);
  assert.match(home, /手机号快捷登录/);
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
