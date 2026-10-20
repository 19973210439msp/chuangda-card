const crypto = require('crypto');
const { httpError } = require('./errors');
const { text } = require('./validate');

const BUILT_IN_TEMPLATES = [
  { id: 'classic', name: '创大产控模板' },
  { id: 'horizon', name: '晴空模板' },
  { id: 'wave', name: '蓝韵模板' },
];

function listTemplates(company) {
  return Array.isArray(company && company.cardTemplates) ? company.cardTemplates : [];
}

function builtInCompanyIds(company, templateId) {
  const grants = company && company.cardTemplateGrants;
  const assigned = grants && Array.isArray(grants[templateId]) ? grants[templateId] : [];
  return Array.from(new Set(['default'].concat(assigned).filter(Boolean)));
}

function allTemplates(company) {
  const builtIns = BUILT_IN_TEMPLATES.map((item) => ({
    ...item,
    builtIn: true,
    companyIds: builtInCompanyIds(company, item.id),
  }));
  return builtIns.concat(listTemplates(company).map((item) => ({ ...item, builtIn: false })));
}

function visibleTemplates(company, admin) {
  const templates = allTemplates(company);
  if (!admin || admin.scope === 'hq') return templates;
  return templates.filter((item) => Array.isArray(item.companyIds) && item.companyIds.includes(admin.companyId));
}

function templateFor(company, id, admin) {
  return visibleTemplates(company, admin).find((item) => item.id === id) || null;
}

function templateGrantedTo(company, templateId, companyId) {
  if (!companyId) return false;
  const template = allTemplates(company).find((item) => item.id === templateId);
  return !!(template && Array.isArray(template.companyIds) && template.companyIds.includes(companyId));
}

function setBuiltInAssignments(company, templateId, companyIds) {
  if (!BUILT_IN_TEMPLATES.some((item) => item.id === templateId)) return null;
  const assigned = Array.from(new Set((companyIds || []).filter((id) => id && id !== 'default')));
  return {
    ...company,
    cardTemplateGrants: {
      ...((company && company.cardTemplateGrants) || {}),
      [templateId]: assigned,
    },
  };
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

module.exports = {
  BUILT_IN_TEMPLATES,
  listTemplates,
  allTemplates,
  visibleTemplates,
  templateFor,
  templateGrantedTo,
  setBuiltInAssignments,
  createTemplate,
  companyForTemplate,
};
