const { ensureCards, reconcileActiveCard, projectCard } = require('./cards');

function denied(code, message) {
  return { ok: false, code, message };
}

function publicCardState(person, shareCardId) {
  if (!person || person.kind !== 'employee') return denied('CARD_NOT_FOUND', '名片不存在');
  if (person.status !== 'active') return denied('CARD_UNAVAILABLE', '名片不可见');

  const ready = reconcileActiveCard(person);
  let card = null;
  if (shareCardId) {
    card = ensureCards(person).cards.find((item) => item.id === shareCardId) || null;
    if (!card) return denied('CARD_NOT_FOUND', '这张名片不存在');
  } else if (ready.activeCardId) {
    card = ready.cards.find((item) => item.id === ready.activeCardId) || null;
  }

  if (!card) return denied('NO_ACTIVE_CARD', '账号还没有可用名片');
  if (card.lifecycle === 'archived') return denied('CARD_ARCHIVED', '名片已归档');
  if (card.lifecycle !== 'active') return denied('NO_ACTIVE_CARD', '账号还没有可用名片');
  if (!card.companyId) return denied('CARD_UNASSIGNED', '名片尚未归属认证企业');

  return {
    ok: true,
    card,
    person: projectCard(person, card.id),
  };
}

module.exports = { publicCardState };
