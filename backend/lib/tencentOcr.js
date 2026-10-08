const crypto = require('crypto');
const { httpError } = require('./errors');

function assertOcrReady() {
  const provider = (process.env.OCR_PROVIDER || 'tencent').trim();
  if (provider !== 'tencent') {
    throw httpError(400, 'OCR_PROVIDER_INVALID', '仅支持腾讯云名片识别');
  }
  if (!(process.env.TENCENT_SECRET_ID || '').trim() || !(process.env.TENCENT_SECRET_KEY || '').trim()) {
    throw httpError(503, 'OCR_NOT_CONFIGURED', '识别未配置');
  }
}

function sha256hex(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

function hmac(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest();
}

function cleanPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const mobile = digits.match(/1\d{10}/);
  if (mobile) return mobile[0];
  return digits;
}

function cleanEmail(value) {
  let text = String(value || '').replace(/\s/g, '');
  const shape = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  if (!shape.test(text)) return '';
  const tlds = new Set(['cn', 'com', 'net', 'org', 'edu', 'gov', 'io', 'co', 'cc', 'hk', 'tw', 'jp', 'uk']);
  const label = (input) => input.split('.').pop().toLowerCase();
  while (shape.test(text) && !tlds.has(label(text)) && tlds.has(label(text.slice(0, -1)))) {
    text = text.slice(0, -1);
  }
  return text;
}

function cleanAddress(value) {
  return String(value || '').trim().replace(/([\u4e00-\u9fff0-9])[A-Za-z]$/, '$1');
}

function mapDraft(infos) {
  const grouped = {};
  for (const item of infos || []) {
    const name = item && item.Name;
    const value = String((item && item.Value) || '').trim();
    if (!name || !value) continue;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(value);
  }
  const first = (key) => (grouped[key] && grouped[key][0]) || '';
  const title = [first('部门'), first('职位')].filter(Boolean).join(' ');
  return {
    name: first('姓名') || first('英文姓名'),
    company: first('公司'),
    title,
    phone: cleanPhone(first('手机') || first('电话')),
    wechat: first('微信') || first('社交账号'),
    email: cleanEmail(first('邮箱')),
    address: cleanAddress(first('地址')),
    raw: infos || [],
  };
}

async function recognizeBusinessCard(imageBuffer) {
  assertOcrReady();
  const secretId = process.env.TENCENT_SECRET_ID.trim();
  const secretKey = process.env.TENCENT_SECRET_KEY.trim();
  const service = 'ocr';
  const host = 'ocr.tencentcloudapi.com';
  const action = 'BusinessCardOCR';
  const version = '2018-11-19';
  const region = (process.env.TENCENT_OCR_REGION || 'ap-guangzhou').trim();
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ ImageBase64: imageBuffer.toString('base64') });
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch('https://' + host, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
    },
    body: payload,
  });
  const data = await response.json();
  if (!data || !data.Response || data.Response.Error) {
    const message = data && data.Response && data.Response.Error
      ? data.Response.Error.Message
      : '名片识别失败';
    throw httpError(502, 'OCR_FAILED', message);
  }
  return mapDraft(data.Response.BusinessCardInfos);
}

module.exports = { assertOcrReady, recognizeBusinessCard, mapDraft, cleanPhone, cleanEmail, cleanAddress };
