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
        { id: 'card-1', name: '第一张名片', company: '总公司', phone: '13800000001', templateLabel: '创大产控模板', lifecycle: 'active', isDefault: true },
        { id: 'card-2', name: '第二张名片', company: '子公司', phone: '13800000002', templateLabel: '子公司模板', lifecycle: 'active', isDefault: false },
      ],
    }];
    cardsHtml();
  `, context);
  assert.match(html, /第一张名片/);
  assert.match(html, /第二张名片/);
  assert.match(html, /data-action="edit-card" data-id="person-1" data-card="card-1"/);
  assert.match(html, /data-action="edit-card" data-id="person-1" data-card="card-2"/);
  const dashboard = vm.runInContext('dashboardHtml()', context);
  assert.match(dashboard, /<span>有效名片<\/span><b>2<\/b>/);
});

test('admin card management shows account-only users and separates account phone from card phone', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? page : null, addEventListener: () => {} },
    window: { addEventListener: () => {} }, location: { hash: '#/cards' }, token: () => '',
  });
  vm.runInContext(source, context);
  const html = vm.runInContext(`
    state.admin = { scope: 'hq' };
    state.templates = [{ id: 'classic', name: '创大产控模板' }];
    state.companies = [{ id: 'default', name: '总公司' }];
    state.employees = [{ id: 'account-only', status: 'active', accountPhone: '13950600003', cards: [] }];
    cardsHtml();
  `, context);
  assert.match(html, /13950600003/);
  assert.match(html, /尚未创建名片/);

  const createDialog = vm.runInContext("employeeDialog({ id: '', accountPhone: '', phone: '' })", context);
  assert.match(createDialog, /name="accountPhone"/);
  assert.match(createDialog, /账号手机号/);
  assert.match(createDialog, /名片联系电话/);
  assert.match(createDialog, /<label for="title">职业<\/label>/);
  assert.doesNotMatch(createDialog, /name="department"/);

  const editDialog = vm.runInContext("employeeDialog({ id: 'account-only', accountPhone: '13950600003', phone: '13850600003', cards: [] })", context);
  assert.match(editDialog, /账号手机号：13950600003/);
  assert.doesNotMatch(editDialog, /name="accountPhone"/);
  assert.match(editDialog, /<label for="title">职业<\/label>/);
  assert.doesNotMatch(editDialog, /name="department"/);
  const imported = vm.runInContext('importHtml()', context);
  assert.match(imported, /姓名、职业、手机号/);
  const pasted = vm.runInContext("parseImportTable('姓名,职业,手机号\\n测试员工,产品经理,13800000000')", context);
  assert.equal(pasted[0].title, '产品经理');
});

test('shared template cards are clearly read-only and hide account mutations from company admins', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? page : null, addEventListener: () => {} },
    window: { addEventListener: () => {} }, location: { hash: '#/cards' }, token: () => '',
  });
  vm.runInContext(source, context);
  const html = vm.runInContext(`
    state.admin = { scope: 'company', companyId: 'viewer-company' };
    state.templates = [{ id: 'shared-template', name: '共享模板' }];
    state.employees = [{
      id: 'person-shared', status: 'active', canManageAccount: false, canRemoveCompanyCards: false,
      accountPhone: '13950800001', authPhone: '13950800001', employeeNo: 'SECRET-NO', department: '敏感部门',
      cards: [{
        id: 'card-shared', name: '共享员工', company: '所属公司', title: '产品经理',
        phone: '13800000000', email: 'shared@example.com', address: '上海',
        template: 'shared-template', templateLabel: '共享模板', lifecycle: 'active', canAdminEdit: false,
      }],
    }];
    cardsHtml();
  `, context);
  assert.match(html, />查看<\/button><span class="muted">共享只读<\/span>/);
  assert.doesNotMatch(html, /data-action="disable"|data-action="restore"|data-action="remove"/);
  assert.doesNotMatch(html, /13950800001|SECRET-NO|敏感部门/);
  const dialog = vm.runInContext(`
    employeeDialog(cardFields(state.employees[0], state.employees[0].cards[0]));
  `, context);
  assert.match(dialog, /查看共享名片/);
  assert.match(dialog, /不能在这里编辑或删除/);
  assert.match(dialog, /共享员工|产品经理|13800000000/);
  assert.doesNotMatch(dialog, /data-form="employee"|>保存<|delete-card/);
  assert.doesNotMatch(dialog, /13950800001|SECRET-NO|敏感部门/);
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
  assert.doesNotThrow(() => vm.runInContext("assertTemplateAssignment('classic', 'company-b')", context));
  vm.runInContext("state.admin = { scope: 'company', companyId: 'company-a' };", context);
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

test('certification entry is removed and default policy form only appears for enabled HQ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../miniprogram/app.json'), 'utf8'));
  assert.equal(appConfig.pages.includes('pages/mine/cert'), false);
  assert.doesNotMatch(source, /certCode|认证码|api\/certifications/);
  const context = vm.createContext({
    document: { querySelector: (selector) => selector === '#app' ? { innerHTML: '', querySelector: () => null } : null, addEventListener: () => {} },
    window: { addEventListener: () => {} }, location: { hash: '' }, token: () => '',
  });
  vm.runInContext(source, context);
  vm.runInContext("state.admin = { scope: 'hq' }; state.permissionPolicy = { enabled: false, companies: [] };", context);
  assert.doesNotMatch(vm.runInContext('certHtml()', context), /data-form="permission-policy"/);
  vm.runInContext("state.permissionPolicy.enabled = true; state.permissionPolicy.policy = { level: 1, companyIds: [] };", context);
  assert.match(vm.runInContext('certHtml()', context), /data-form="permission-policy"/);
  vm.runInContext("state.admin = { scope: 'company', companyId: 'a' };", context);
  const sub = vm.runInContext('certHtml()', context);
  assert.doesNotMatch(sub, /data-form="permission-policy"|value="3"/);
});
