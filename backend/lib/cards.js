const crypto = require('crypto');

const TEMPLATES = {
  classic: '创大产控模板',
  horizon: '晴空模板',
  wave: '蓝韵模板',
};

const CARD_LIFECYCLES = new Set(['draft', 'active', 'archived', 'deleted']);

function templateLabel(template) {
  if (String(template || '').startsWith('tpl-')) return '总部自定义模板';
  return TEMPLATES[template] || '未知模板';
}

function validTemplate(template) {
  return !!TEMPLATES[template] || String(template || '').startsWith('tpl-');
}

function newCardId() {
  return 'card-' + crypto.randomBytes(4).toString('hex');
}

function invalidTemplate() {
  const err = new Error('模板不存在');
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  return err;
}

function assertActiveCardLimit(cards) {
  if ((cards || []).filter((card) => card.lifecycle === 'active').length < 6) return;
  const err = new Error('最多保存 6 张有效名片');
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}

function normalizeCard(card, index, hasDefault) {
  const source = card || {};
  const template = validTemplate(source.template) ? source.template : 'classic';
  return {
    id: source.id || ('card-' + index),
    template,
    templateName: source.templateName || '',
    isDefault: source.isDefault === true || (index === 0 && !hasDefault),
    name: source.name || '',
    company: source.company || '',
    title: source.title || '',
    phone: source.phone || '',
    wechat: source.wechat || '',
    email: source.email || '',
    address: source.address || '',
    companyId: Object.prototype.hasOwnProperty.call(source, 'companyId')
      ? String(source.companyId || '')
      : '',
    lifecycle: CARD_LIFECYCLES.has(source.lifecycle) ? source.lifecycle : 'active',
    source: source.source || 'legacy_unknown',
    ...(source.deletedAt ? { deletedAt: source.deletedAt } : {}),
    attachments: (Array.isArray(source.attachments) ? source.attachments : [])
      .filter((item) => !item || item.name !== '微信二维码'),
  };
}

function cardFromFields(fields, extra) {
  if (!validTemplate(extra.template)) throw invalidTemplate();
  return {
    id: extra.id,
    template: extra.template,
    templateName: fields.templateName || '',
    isDefault: !!extra.isDefault,
    name: fields.name || '',
    company: fields.company || '',
    title: fields.title || '',
    phone: fields.phone || '',
    wechat: fields.wechat || '',
    email: fields.email || '',
    address: fields.address || '',
    companyId: Object.prototype.hasOwnProperty.call(fields, 'companyId') ? String(fields.companyId || '') : '',
    lifecycle: CARD_LIFECYCLES.has(extra.lifecycle) ? extra.lifecycle : 'active',
    source: extra.source || 'legacy_unknown',
    attachments: (Array.isArray(fields.attachments) ? fields.attachments : [])
      .filter((item) => !item || item.name !== '微信二维码'),
  };
}

function ensureCards(person) {
  const source = person || {};
  const input = Array.isArray(source.cards) ? source.cards.filter(Boolean) : [];
  const hasDefault = input.some((card) => card && card.isDefault === true);
  const cards = input.map((card, index) => normalizeCard(card, index, hasDefault));
  if (cards.length && !cards.some((card) => card.isDefault)) cards[0].isDefault = true;
  const activeCardId = cards.some((card) => card.id === source.activeCardId) ? source.activeCardId : '';
  return { ...source, cards, activeCardId };
}

function reconcileActiveCard(person) {
  const ready = ensureCards(person);
  const activeCards = ready.cards.filter((card) => card.lifecycle === 'active');
  if (!activeCards.length) return { ...ready, activeCardId: '' };
  if (activeCards.some((card) => card.id === ready.activeCardId)) return ready;
  const fallback = activeCards.find((card) => card.isDefault) || activeCards[0];
  return { ...ready, activeCardId: fallback.id };
}

function activeCard(person) {
  const ready = reconcileActiveCard(person);
  return ready.cards.find((card) => card.id === ready.activeCardId) || null;
}

function projectWithCard(person, card) {
  return {
    ...person,
    name: card.name || '',
    company: card.company || '',
    title: card.title || '',
    phone: card.phone || '',
    wechat: card.wechat || '',
    email: card.email || '',
    address: card.address || '',
    attachments: card.attachments || [],
    companyId: card.companyId || '',
    cardTemplate: card.template,
    templateName: card.templateName || '',
    activeCardId: card.id,
  };
}

function projectActive(person) {
  const ready = reconcileActiveCard(person);
  const card = ready.cards.find((item) => item.id === ready.activeCardId) || null;
  if (card) return projectWithCard(ready, card);
  return {
    ...ready,
    name: ready.name || '',
    company: ready.company || '',
    title: ready.title || '',
    phone: ready.phone || '',
    wechat: ready.wechat || '',
    email: ready.email || '',
    address: ready.address || '',
    attachments: Array.isArray(ready.attachments) ? ready.attachments : [],
    companyId: '',
    cardTemplate: '',
    templateName: '',
    activeCardId: '',
  };
}

function identityPhone(person) {
  if (!person) return '';
  if (person.authPhone || person.accountPhone) return person.authPhone || person.accountPhone;
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.isDefault) || ready.cards[0];
  return (card && card.phone) || person.phone || '';
}

function presentCard(card) {
  return {
    id: card.id,
    template: card.template,
    templateLabel: card.templateName || templateLabel(card.template),
    isDefault: !!card.isDefault,
    name: card.name || '',
    company: card.company || '',
    title: card.title || '',
    phone: card.phone || '',
    wechat: card.wechat || '',
    email: card.email || '',
    address: card.address || '',
    companyId: card.companyId || '',
    lifecycle: card.lifecycle || 'active',
    source: card.source || 'legacy_unknown',
  };
}

function writeActive(person, fields) {
  const ready = reconcileActiveCard(person);
  if (!ready.activeCardId) return projectActive({ ...ready, ...fields });
  const cards = ready.cards.map((card) => {
    if (card.id !== ready.activeCardId) return card;
    return cardFromFields({ ...card, ...fields }, {
      id: card.id,
      template: fields.cardTemplate === undefined ? card.template : fields.cardTemplate,
      isDefault: card.isDefault,
      lifecycle: card.lifecycle,
      source: card.source,
    });
  });
  return projectActive({ ...ready, cards });
}

function writeDefault(person, fields) {
  const ready = ensureCards(person);
  if (!ready.cards.length) return projectActive({ ...ready, ...fields });
  const cards = ready.cards.map((card) => {
    if (!card.isDefault) return card;
    const template = fields.cardTemplate === undefined ? card.template : fields.cardTemplate;
    return cardFromFields({ ...card, ...fields }, {
      id: card.id,
      template,
      isDefault: true,
      lifecycle: card.lifecycle,
      source: card.source,
    });
  });
  return projectActive({ ...ready, cards });
}

function removeCard(person, cardId) {
  const ready = ensureCards(person);
  const target = ready.cards.find((card) => card.id === cardId);
  if (!target) return null;
  let cards = ready.cards.filter((card) => card.id !== cardId);
  if (cards.length && !cards.some((card) => card.isDefault)) {
    cards = cards.map((card, index) => ({ ...card, isDefault: index === 0 }));
  }
  return projectActive(reconcileActiveCard({ ...ready, cards }));
}

function archiveCard(person, cardId) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  const cards = ready.cards.map((card) => card.id === cardId ? { ...card, lifecycle: 'archived' } : card);
  return projectActive(reconcileActiveCard({ ...ready, cards }));
}

function assignCardCompany(person, cardId, companyId, companyName) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  const cards = ready.cards.map((card) => {
    if (card.id !== cardId) return card;
    return cardFromFields({
      ...card,
      companyId,
      company: companyName === undefined ? card.company : companyName,
    }, {
      id: card.id,
      template: card.template,
      isDefault: card.isDefault,
      lifecycle: card.lifecycle,
      source: card.source,
    });
  });
  return projectActive({ ...ready, cards });
}

function writeCard(person, cardId, fields) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  const cards = ready.cards.map((card) => {
    if (card.id !== cardId) return card;
    return cardFromFields({ ...card, ...fields }, {
      id: card.id,
      template: card.template,
      isDefault: card.isDefault,
      lifecycle: card.lifecycle,
      source: card.source,
    });
  });
  return projectActive({ ...ready, cards });
}

function projectCard(person, cardId) {
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.id === cardId);
  return card ? projectWithCard(ready, card) : null;
}

function switchTo(person, cardId) {
  const ready = ensureCards(person);
  const card = ready.cards.find((item) => item.id === cardId && item.lifecycle === 'active');
  return card ? projectWithCard({ ...ready, activeCardId: cardId }, card) : null;
}

function writeCompanyTemplateCard(person, fields) {
  const ready = ensureCards(person);
  const companyId = Object.prototype.hasOwnProperty.call(fields, 'companyId') ? String(fields.companyId || '') : '';
  const template = fields.cardTemplate;
  if (!validTemplate(template)) throw invalidTemplate();
  const existing = ready.cards.find((card) => card.companyId === companyId && card.template === template && card.lifecycle !== 'deleted');
  if (existing) {
    if (existing.lifecycle !== 'active') assertActiveCardLimit(ready.cards);
    const cards = ready.cards.map((card) => {
      if (card.id !== existing.id) return card;
      return cardFromFields({ ...card, ...fields, companyId }, {
        id: card.id,
        template,
        isDefault: card.isDefault,
        lifecycle: 'active',
        source: card.source,
      });
    });
    return projectActive({ ...ready, cards, activeCardId: existing.id });
  }
  assertActiveCardLimit(ready.cards);
  const card = cardFromFields({ ...fields, companyId }, {
    id: newCardId(),
    template,
    isDefault: ready.cards.length === 0,
    lifecycle: 'active',
    source: fields.source || 'company_issued',
  });
  return projectActive({ ...ready, cards: ready.cards.concat(card), activeCardId: card.id });
}

function addCard(person, template, options = {}) {
  const ready = ensureCards(person);
  if (!validTemplate(template)) throw invalidTemplate();
  assertActiveCardLimit(ready.cards);
  const source = activeCard(ready) || person || {};
  const companyId = Object.prototype.hasOwnProperty.call(options, 'companyId') ? String(options.companyId || '') : '';
  const card = cardFromFields({
    name: source.name || '',
    company: source.company || '',
    title: source.title || '',
    phone: source.phone || source.authPhone || '',
    email: source.email || '',
    address: source.address || '',
    ...options,
    companyId,
  }, {
    id: newCardId(),
    template,
    isDefault: ready.cards.length === 0,
    lifecycle: 'active',
    source: options.source || 'employee_created',
  });
  return projectActive({ ...ready, cards: ready.cards.concat(card), activeCardId: card.id });
}

module.exports = {
  TEMPLATES,
  templateLabel,
  validTemplate,
  ensureCards,
  reconcileActiveCard,
  activeCard,
  projectActive,
  identityPhone,
  presentCard,
  writeActive,
  writeDefault,
  writeCard,
  assignCardCompany,
  writeCompanyTemplateCard,
  removeCard,
  archiveCard,
  switchTo,
  projectCard,
  addCard,
};
