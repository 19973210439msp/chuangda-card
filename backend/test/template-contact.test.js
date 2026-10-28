const test = require('node:test');
const assert = require('node:assert/strict');
const { companyForTemplate, createTemplate } = require('../lib/templates');

const hq = {
  name: '上海创大产控高新技术集团有限公司',
  phone: '021-5888 6080',
  address: '上海市浦东新区金桥红枫路288号',
  cardTemplates: [],
};

test('built-in templates keep a subsidiary phone and otherwise use the headquarters contact', () => {
  const withContact = companyForTemplate(
    { name: '子公司', phone: '021-1111 2222', address: '子公司地址' },
    hq,
    'classic',
  );
  assert.equal(withContact.phone, '021-1111 2222');
  assert.equal(withContact.address, '子公司地址');

  const blank = companyForTemplate({ name: '子公司', phone: '', address: '' }, hq, 'classic');
  assert.equal(blank.name, '子公司');
  assert.equal(blank.phone, '021-5888 6080');
  assert.equal(blank.address, '上海市浦东新区金桥红枫路288号');
});

test('the company name printed on the template picks that subsidiary, otherwise headquarters', () => {
  const suzhou = {
    id: 'co-sz',
    name: '武创人工智能科技研究院(苏州)有限公司',
    phone: '0512-6666 8888',
    address: '苏州工业园区',
  };
  const other = { id: 'co-ot', name: '其他子公司', phone: '021-1111 2222', address: '其他地址' };
  const root = {
    ...hq,
    id: 'default',
    cardTemplates: [{
      id: 'tpl-1',
      companyName: suzhou.name,
      companyNameEn: 'CUSTOM',
      shortName: '武创',
      shortNameEn: 'CUSTOM',
      qrUrl: '',
    }],
  };
  const matched = companyForTemplate(other, root, 'tpl-1', [suzhou, other, root]);
  assert.equal(matched.name, suzhou.name);
  assert.equal(matched.phone, suzhou.phone);
  assert.equal(matched.address, suzhou.address);

  const unmatched = companyForTemplate(
    { id: 'co-x', name: '对不上的公司', phone: '021-1111 2222', address: '不该用这家' },
    root,
    'classic',
    [suzhou, other, root],
  );
  assert.equal(unmatched.phone, hq.phone);
  assert.equal(unmatched.address, hq.address);

  const blank = companyForTemplate(
    { ...suzhou, phone: '', address: '' },
    root,
    'classic',
    [{ ...suzhou, phone: '', address: '' }, root],
  );
  assert.equal(blank.phone, hq.phone);
  assert.equal(blank.address, hq.address);
});

test('a template does not store one phone for every assigned company', () => {
  const created = createTemplate({
    name: '子公司模板',
    phone: '021-3333 4444',
    address: '模板上的地址',
  }, hq);
  assert.equal(created.phone, undefined);
  assert.equal(created.address, undefined);
});
