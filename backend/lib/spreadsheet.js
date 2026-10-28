const { Readable } = require('stream');
const ExcelJS = require('exceljs');

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLUMNS = 50;

const HEADER = {
  姓名: 'name',
  职业: 'title',
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

function assertSheetSize(sheet) {
  if (sheet.actualRowCount > MAX_IMPORT_ROWS + 1) {
    const err = new Error(`表格最多导入 ${MAX_IMPORT_ROWS} 行`);
    err.code = 'SPREADSHEET_TOO_MANY_ROWS';
    throw err;
  }
  if (sheet.actualColumnCount > MAX_IMPORT_COLUMNS) {
    const err = new Error(`表格最多支持 ${MAX_IMPORT_COLUMNS} 列`);
    err.code = 'SPREADSHEET_TOO_MANY_COLUMNS';
    throw err;
  }
}

function cellText(cell) {
  return cell && cell.text != null ? String(cell.text).trim() : '';
}

function rowsFromWorksheet(sheet) {
  if (!sheet) return [];
  assertSheetSize(sheet);
  const header = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    header[column] = cellText(cell);
  });
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const source = {};
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column < header.length; column += 1) {
      if (header[column]) source[header[column]] = cellText(row.getCell(column));
    }
    const normalized = normalizeImportRow(source);
    if (Object.keys(normalized).some((key) => normalized[key])) rows.push(normalized);
  }
  return rows;
}

async function rowsFromSpreadsheet(buffer, extension = '.xlsx') {
  const ext = String(extension || '').toLowerCase();
  const book = new ExcelJS.Workbook();
  let sheet;
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    sheet = await book.csv.read(Readable.from(buffer), {
      parserOptions: { delimiter: ext === '.tsv' ? '\t' : ',' },
    });
  } else if (ext === '.xlsx' || ext === '.xlsm') {
    await book.xlsx.load(buffer);
    sheet = book.worksheets[0];
  } else {
    const err = new Error('请上传 xlsx、xlsm、csv、tsv 或 docx 文件');
    err.code = 'SPREADSHEET_UNSUPPORTED';
    throw err;
  }
  return rowsFromWorksheet(sheet);
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
    const err = new Error('Word 里没有表格。请把员工信息做成表格，第一行写姓名、职业、手机号、邮箱、公司、地址');
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
