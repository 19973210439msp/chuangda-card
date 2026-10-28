// Level-three templates are listed once; company choices remain explicit.
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

module.exports = { expandTemplateOptions, templateCompanies };
