const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

test('card management renders every employee card as its own row', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin-web/js/app.js'), 'utf8');
  const page = { innerHTML: '', querySelector: () => null };
  const context = vm.createContext({
    document: { querySelector: () => page, addEventListener: () => {} },
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
