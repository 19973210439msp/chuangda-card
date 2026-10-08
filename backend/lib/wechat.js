const config = require('../config');
const { httpError } = require('./errors');
const { normalizePhone } = require('./validate');

let cachedToken = { value: '', expiresAt: 0 };

function devOpenId(code) {
  if (code === 'skip') return 'dev-skip';
  if (typeof code === 'string' && code.startsWith('dev:')) {
    const id = code.slice(4).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!id) throw httpError(400, 'VALIDATION_ERROR', '测试身份无效');
    return 'dev-' + id;
  }
  return null;
}

async function openIdFromCode(code) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) throw httpError(400, 'VALIDATION_ERROR', '缺少微信登录 code');
  if (config.wechatSkipAllowed()) {
    const dev = devOpenId(raw);
    if (dev) return dev;
  }
  const appid = (process.env.WECHAT_APPID || '').trim();
  const secret = (process.env.WECHAT_SECRET || '').trim();
  if (!appid || !secret) {
    throw httpError(503, 'WECHAT_NOT_CONFIGURED', '微信登录未配置');
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', raw);
  url.searchParams.set('grant_type', 'authorization_code');
  const response = await fetch(url);
  const data = await response.json();
  if (!data || data.errcode || !data.openid) {
    throw httpError(401, 'WECHAT_AUTH_FAILED', (data && data.errmsg) || '微信授权失败');
  }
  return data.openid;
}

function wechatCredentials() {
  const appid = (process.env.WECHAT_APPID || '').trim();
  const secret = (process.env.WECHAT_SECRET || '').trim();
  if (!appid || !secret) {
    throw httpError(503, 'WECHAT_NOT_CONFIGURED', '微信登录未配置');
  }
  return { appid, secret };
}

function mainlandPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2);
  if (/^1\d{10}$/.test(digits)) return digits;
  return normalizePhone(value);
}

async function wechatAccessToken() {
  if (cachedToken.value && cachedToken.expiresAt > Date.now() + 60 * 1000) return cachedToken.value;
  const { appid, secret } = wechatCredentials();
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  const response = await fetch(url);
  const data = await response.json();
  if (!data || !data.access_token) {
    throw httpError(503, 'WECHAT_AUTH_FAILED', '微信手机号授权失败');
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
  };
  return cachedToken.value;
}

async function phoneFromWechatCode(phoneCode) {
  const raw = String(phoneCode || '').trim();
  if (!raw) return '';
  const token = await wechatAccessToken();
  const response = await fetch(
    'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(token),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: raw }),
    }
  );
  const data = await response.json();
  const info = data && data.phone_info;
  const phone = mainlandPhone(info && (info.purePhoneNumber || info.phoneNumber));
  if (!/^1\d{10}$/.test(phone)) {
    throw httpError(401, 'WECHAT_AUTH_FAILED', '微信手机号授权失败');
  }
  return phone;
}

module.exports = { openIdFromCode, devOpenId, phoneFromWechatCode };
