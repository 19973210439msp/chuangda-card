function hasRealContent(card) {
  if (!card || typeof card !== 'object') return false;
  return ['name', 'phone', 'email', 'title', 'company', 'employeeNo']
    .some((key) => String(card[key] || '').trim());
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function summarizeCardAccess({ people = [], companies = [], certifications = [], rootCompany = {} }) {
  const employees = people.filter((person) => person && person.kind === 'employee');
  const lifecycle = {};
  const certificationStatus = {};
  let totalCards = 0;
  let zeroCardAccounts = 0;
  let unassignedRealCards = 0;
  let legacySyntheticCards = 0;
  let missingCompanyId = 0;
  let missingLifecycle = 0;
  let missingSource = 0;

  for (const person of employees) {
    const cards = Array.isArray(person.cards) ? person.cards : [];
    if (!cards.length) zeroCardAccounts += 1;
    totalCards += cards.length;
    for (const card of cards) {
      increment(lifecycle, card.lifecycle || 'missing');
      if (!Object.prototype.hasOwnProperty.call(card, 'companyId')) missingCompanyId += 1;
      if (!card.lifecycle) missingLifecycle += 1;
      if (!card.source) missingSource += 1;
      if (card.companyId === '' && hasRealContent(card)) unassignedRealCards += 1;
      if (card.id === 'card-default' && card.companyId === '' && !hasRealContent(card)) {
        legacySyntheticCards += 1;
      }
    }
  }

  for (const row of certifications) increment(certificationStatus, row.status || 'missing');

  const grants = rootCompany && rootCompany.cardTemplateGrants;
  const builtInGrantCount = grants && typeof grants === 'object'
    ? Object.values(grants).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0)
    : 0;
  const customTemplates = Array.isArray(rootCompany && rootCompany.cardTemplates)
    ? rootCompany.cardTemplates
    : [];

  return {
    employees: employees.length,
    totalCards,
    zeroCardAccounts,
    unassignedRealCards,
    legacySyntheticCards,
    missingCompanyId,
    missingLifecycle,
    missingSource,
    lifecycle,
    companies: companies.length,
    certifications: certifications.length,
    certificationStatus,
    customTemplates: customTemplates.length,
    builtInGrantCount,
  };
}

module.exports = { hasRealContent, summarizeCardAccess };
