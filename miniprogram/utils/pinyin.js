const dict = require('./pinyin-dict');

function toPinyin(text) {
  let out = '';
  const source = String(text || '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    const py = dict[ch];
    if (py) out += py;
    else out += ch.toLowerCase();
  }
  return out;
}

function compareByPinyin(left, right) {
  const a = toPinyin(left);
  const b = toPinyin(right);
  if (a === b) return String(left || '').localeCompare(String(right || ''));
  return a < b ? -1 : 1;
}

module.exports = { toPinyin, compareByPinyin };
