const BUILT_IN_TEMPLATE_IDS = new Set(['classic', 'horizon', 'wave']);

// One row per company grant. The style list is chosen after the company.
function expandTemplateOptions(items) {
  return (items || []).flatMap((item) => Array.isArray(item.companyOptions)
    ? item.companyOptions.map((option) => ({ ...item, ...option }))
    : [item]);
}

function isBuiltInTemplate(item) {
  return !!(item && (item.builtIn || BUILT_IN_TEMPLATE_IDS.has(item.id)));
}

function templateCompanies(items) {
  const companies = new Map();
  for (const item of items || []) {
    if (item.companyId && !companies.has(item.companyId)) {
      companies.set(item.companyId, { id: item.companyId, name: item.companyName || '' });
    }
  }
  return [...companies.values()].sort((a, b) => Number(b.id === 'default') - Number(a.id === 'default'));
}

function templateSelection(options, templateId, companyId) {
  const rows = options || [];
  const companies = templateCompanies(rows);
  const selectedCompany = companies.find((item) => item.id === companyId)
    || companies.find((item) => item.id === 'default')
    || companies[0];
  const templates = [];
  const seen = new Set();
  for (const item of rows) {
    if (!selectedCompany || item.companyId !== selectedCompany.id || !isBuiltInTemplate(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    templates.push(item);
  }
  const selected = templates.find((item) => item.id === templateId) || templates[0];
  return {
    templates,
    draftTemplate: selected ? selected.id : '',
    draftCompanyId: selectedCompany ? selectedCompany.id : '',
    templateCompanies: companies,
    templateCompanyIndex: Math.max(0, companies.findIndex((item) => selectedCompany && item.id === selectedCompany.id)),
    chooseCompany: companies.length > 1,
  };
}

module.exports = { expandTemplateOptions, templateCompanies, templateSelection };
