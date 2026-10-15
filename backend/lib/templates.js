const crypto = require('crypto');
const { httpError } = require('./errors');
const { text } = require('./validate');

function listTemplates(company) {
  return Array.isArray(company && company.cardTemplates) ? company.cardTemplates : [];
}

function visibleTemplates(company, admin) {
  const templates = listTemplates(company);
  if (!admin || admin.scope === 'hq') return templates;
  return templates.filter((item) => Array.isArray(item.companyIds) && item.companyIds.includes(admin.companyId));
}

function templateFor(company, id, admin) {
  if (id === 'classic') return { id: 'classic', name: '创大产控模板' };
  return visibleTemplates(company, admin).find((item) => item.id === id) || null;
}

function createTemplate(input, base) {
  const name = text(input && input.name, 40);
  if (!name) throw httpError(400, 'VALIDATION_ERROR', '请填写模板名称');
  const qrUrl = text(input && input.qrUrl, 500);
  if (qrUrl && !/^\/uploads\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/.test(qrUrl) && !/^https:\/\/[^\s]+$/i.test(qrUrl)) {
    throw httpError(400, 'VALIDATION_ERROR', '二维码需使用上传图片地址或 HTTPS 图片地址');
  }
  return {
    id: 'tpl-' + crypto.randomBytes(4).toString('hex'),
    name,
    companyName: text(input && input.companyName, 160) || base.name,
    companyNameEn: text(input && input.companyNameEn, 160) || base.nameEn,
    shortName: text(input && input.shortName, 40) || base.shortName,
    shortNameEn: text(input && input.shortNameEn, 80) || base.brandEn,
    qrUrl,
    companyIds: Array.isArray(input && input.companyIds) ? input.companyIds.map((id) => text(id, 40)).filter(Boolean) : [],
  };
}

function companyForTemplate(company, root, templateId) {
  const template = listTemplates(root).find((item) => item.id === templateId);
  if (!template) return company;
  return {
    ...company,
    name: template.companyName,
    nameEn: template.companyNameEn,
    shortName: template.shortName,
    brandEn: template.shortNameEn,
    qrUrl: template.qrUrl || '/official-qr.jpg',
  };
}

module.exports = { listTemplates, visibleTemplates, templateFor, createTemplate, companyForTemplate };
