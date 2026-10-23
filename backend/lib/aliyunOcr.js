const { Readable } = require('node:stream');
const OcrApi = require('@alicloud/ocr-api20210707');
const OpenApi = require('@alicloud/openapi-client');
const TeaUtil = require('@alicloud/tea-util');
const { httpError } = require('./errors');

const CARD_KEYS = [
  '姓名',
  '公司',
  '部门',
  '职位',
  '手机',
  '电话',
  '邮箱',
  '微信',
  '地址',
];

function assertOcrReady() {
  const provider = (process.env.OCR_PROVIDER || 'aliyun').trim();
  if (provider !== 'aliyun') {
    throw httpError(400, 'OCR_PROVIDER_INVALID', '仅支持阿里云通用票证抽取');
  }
  if (!(process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || '').trim()
    || !(process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || '').trim()) {
    throw httpError(503, 'OCR_NOT_CONFIGURED', '识别未配置');
  }
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

function objectValue(value) {
  if (Array.isArray(value)) return value.map(objectValue).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return objectValue(value.value || value.text || value.content || '');
  }
  return String(value == null ? '' : value).trim();
}

function parseKvData(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseKvData(JSON.parse(value));
    } catch (error) {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeKvData(subImages) {
  const merged = {};
  for (const image of subImages || []) {
    const data = parseKvData(image && image.kvInfo && image.kvInfo.data);
    for (const [key, value] of Object.entries(data)) {
      const normalized = objectValue(value);
      if (normalized && !merged[key]) merged[key] = normalized;
    }
  }
  return merged;
}

function mapDraft(input) {
  const data = parseKvData(input);
  const first = (...keys) => {
    for (const key of keys) {
      const value = objectValue(data[key]);
      if (value) return value;
    }
    return '';
  };
  const title = [first('部门', '所属部门'), first('职位', '职务', '岗位')].filter(Boolean).join(' ');
  return {
    name: first('姓名', '名字', '英文姓名'),
    company: first('公司', '公司名称', '单位', '单位名称'),
    title,
    phone: cleanPhone(first('手机', '手机号码', '移动电话', '电话', '联系电话')),
    wechat: first('微信', '微信号', '社交账号'),
    email: cleanEmail(first('邮箱', '电子邮箱', '电子邮件', 'Email', 'E-mail')),
    address: cleanAddress(first('地址', '公司地址', '联系地址')),
    raw: data,
  };
}

function createClient() {
  const config = new OpenApi.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID.trim(),
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET.trim(),
    endpoint: (process.env.ALIYUN_OCR_ENDPOINT || 'ocr-api.cn-hangzhou.aliyuncs.com').trim(),
  });
  return new OcrApi.default(config);
}

async function recognizeBusinessCard(imageBuffer) {
  assertOcrReady();
  const request = new OcrApi.RecognizeGeneralStructureRequest({
    keys: CARD_KEYS,
    body: Readable.from([imageBuffer]),
  });
  const runtime = new TeaUtil.RuntimeOptions({
    connectTimeout: 5000,
    readTimeout: 35000,
  });

  try {
    const response = await createClient().recognizeGeneralStructureWithOptions(request, runtime);
    const body = response && response.body;
    if (!body || body.code) {
      console.error('[ocr] Aliyun rejected RecognizeGeneralStructure', {
        code: body && body.code,
        message: body && body.message,
        requestId: body && body.requestId,
      });
      throw httpError(502, 'OCR_FAILED', body && body.code === 'LLMTimeout'
        ? '识别超时，请减少图片背景后重试'
        : '名片识别失败，请稍后重试');
    }
    const data = mergeKvData(body.data && body.data.subImages);
    return mapDraft(data);
  } catch (error) {
    if (error && error.code === 'OCR_FAILED') throw error;
    console.error('[ocr] Aliyun RecognizeGeneralStructure request failed', {
      code: error && error.code,
      message: error && error.message,
    });
    throw httpError(502, 'OCR_FAILED', '名片识别失败，请稍后重试');
  }
}

module.exports = {
  CARD_KEYS,
  assertOcrReady,
  recognizeBusinessCard,
  mapDraft,
  mergeKvData,
  cleanPhone,
  cleanEmail,
  cleanAddress,
};
