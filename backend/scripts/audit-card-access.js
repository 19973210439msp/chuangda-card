const { getStore } = require('../storage');
const { summarizeCardAccess } = require('../lib/cardAudit');

async function main() {
  const store = getStore();
  await store.ready();
  const [people, companies, certifications, rootCompany] = await Promise.all([
    store.listPeople({ kind: 'employee' }),
    store.listCompanies(),
    store.listCertifications ? store.listCertifications() : [],
    store.getCompany('default'),
  ]);
  const summary = summarizeCardAccess({ people, companies, certifications, rootCompany });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`名片权限数据审计失败：${error.message}\n`);
  process.exitCode = 1;
});
