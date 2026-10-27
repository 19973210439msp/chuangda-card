const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureCards,
  projectActive,
  reconcileActiveCard,
  addCard,
  writeCompanyTemplateCard,
} = require('../lib/cards');
const { blankPerson, toCard } = require('../lib/person');
const { publicCardState } = require('../lib/cardAccess');
const { migratedPerson, migrateCardRecords } = require('../lib/cardMigration');

test('employee accounts can remain without a synthetic card', () => {
  const person = blankPerson({
    id: 'emp-empty',
    kind: 'employee',
    authPhone: '13800000000',
    cards: [],
  });
  const ready = ensureCards(person);
  assert.deepEqual(ready.cards, []);
  assert.equal(ready.activeCardId, '');

  const projected = projectActive(person);
  assert.equal(projected.activeCardId, '');
  assert.deepEqual(projected.cards, []);
  assert.equal(projected.authPhone, '13800000000');
});

test('ocr contacts project their top-level fields without employee cards', () => {
  const contact = blankPerson({
    id: 'card-ocr',
    kind: 'ocr',
    ownerId: 'emp-owner',
    name: '纸质客户',
    company: '外滩制造',
    phone: '021-55556666',
  });
  const card = toCard(contact);
  assert.equal(card.name, '纸质客户');
  assert.equal(card.company, '外滩制造');
  assert.equal(card.phone, '021-55556666');
  assert.equal(card.cardTemplate, 'wave');
  assert.equal(card.templateLabel, '蓝韵模板');
  assert.equal(card.activeCardId, '');
});

test('archiving the active card selects the next active card', () => {
  const person = blankPerson({
    id: 'emp-two',
    activeCardId: 'card-one',
    cards: [
      { id: 'card-one', template: 'classic', lifecycle: 'archived', isDefault: true, companyId: 'default' },
      { id: 'card-two', template: 'classic', lifecycle: 'active', isDefault: false, companyId: 'company-a' },
    ],
  });
  assert.equal(reconcileActiveCard(person).activeCardId, 'card-two');
});

test('the first real card can be created from a zero-card account', () => {
  const person = blankPerson({ id: 'emp-first', authPhone: '13800000001', cards: [] });
  const saved = addCard(person, 'classic', {
    companyId: 'company-a',
    company: '子公司甲',
    source: 'employee_created',
  });
  assert.equal(saved.cards.length, 1);
  assert.equal(saved.cards[0].companyId, 'company-a');
  assert.equal(saved.cards[0].lifecycle, 'active');
  assert.equal(saved.activeCardId, saved.cards[0].id);
});

test('archived cards do not consume the six active card limit', () => {
  const archivedCards = Array.from({ length: 6 }, (_, index) => ({
    id: 'archived-' + index,
    template: 'classic',
    lifecycle: 'archived',
    isDefault: index === 0,
    companyId: 'company-a',
  }));
  const person = blankPerson({ id: 'emp-archived-limit', cards: archivedCards });
  const saved = addCard(person, 'classic', { companyId: 'company-a', company: '子公司甲' });
  assert.equal(saved.cards.filter((card) => card.lifecycle === 'active').length, 1);
  assert.equal(saved.cards.length, 7);

  const sixActive = blankPerson({
    id: 'emp-active-limit',
    cards: archivedCards.map((card) => ({ ...card, lifecycle: 'active' })),
  });
  assert.throws(
    () => writeCompanyTemplateCard(sixActive, {
      companyId: 'company-b', company: '子公司乙', cardTemplate: 'tpl-company-b',
    }),
    /最多保存 6 张有效名片/,
  );
});

test('public card state distinguishes no card, archived card and inactive account', () => {
  const empty = blankPerson({ id: 'emp-empty-public', cards: [] });
  assert.equal(publicCardState(empty).code, 'NO_ACTIVE_CARD');

  const archived = blankPerson({
    id: 'emp-archived',
    activeCardId: 'card-old',
    cards: [{
      id: 'card-old', template: 'classic', lifecycle: 'archived', isDefault: true, companyId: 'default',
    }],
  });
  assert.equal(publicCardState(archived, 'card-old').code, 'CARD_ARCHIVED');

  const inactive = { ...empty, status: 'disabled' };
  assert.equal(publicCardState(inactive).code, 'CARD_UNAVAILABLE');

  const unassigned = blankPerson({
    id: 'emp-unassigned', activeCardId: 'card-unassigned',
    cards: [{ id: 'card-unassigned', template: 'classic', lifecycle: 'active', companyId: '' }],
  });
  assert.equal(publicCardState(unassigned).code, 'CARD_UNASSIGNED');
});

test('soft-deleted cards stay unavailable after startup migration and do not consume the card limit', () => {
  const person = blankPerson({
    id: 'deleted-history', authPhone: '13910000001', activeCardId: 'old-0',
    cards: Array.from({ length: 8 }, (_, index) => ({
      id: 'old-' + index, template: 'classic', companyId: 'default',
      lifecycle: 'deleted', deletedAt: '2026-10-01T00:00:00.000Z',
    })),
  });
  const migrated = migratedPerson(person);
  assert.equal(migrated.activeCardId, '');
  assert.equal(publicCardState(migrated, 'old-0').code, 'CARD_DELETED');
  const next = addCard(migrated, 'classic', { companyId: 'default' });
  assert.equal(next.cards.filter((card) => card.lifecycle === 'active').length, 1);
  assert.equal(next.cards[0].deletedAt, '2026-10-01T00:00:00.000Z');
});

test('legacy card migration persists lifecycle and source without inventing a card', async () => {
  const legacy = {
    id: 'emp-legacy', kind: 'employee', status: 'active', activeCardId: 'card-old',
    cards: [{ id: 'card-old', template: 'classic', isDefault: true, name: '存量员工' }],
  };
  const migrated = migratedPerson(legacy);
  assert.equal(migrated.cards[0].companyId, '');
  assert.ok(migrated.cards[0].id);
  assert.equal(migrated.cards[0].lifecycle, 'active');
  assert.equal(migrated.cards[0].source, 'legacy_unknown');

  const empty = migratedPerson({ id: 'emp-empty', kind: 'employee', cards: [], activeCardId: '' });
  assert.deepEqual(empty.cards, []);

  const updates = [];
  const count = await migrateCardRecords({
    async listPeople() { return [legacy, empty]; },
    async updatePerson(id, person) { updates.push({ id, person }); },
  });
  assert.equal(count, 1);
  assert.equal(updates[0].id, legacy.id);
});
