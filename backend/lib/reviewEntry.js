const { blankPerson, nowIso, seedData } = require('./person');
const { BUILT_IN_TEMPLATES } = require('./templates');

const REVIEW_COMPANY_ID = 'wechat-review-demo';
const REVIEW_PERSON_ID = 'wechat-review-demo-user';
const REVIEW_CARD_ID = 'wechat-review-demo-card';

function isReviewEntryPerson(person) {
  return !!(person && person.reviewEntry === true && person.id === REVIEW_PERSON_ID);
}

function isReviewEntryCompany(company) {
  return !!(company && company.reviewEntry === true);
}

function reviewCompany(base) {
  return {
    ...base,
    name: '创大产控审核专用企业',
    nameEn: 'CHUANGDA REVIEW ACCOUNT COMPANY',
    shortName: '审核专用',
    brandEn: 'CHUANGDA REVIEW',
    slogan: '电子名片功能审核',
    intro: '仅用于审核人员验证电子名片功能，不包含真实员工数据。',
    website: '',
    address: '上海市浦东新区金桥红枫路288号',
    phone: '021-58886080',
    wechat: '',
    reviewOnly: true,
    reviewEntry: true,
  };
}

function reviewPerson() {
  const now = nowIso();
  return {
    ...blankPerson({
      id: REVIEW_PERSON_ID,
      kind: 'employee',
      name: '审核专员',
      company: '创大产控审核专用企业',
      title: '产品经理',
      phone: '13800000000',
      email: 'adim@wutgroup.cn',
      address: '上海市浦东新区金桥红枫路288号',
      cardTemplate: 'classic',
      activeCardId: REVIEW_CARD_ID,
      createdAt: now,
      updatedAt: now,
      cards: [{
        id: REVIEW_CARD_ID,
        template: 'classic',
        templateName: '创大产控模板',
        isDefault: true,
        name: '审核专员',
        company: '创大产控审核专用企业',
        title: '产品经理',
        phone: '13800000000',
        email: 'adim@wutgroup.cn',
        address: '上海市浦东新区金桥红枫路288号',
        companyId: REVIEW_COMPANY_ID,
        lifecycle: 'active',
        source: 'review_demo',
        attachments: [],
      }],
    }),
    reviewOnly: true,
    reviewEntry: true,
    cardPermission: { level: 2, companyIds: [REVIEW_COMPANY_ID] },
  };
}

async function grantReviewTemplates(store, root) {
  const grants = { ...((root && root.cardTemplateGrants) || {}) };
  let changed = false;
  for (const template of BUILT_IN_TEMPLATES) {
    const companyIds = Array.isArray(grants[template.id]) ? grants[template.id] : [];
    if (companyIds.includes(REVIEW_COMPANY_ID)) continue;
    grants[template.id] = companyIds.concat(REVIEW_COMPANY_ID);
    changed = true;
  }
  if (!changed) return root;
  const next = { ...root, cardTemplateGrants: grants };
  await store.saveCompanyRecord('default', next);
  return next;
}

async function resetReviewEntry(store) {
  const root = await store.getCompany('default');
  await grantReviewTemplates(store, root);
  await store.saveCompanyRecord(REVIEW_COMPANY_ID, reviewCompany(seedData().company));

  const ownedContacts = (await store.listPeople({ kind: 'ocr' }))
    .filter((person) => person.ownerId === REVIEW_PERSON_ID);
  for (const contact of ownedContacts) await store.deletePerson(contact.id);
  if (await store.getPerson(REVIEW_PERSON_ID)) await store.deletePerson(REVIEW_PERSON_ID);

  const person = reviewPerson();
  await store.insertPerson(person);
  return person;
}

module.exports = {
  REVIEW_COMPANY_ID,
  REVIEW_PERSON_ID,
  isReviewEntryPerson,
  isReviewEntryCompany,
  resetReviewEntry,
};
