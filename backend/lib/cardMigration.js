const CARD_LIFECYCLES = new Set(['draft', 'active', 'archived', 'deleted']);

function normalizeLegacyCard(card, index) {
  if (!card || typeof card !== 'object') return card;
  return {
    ...card,
    id: card.id || ('card-' + index),
    companyId: Object.prototype.hasOwnProperty.call(card, 'companyId')
      ? String(card.companyId || '')
      : '',
    lifecycle: CARD_LIFECYCLES.has(card.lifecycle) ? card.lifecycle : 'active',
    source: card.source || 'legacy_unknown',
  };
}

function migratedPerson(person) {
  if (!person || person.kind !== 'employee' || !Array.isArray(person.cards)) return person;
  const cards = person.cards.map(normalizeLegacyCard);
  const activeCards = cards.filter((card) => card && card.lifecycle === 'active');
  const currentIsActive = activeCards.some((card) => card.id === person.activeCardId);
  const fallback = activeCards.find((card) => card.isDefault) || activeCards[0] || null;
  const activeCardId = currentIsActive ? person.activeCardId : (fallback ? fallback.id : '');
  const accountPhone = person.accountPhone || person.authPhone || person.phone || '';
  return { ...person, cards, activeCardId, accountPhone };
}

async function migrateCardRecords(store) {
  const people = await store.listPeople({ kind: 'employee' });
  let updated = 0;
  for (const person of people) {
    const next = migratedPerson(person);
    if (JSON.stringify(next.cards) === JSON.stringify(person.cards)
      && next.activeCardId === person.activeCardId && next.accountPhone === person.accountPhone) continue;
    await store.updatePerson(person.id, next);
    updated += 1;
  }
  return updated;
}

module.exports = { normalizeLegacyCard, migratedPerson, migrateCardRecords };
