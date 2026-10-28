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

test('custom template keeps its printed names while selected company supplies phone and address', () => {
  const selected = {
    id: 'co-sz',
    name: '武创人工智能科技研究院(苏州)有限公司',
    shortName: '武创大智',
    phone: '0512-6666 8888',
    address: '苏州工业园区',
  };
  const root = {
    ...hq,
    id: 'default',
    cardTemplates: [{
      id: 'tpl-1',
      companyName: '模板上的另一家公司',
      companyNameEn: 'CUSTOM',
      shortName: '武创',
      shortNameEn: 'CUSTOM',
      qrUrl: '/uploads/template-qr.png',
    }],
  };
  const branded = companyForTemplate(selected, root, 'tpl-1');
  assert.equal(branded.name, '模板上的另一家公司');
  assert.equal(branded.nameEn, 'CUSTOM');
  assert.equal(branded.shortName, '武创');
  assert.equal(branded.brandEn, 'CUSTOM');
  assert.equal(branded.phone, selected.phone);
  assert.equal(branded.address, selected.address);
  assert.equal(branded.qrUrl, '/uploads/template-qr.png');

  const ownQr = companyForTemplate({ ...selected, qrUrl: '/uploads/company-qr.png' }, root, 'tpl-1');
  assert.equal(ownQr.qrUrl, '/uploads/template-qr.png');

  const blank = companyForTemplate({ ...selected, phone: '', address: '' }, root, 'tpl-1');
  assert.equal(blank.name, '模板上的另一家公司');
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
