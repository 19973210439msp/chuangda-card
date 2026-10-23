const { hashPassword } = require('./access');
const config = require('../config');
const { archiveCompanyCards } = require('./cards');
const { listCertifications, saveCertification } = require('./certifications');
const { nowIso } = require('./person');

const REVIEW_COMPANY_ID = 'review-test';
const REVIEW_ADMIN_USERNAME = '123csmp';
const REVIEW_ADMIN_PASSWORD = '123csmp';
const BUILT_IN_TEMPLATE_IDS = ['classic', 'horizon', 'wave'];

const reviewTestMode = config.reviewTestMode;

function reviewCompanyVisible(company) {
  return !!company && (!company.reviewOnly || reviewTestMode());
}

function isReviewCompany(companyId) {
  return reviewTestMode() && companyId === REVIEW_COMPANY_ID;
}

function stripCertificationCode(company) {
  if (!company || !Object.prototype.hasOwnProperty.call(company, 'certCode')) return company;
  const { certCode, ...rest } = company;
  return rest;
}

async function cleanStoredCertificationCodes(store) {
  const companies = await store.listCompanies();
  for (const company of companies) {
    if (!Object.prototype.hasOwnProperty.call(company, 'certCode')) continue;
    const { id, certCode, ...rest } = company;
    await store.saveCompanyRecord(id, rest);
  }
}

async function syncTemplateAssignments(store, enabled) {
  const root = await store.getCompany('default');
  if (!root) return;
  const grants = { ...(root.cardTemplateGrants || {}) };
  for (const templateId of BUILT_IN_TEMPLATE_IDS) {
    const companyIds = Array.isArray(grants[templateId]) ? grants[templateId] : [];
    grants[templateId] = Array.from(new Set(companyIds
      .filter((id) => id && id !== REVIEW_COMPANY_ID)
      .concat(enabled ? [REVIEW_COMPANY_ID] : [])));
  }
  await store.saveCompanyRecord('default', { ...stripCertificationCode(root), cardTemplateGrants: grants });
}

async function deactivateReviewData(store) {
  const certifications = await listCertifications(store);
  for (const row of certifications) {
    if (row.companyId !== REVIEW_COMPANY_ID || !['pending', 'approved'].includes(row.status)) continue;
    await saveCertification(store, { ...row, status: 'revoked' });
  }
  const people = await store.listPeople({ kind: 'employee' });
  for (const person of people) {
    const hasReviewCard = (person.cards || []).some((card) => (
      card.companyId === REVIEW_COMPANY_ID && card.lifecycle === 'active'
    ));
    if (!hasReviewCard) continue;
    const next = archiveCompanyCards(person, REVIEW_COMPANY_ID);
    next.updatedAt = nowIso();
    await store.updatePerson(person.id, next);
  }
}

async function syncReviewTestEnvironment(store, baseCompany) {
  await cleanStoredCertificationCodes(store);
  const enabled = reviewTestMode();
  await syncTemplateAssignments(store, enabled);
  if (!enabled) {
    await deactivateReviewData(store);
    return;
  }

  const existingCompany = await store.getCompany(REVIEW_COMPANY_ID);
  await store.saveCompanyRecord(REVIEW_COMPANY_ID, {
    ...(existingCompany || baseCompany),
    name: '测试认证企业',
    shortName: '测试认证',
    reviewOnly: true,
  });

  const existingAdmin = await store.findAdminByUsername(REVIEW_ADMIN_USERNAME);
  await store.saveAdmin({
    id: existingAdmin ? existingAdmin.id : 'admin-review-test',
    username: REVIEW_ADMIN_USERNAME,
    passwordHash: hashPassword(REVIEW_ADMIN_PASSWORD),
    companyId: REVIEW_COMPANY_ID,
    scope: 'company',
    reviewOnly: true,
  });
}

module.exports = {
  REVIEW_COMPANY_ID,
  reviewTestMode,
  reviewCompanyVisible,
  isReviewCompany,
  stripCertificationCode,
  syncReviewTestEnvironment,
};
