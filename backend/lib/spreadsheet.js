const XLSX = require('xlsx');

const HEADER = {
  姓名: 'name',
  职位: 'title',
  职务: 'title',
  手机号: 'phone',
  手机: 'phone',
  电话: 'phone',
  邮箱: 'email',
  二维码: 'qr',
  公司: 'company',
  地址: 'address',
  name: 'name',
  title: 'title',
  phone: 'phone',
  email: 'email',
  qr: 'qr',
  company: 'company',
  address: 'address',
};

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value));
  const text = String(value).trim();
  if (/e\+\d+$/i.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return String(Math.round(num));
  }
  return text;
}

function normalizeImportRow(row) {
  const out = {};
  Object.keys(row || {}).forEach((key) => {
    const rawKey = String(key).trim();
    const mapped = HEADER[rawKey];
    if (mapped) {
      if (!out[mapped]) out[mapped] = asText(row[key]);
      return;
    }
    if (rawKey === 'employeeNo' || rawKey === '工号') out.employeeNo = asText(row[key]);
    if (rawKey === 'attachments' && Array.isArray(row[key])) out.attachments = row[key];
  });
  return out;
}

function rowsFromSpreadsheet(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const name = book.SheetNames && book.SheetNames[0];
  if (!name) return [];
  const sheet = book.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return rows.map(normalizeImportRow).filter((row) => Object.keys(row).some((key) => row[key]));
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function wordCellText(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match = re.exec(xml);
  while (match) {
    parts.push(decodeXml(match[1]));
    match = re.exec(xml);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

async function rowsFromDocx(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) {
    const err = new Error('请上传 .docx 表格。旧版 .doc 请先另存为 .docx');
    err.code = 'DOCX_INVALID';
    throw err;
  }
  const xml = await file.async('string');
  const tables = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
  if (!tables.length) {
    const err = new Error('Word 里没有表格。请把员工信息做成表格，第一行写姓名、职位、手机号、邮箱、公司、地址');
    err.code = 'DOCX_NO_TABLE';
    throw err;
  }
  const table = tables[0];
  const lines = table.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  const matrix = lines.map((line) => {
    const cells = line.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    return cells.map(wordCellText);
  }).filter((row) => row.some(Boolean));
  if (matrix.length < 2) return [];
  const header = matrix[0].map((cell) => HEADER[String(cell || '').trim()] || '');
  if (!header.includes('name') && !header.includes('phone')) {
    const err = new Error('表格第一行需要包含姓名和手机号');
    err.code = 'DOCX_HEADER';
    throw err;
  }
  return matrix.slice(1).map((cells) => {
    const row = {};
    cells.forEach((cell, index) => {
      const key = header[index];
      if (key && !row[key]) row[key] = asText(cell);
    });
    return row;
  }).filter((row) => Object.keys(row).some((key) => row[key]));
}

module.exports = { rowsFromSpreadsheet, rowsFromDocx, normalizeImportRow, asText };
