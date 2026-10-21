const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { rowsFromSpreadsheet, rowsFromDocx } = require('../lib/spreadsheet');

test('xlsx import reads Chinese headers and keeps the phone as text', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('名片');
  sheet.addRows([
    ['姓名', '职位', '手机号', '邮箱', '二维码', '公司', '地址'],
    ['陈美秀', 'COO', '19116390887', 'shuman@universalteck.cn', 'https://example.com/qr.png', '上海宇创爱科技有限公司', '上海市浦东新区金海路1809号'],
    ['无名', '助理', '', 'a@b.cn', '', '公司', '地址'],
  ]);
  const buffer = await book.xlsx.writeBuffer();
  const rows = await rowsFromSpreadsheet(Buffer.from(buffer), '.xlsx');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '陈美秀');
  assert.equal(rows[0].title, 'COO');
  assert.equal(rows[0].phone, '19116390887');
  assert.equal(rows[0].qr, 'https://example.com/qr.png');
  assert.equal(rows[1].phone, '');
});

test('csv import supports quoted commas', async () => {
  const buffer = Buffer.from('姓名,职位,手机号,公司\n陈美秀,"联合创始人,COO",19116390887,创大产控\n');
  const rows = await rowsFromSpreadsheet(buffer, '.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '联合创始人,COO');
  assert.equal(rows[0].phone, '19116390887');
});

test('docx import reads the first table and Chinese headers', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>职位</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>手机号</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>邮箱</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>陈美</w:t><w:t>秀</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>顾问</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>19116390887</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>a@b.cn</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const rows = await rowsFromDocx(buffer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '陈美秀');
  assert.equal(rows[0].title, '顾问');
  assert.equal(rows[0].phone, '19116390887');
  assert.equal(rows[0].email, 'a@b.cn');
});
