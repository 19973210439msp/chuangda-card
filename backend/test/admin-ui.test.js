const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

test('card management renders every employee card as its own row', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? page : null, addEventListener: () => {} },
    window: { addEventListener: () => {} },
    location: { hash: '#/cards' },
    token: () => '',
  });
  vm.runInContext(source, context);
  const html = vm.runInContext(`
    state.admin = { scope: 'hq' };
    state.templates = [{ id: 'classic', name: '创大产控模板' }];
    state.employees = [{
      id: 'person-1', status: 'active', activeCardId: 'card-1',
      cards: [
        { id: 'card-1', name: '第一张名片', company: '总公司', phone: '13800000001', templateLabel: '创大产控模板', isDefault: true },
        { id: 'card-2', name: '第二张名片', company: '子公司', phone: '13800000002', templateLabel: '子公司模板', isDefault: false },
      ],
    }];
    cardsHtml();
  `, context);
  assert.match(html, /第一张名片/);
  assert.match(html, /第二张名片/);
  assert.match(html, /data-action="edit-card" data-id="person-1" data-card="card-1"/);
  assert.match(html, /data-action="edit-card" data-id="person-1" data-card="card-2"/);
  const dashboard = vm.runInContext('dashboardHtml()', context);
  assert.match(dashboard, /<span>员工名片<\/span><b>2<\/b>/);
});

test('success notice expires and clears when switching pages', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  let timer;
  let removed = 0;
  const context = vm.createContext({
    document: {
      querySelector: (selector) => selector === '#app' ? page : selector === '.banner.ok' ? { remove: () => { removed += 1; } } : null,
      addEventListener: () => {},
    },
    window: { addEventListener: () => {} },
    location: { hash: '#/cards' },
    token: () => '',
    api: async () => ({ items: [] }),
    setTimeout: (callback, delay) => { assert.equal(delay, 5000); timer = callback; return 1; },
    clearTimeout: () => { timer = null; },
  });
  vm.runInContext(source, context);
  vm.runInContext("state.admin = { scope: 'hq' }; state.view = 'cards'; showNotice('已删除')", context);
  await vm.runInContext("loadView('cards')", context);
  assert.equal(vm.runInContext('state.notice', context), '已删除');
  timer();
  assert.equal(vm.runInContext('state.notice', context), '');
  assert.ok(removed > 0);

  vm.runInContext("state.view = 'overview'; showNotice('已删除')", context);
  await vm.runInContext('route()', context);
  assert.equal(vm.runInContext('state.notice', context), '');
  assert.equal(timer, null);
});

test('hq employee creation and import include a target company selector', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? page : null, addEventListener: () => {} },
    window: { addEventListener: () => {} },
    location: { hash: '#/cards' },
    token: () => '',
  });
  vm.runInContext(source, context);
  const employee = vm.runInContext(`
    state.admin = { scope: 'hq' };
    state.companies = [
      { id: 'default', name: '总公司' },
      { id: 'company-a', name: '子公司甲' },
    ];
    state.templates = [{ id: 'classic', name: '创大模板', companyIds: ['default', 'company-a'] }];
    employeeDialog({ status: 'active', companyId: 'company-a', cardTemplate: 'classic' });
  `, context);
  assert.match(employee, /name="companyId"/);
  assert.match(employee, /value="company-a" selected/);
  const imported = vm.runInContext('importHtml()', context);
  assert.match(imported, /名片归属企业/);
  assert.doesNotThrow(() => vm.runInContext("assertTemplateAssignment('classic', 'company-a')", context));
  assert.throws(() => vm.runInContext("assertTemplateAssignment('classic', 'company-b')", context), /未分配给目标企业/);
});

test('employee removal copy distinguishes permanent deletion from company authorization removal', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? page : null, addEventListener: () => {} },
    window: { addEventListener: () => {} },
    location: { hash: '#/cards' },
    token: () => '',
  });
  vm.runInContext(source, context);

  const hq = vm.runInContext("employeeRemovalCopy('张三', 'hq')", context);
  assert.match(hq.confirm, /永久删除/);
  assert.match(hq.confirm, /全部名片/);
  assert.match(hq.success, /永久删除/);

  const company = vm.runInContext("employeeRemovalCopy('张三', 'company')", context);
  assert.match(company.confirm, /移除本公司授权/);
  assert.doesNotMatch(company.confirm, /永久删除|全部名片/);
  assert.match(company.success, /已移除本公司授权/);
});

test('certification interfaces do not expose certification codes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const certScript = fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/mine/cert.js'), 'utf8');
  const certMarkup = fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/mine/cert.wxml'), 'utf8');
  assert.doesNotMatch(source, /certCode|认证码/);
  assert.doesNotMatch(certScript, /certCode|onCertCode|认证码/);
  assert.doesNotMatch(certMarkup, /certCode|onCertCode|认证码/);
});
