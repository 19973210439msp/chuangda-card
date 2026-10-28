const { templateGrantedTo } = require('./templates');

function canViewAdminCard(root, admin, card) {
  if (!admin || admin.scope === 'hq') return true;
  return card.source !== 'review_demo' && templateGrantedTo(root, card.template, admin.companyId);
}

function canEditAdminCard(root, admin, card) {
  if (!admin || admin.scope === 'hq') return card.lifecycle === 'active';
  return card.companyId === admin.companyId && card.lifecycle === 'active'
    && canViewAdminCard(root, admin, card);
}

module.exports = { canViewAdminCard, canEditAdminCard };
