const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadPage(file, request = async () => ({})) {
  let page;
  const navigation = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages/home', file), 'utf8'), {
    require(name) {
      if (name.endsWith('/request')) return { request };
      if (name.endsWith('/guard')) return { ensureLogin: () => true };
      if (name.endsWith('/template-options')) return require('../utils/template-options');
      if (name.endsWith('/card-home-state')) return { emptyCardState: () => ({}) };
      if (name.endsWith('/api-base')) return {};
      return { decorateCompany: (value) => value, decorateCard: (value) => value, pageScrollHeight: () => 600 };
    },
    Page(value) { page = value; },
    wx: {
      redirectTo: (options) => navigation.push(options.url),
      navigateTo: (options) => navigation.push(options.url),
      navigateBack: () => {},
      showToast: () => {},
    },
  });
  page.data = { ...page.data };
  page.setData = (value) => {
    for (const [key, field] of Object.entries(value)) {
      const parts = key.split('.');
      let target = page.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = field;
    }
  };
  return { page, navigation };
}

function readyPage(request) {
  const harness = loadPage('switch.js', request);
  Object.assign(harness.page.data, {
    mode: 'style', canEdit: true, canCreate: true, activeCardId: 'card-1',
    draftTemplate: 'wave', draftCompanyId: 'company-1',
  });
  return harness;
}

test('style page creates a new card without replacing the current card', async () => {
  const calls = [];
  const { page, navigation } = readyPage(async (options) => { calls.push(options); });
  page.onCreate();
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/employee/cards');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].data.template, 'wave');
  assert.equal(calls[0].data.companyId, 'company-1');
  assert.deepEqual(navigation, ['/pages/home/edit']);
});

test('applying a style updates the current card instead of creating one', async () => {
  const calls = [];
  const { page } = readyPage(async (options) => { calls.push(options); });
  page.onApply();
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/employee/me');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].data.cardTemplate, 'wave');
});

test('a grant for another company permits creation but cannot modify an uneditable current card', () => {
  const calls = [];
  const { page } = readyPage(async (options) => { calls.push(options); });
  page.data.canEdit = false;
  page.onApply();
  assert.equal(calls.length, 0);
  page.onCreate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});

test('ordinary permission and repeated submission do not issue card writes', () => {
  const calls = [];
  const { page } = readyPage(async (options) => { calls.push(options); });
  page.data.canCreate = false;
  page.data.canEdit = false;
  page.onCreate();
  page.onApply();
  assert.equal(calls.length, 0);
  page.data.canCreate = true;
  page.onCreate();
  page.onCreate();
  assert.equal(calls.length, 1);
});

test('style page initially selects the current card template and company', async () => {
  const { page } = loadPage('switch.js', async ({ url }) => url === '/api/employee/me'
    ? { employee: { activeCardId: 'card-1', cards: [{ id: 'card-1', template: 'wave', companyId: 'company-1', lifecycle: 'active' }] }, canEdit: true }
    : { items: [{ id: 'classic', companyId: 'default' }, { id: 'wave', companyId: 'company-1' }] });
  page.load();
  await new Promise(setImmediate);
  assert.equal(page.data.draftTemplate, 'wave');
  assert.equal(page.data.draftCompanyId, 'company-1');
});

test('zero-card home keeps its first creation entry and styles remain reachable for another company grant', () => {
  const { page, navigation } = loadPage('index.js');
  page.data.emptyState = { kind: 'ready' };
  page.onEmptyAction();
  page.data.canEdit = false;
  page.data.canCreate = true;
  page.onStyle();
  assert.deepEqual(navigation, ['/pages/home/switch?mode=create', '/pages/home/switch?mode=style']);
});

function groupedTemplates() {
  return ['classic', 'horizon', 'wave', 'tpl-custom'].map((id) => ({
    id, name: id,
    companyOptions: [
      { companyId: 'default', companyName: '总部', company: { name: id === 'tpl-custom' ? '定制品牌' : '总部' } },
      { companyId: 'company-1', companyName: '子公司', company: { name: id === 'tpl-custom' ? '定制品牌' : '子公司' } },
    ],
  }));
}

test('level-three style page shows four templates per company and preserves the template when company changes', async () => {
  const calls = [];
  const { page } = loadPage('switch.js', async (options) => {
    if (options.method === 'POST') { calls.push(options); return {}; }
    return options.url === '/api/employee/me'
      ? { employee: { activeCardId: 'card-1', cards: [{ id: 'card-1', template: 'wave', companyId: 'company-1', lifecycle: 'active' }] }, canEdit: true }
      : { permission: { level: 3 }, items: groupedTemplates() };
  });
  page.load();
  await new Promise(setImmediate);
  assert.equal(page.data.templates.length, 4);
  assert.equal(new Set(page.data.templates.map((item) => item.id)).size, 4);
  assert.equal(page.data.templateCompanies.length, 2);
  assert.equal(page.data.draftCompanyId, 'company-1');
  page.onTemplateCompanyChange({ detail: { value: '0' } });
  assert.equal(page.data.templates.length, 4);
  assert.equal(page.data.draftTemplate, 'wave');
  assert.equal(page.data.draftCompanyId, 'default');
  assert.ok(page.data.templates.every((item) => item.companyId === 'default'));
  assert.equal(page.data.templates.find((item) => item.id === 'tpl-custom').preview.company, '定制品牌');
  page.onCreate();
  assert.equal(calls[0].data.companyId, 'default');
});

test('level-three card editor retains every allowed company after templates are grouped', async () => {
  const calls = [];
  const { page } = loadPage('edit.js', async (options) => {
    if (options.method === 'PUT') { calls.push(options); return {}; }
    return options.url === '/api/employee/me'
      ? { employee: { activeCardId: 'card-1', cardTemplate: 'wave', companyId: 'company-1', company: '子公司' }, canEdit: true }
      : { permission: { level: 3 }, items: groupedTemplates() };
  });
  page.onShow();
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(page.data.companies, (item) => item.id), ['default', 'company-1']);
  assert.equal(page.data.companyIndex, 1);
  page.onChooseCompany({ currentTarget: { dataset: { index: 0 } } });
  page.onSave();
  assert.equal(calls[0].data.companyId, 'default');
});
