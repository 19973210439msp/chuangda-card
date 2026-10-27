// Legacy review enterprises stay hidden; the certification test bypass is retired.
function reviewCompanyVisible(company) {
  return !!company && !company.reviewOnly;
}
function stripCertificationCode(company) {
  if (!company || !Object.prototype.hasOwnProperty.call(company, 'certCode')) return company;
  const { certCode, ...rest } = company;
  return rest;
}
module.exports = { reviewCompanyVisible, stripCertificationCode };
