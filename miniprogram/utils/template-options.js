// Templates are listed once; company choices remain explicit.
function expandTemplateOptions(items) {
  return (items || []).flatMap((item) => Array.isArray(item.companyOptions)
    ? item.companyOptions.map((option) => ({ ...item, ...option }))
    : [item]);
}

function templateCompanies(items) {
  const companies = new Map();
  for (const item of items || []) {
    if (item.companyId && !companies.has(item.companyId)) {
      companies.set(item.companyId, { id: item.companyId, name: item.companyName || '' });
    }
  }
  return [...companies.values()];
}

function templateSelection(options, templateId, companyId) {
  const groups = new Map();
  for (const item of options || []) {
    if (!groups.has(item.id)) groups.set(item.id, []);
    groups.get(item.id).push(item);
  }
  const selectedOptions = groups.get(templateId) || groups.values().next().value || [];
  const selected = selectedOptions.find((item) => item.companyId === companyId) || selectedOptions[0];
  const companies = templateCompanies(selectedOptions);
  return {
    templates: [...groups.values()].map((items) => items.find((item) => selected && item.companyId === selected.companyId) || items[0]),
    draftTemplate: selected ? selected.id : '',
    draftCompanyId: selected ? selected.companyId : '',
    templateCompanies: companies,
    templateCompanyIndex: Math.max(0, companies.findIndex((item) => selected && item.id === selected.companyId)),
    chooseCompany: companies.length > 1,
  };
}

module.exports = { expandTemplateOptions, templateCompanies, templateSelection };
