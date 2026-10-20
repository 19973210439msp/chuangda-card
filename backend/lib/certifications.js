const crypto = require('crypto');

const STATUS_RANK = { approved: 3, pending: 2, revoked: 1, rejected: 1 };

function certificationKey(row) {
  return String(row.personId || '') + ':' + String(row.companyId || '');
}

function newestEffective(rows) {
  const byCompany = new Map();
  for (const row of rows || []) {
    if (!row || !row.personId || !row.companyId) continue;
    const key = certificationKey(row);
    const previous = byCompany.get(key);
    const rank = STATUS_RANK[row.status] || 0;
    const previousRank = previous ? (STATUS_RANK[previous.status] || 0) : -1;
    if (!previous
      || rank > previousRank
      || (rank === previousRank
        && String(row.updatedAt || row.createdAt || '') > String(previous.updatedAt || previous.createdAt || ''))) {
      byCompany.set(key, row);
    }
  }
  return Array.from(byCompany.values());
}

function fromLegacy(row) {
  return {
    id: row.id || 'cert-' + crypto.randomBytes(4).toString('hex'),
    personId: row.personId,
    companyId: row.companyId,
    companyName: row.companyName || '',
    name: row.name || '',
    phone: row.phone || '',
    title: row.title || '',
    status: row.status || 'pending',
    legacyCardId: row.cardId || '',
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || row.createdAt || new Date().toISOString(),
  };
}

async function migrateLegacyCertifications(store) {
  if (!store.listCertifications || !store.saveCertification) return [];
  const current = await store.listCertifications();
  const keys = new Set(current.map(certificationKey));
  const legacy = newestEffective(await store.listApplications());
  for (const row of legacy) {
    if (keys.has(certificationKey(row))) continue;
    const next = fromLegacy(row);
    await store.saveCertification(next);
    current.push(next);
    keys.add(certificationKey(next));
  }
  return newestEffective(current);
}

async function listCertifications(store) {
  await migrateLegacyCertifications(store);
  return newestEffective(await store.listCertifications());
}

async function saveCertification(store, row) {
  const now = new Date().toISOString();
  const current = (await listCertifications(store)).find((item) => (
    item.personId === row.personId && item.companyId === row.companyId
  ));
  const next = {
    ...(current || {}),
    ...row,
    id: (current && current.id) || row.id || 'cert-' + crypto.randomBytes(4).toString('hex'),
    createdAt: (current && current.createdAt) || row.createdAt || now,
    updatedAt: now,
  };
  return store.saveCertification(next);
}

async function approvedCompanyIds(store, personId) {
  return new Set((await listCertifications(store))
    .filter((row) => row.personId === personId && row.status === 'approved')
    .map((row) => row.companyId));
}

module.exports = {
  listCertifications,
  saveCertification,
  approvedCompanyIds,
  migrateLegacyCertifications,
};
