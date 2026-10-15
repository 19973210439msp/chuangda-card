const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCertCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

function subsidiaryId(card) {
  const id = String((card && card.companyId) || '');
  if (!id || id === 'default') return '';
  return id;
}

function hideCertCode(company) {
  if (!company) return company;
  const next = { ...company };
  delete next.certCode;
  delete next.cardTemplates;
  return next;
}

module.exports = { makeCertCode, subsidiaryId, hideCertCode };
