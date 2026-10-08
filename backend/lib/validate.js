const { httpError } = require('./errors');

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizePhone(value) {
  return String(value == null ? '' : value).replace(/[\s-]/g, '').trim();
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function assertMobile(phone) {
  if (!/^1\d{10}$/.test(phone)) {
    throw httpError(400, 'VALIDATION_ERROR', '请输入 11 位中国大陆手机号');
  }
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'VALIDATION_ERROR', '邮箱格式不正确');
  }
}

function assertHexColor(value, label) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw httpError(400, 'VALIDATION_ERROR', label + '需为 #RRGGBB');
  }
}

function normalizeAttachments(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw httpError(400, 'VALIDATION_ERROR', '附件格式不正确');
  if (list.length > 8) throw httpError(400, 'VALIDATION_ERROR', '附件最多 8 个');
  return list.map((item) => {
    const name = text(item && item.name, 80);
    const url = text(item && item.url, 500);
    if (!name || !url) throw httpError(400, 'VALIDATION_ERROR', '附件需要名称和地址');
    return { name, url };
  });
}

module.exports = {
  text,
  normalizePhone,
  normalizeEmail,
  assertMobile,
  assertEmail,
  assertHexColor,
  normalizeAttachments,
};
