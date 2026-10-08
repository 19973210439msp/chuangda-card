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

module.exports = { rowsFromSpreadsheet, normalizeImportRow, asText };
