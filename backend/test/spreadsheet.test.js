const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');
const { rowsFromSpreadsheet } = require('../lib/spreadsheet');

test('xlsx import reads Chinese headers and keeps the phone as text', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['姓名', '职位', '手机号', '邮箱', '二维码', '公司', '地址'],
    ['陈美秀', 'COO', '19116390887', 'shuman@universalteck.cn', 'https://example.com/qr.png', '上海宇创爱科技有限公司', '上海市浦东新区金海路1809号'],
    ['无名', '助理', '', 'a@b.cn', '', '公司', '地址'],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '名片');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const rows = rowsFromSpreadsheet(buffer);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '陈美秀');
  assert.equal(rows[0].title, 'COO');
  assert.equal(rows[0].phone, '19116390887');
  assert.equal(rows[0].qr, 'https://example.com/qr.png');
  assert.equal(rows[1].phone, '');
});
