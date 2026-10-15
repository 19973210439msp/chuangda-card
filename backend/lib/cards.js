const crypto = require('crypto');

const TEMPLATES = {
  classic: '创大产控模板',
  horizon: '晴空模板',
  wave: '蓝韵模板',
};

function templateLabel(template) {
  if (String(template || '').startsWith('tpl-')) return '总部自定义模板';
  return TEMPLATES[template] || TEMPLATES.classic;
}

function validTemplate(template) {
  return !!TEMPLATES[template] || String(template || '').startsWith('tpl-');
}

function newCardId() {
  return 'card-' + crypto.randomBytes(4).toString('hex');
}

function cardFromFields(fields, extra) {
  return {
    id: extra.id,
    template: validTemplate(extra.template) ? extra.template : 'classic',
    templateName: fields.templateName || '',
    isDefault: !!extra.isDefault,
    name: fields.name || '',
    company: fields.company || '',
    title: fields.title || '',
    phone: fields.phone || '',
    wechat: fields.wechat || '',
    email: fields.email || '',
    address: fields.address || '',
    companyId: Object.prototype.hasOwnProperty.call(fields, 'companyId') ? String(fields.companyId || '') : 'default',
    attachments: (Array.isArray(fields.attachments) ? fields.attachments : []).filter((item) => !item || item.name !== '微信二维码'),
  };
}

function ensureCards(person) {
  const source = person || {};
  let cards = Array.isArray(source.cards) ? source.cards.filter(Boolean) : [];
  if (!cards.length) {
    cards = [cardFromFields(source, { id: 'card-default', template: 'classic', isDefault: true })];
  } else {
    cards = cards.map((card, index) => cardFromFields(card, {
      id: card.id || ('card-' + index),
      template: card.template || 'classic',
      isDefault: card.isDefault === true || (index === 0 && !cards.some((item) => item && item.isDefault)),
    }));
    if (!cards.some((card) => card.isDefault)) cards[0].isDefault = true;
  }
  let activeCardId = source.activeCardId;
  if (!cards.some((card) => card.id === activeCardId)) {
    const fallback = cards.find((card) => card.isDefault) || cards[0];
    activeCardId = fallback.id;
  }
  return { ...source, cards, activeCardId };
}

function activeCard(person) {
  const ready = ensureCards(person);
  return ready.cards.find((card) => card.id === ready.activeCardId) || ready.cards[0];
}

function projectActive(person) {
  const ready = ensureCards(person);
  const card = activeCard(ready);
  return {
    ...ready,
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

function identityPhone(person) {
  if (!person) return '';
  if (person.authPhone) return person.authPhone;
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
  };
}

function writeActive(person, fields) {
  const ready = ensureCards(person);
  const cards = ready.cards.map((card) => {
    if (card.id !== ready.activeCardId) return card;
    return cardFromFields({ ...card, ...fields }, {
      id: card.id,
      template: card.template,
      isDefault: card.isDefault,
    });
  });
  return projectActive({ ...ready, cards });
}

function writeDefault(person, fields) {
  const ready = ensureCards(person);
  const cards = ready.cards.map((card) => {
    if (!card.isDefault) return card;
    return cardFromFields({ ...card, ...fields }, {
      id: card.id,
      template: validTemplate(fields.cardTemplate) ? fields.cardTemplate : 'classic',
      isDefault: true,
    });
  });
  return projectActive({ ...ready, cards });
}

function removeCard(person, cardId) {
  const ready = ensureCards(person);
  const target = ready.cards.find((card) => card.id === cardId);
  if (!target) return null;
  if (ready.cards.length <= 1) {
    const err = new Error('至少保留一张名片');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  let cards = ready.cards.filter((card) => card.id !== cardId);
  if (!cards.some((card) => card.isDefault)) {
    cards = cards.map((card, index) => ({ ...card, isDefault: index === 0 }));
  }
  const activeCardId = ready.activeCardId === cardId
    ? (cards.find((card) => card.isDefault) || cards[0]).id
    : ready.activeCardId;
  return projectActive({ ...ready, cards, activeCardId });
}

function assignCardCompany(person, cardId, companyId, companyName) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  const cards = ready.cards.map((card) => {
    if (card.id !== cardId) return card;
    return cardFromFields({
      ...card,
      companyId,
      company: companyName || card.company,
    }, {
      id: card.id,
      template: card.template,
      isDefault: card.isDefault,
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
    });
  });
  return projectActive({ ...ready, cards });
}
function projectCard(person, cardId) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  return projectActive({ ...ready, activeCardId: cardId });
}

function switchTo(person, cardId) {
  const ready = ensureCards(person);
  if (!ready.cards.some((card) => card.id === cardId)) return null;
  return projectActive({ ...ready, activeCardId: cardId });
}

function writeCompanyTemplateCard(person, fields) {
  const hadCards = Array.isArray(person.cards) && person.cards.length > 0;
  const ready = hadCards ? ensureCards(person) : { ...person, cards: [], activeCardId: '' };
  const companyId = Object.prototype.hasOwnProperty.call(fields, 'companyId') ? String(fields.companyId || '') : 'default';
  const template = validTemplate(fields.cardTemplate) ? fields.cardTemplate : 'classic';
  const existing = ready.cards.find((card) => card.companyId === companyId && card.template === template);
  if (existing) {
    const cards = ready.cards.map((card) => {
      if (card.id !== existing.id) return card;
      return cardFromFields({ ...card, ...fields, companyId }, {
        id: card.id,
        template,
        isDefault: card.isDefault,
      });
    });
    return projectActive({ ...ready, cards, activeCardId: existing.id });
  }
  const card = cardFromFields({ ...fields, companyId }, {
    id: newCardId(),
    template,
    isDefault: ready.cards.length === 0,
  });
  return projectActive({
    ...ready,
    cards: ready.cards.concat(card),
    activeCardId: card.id,
  });
}

function addCard(person, template, options = {}) {
  const ready = ensureCards(person);
  if (!validTemplate(template)) {
    const err = new Error('模板不存在');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (ready.cards.length >= 6) {
    const err = new Error('最多保存 6 张名片');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const source = activeCard(ready);
  const card = cardFromFields({
    name: source.name || '',
    company: source.company || person.company || '',
    title: source.title || '',
    phone: source.phone || '',
    email: source.email || '',
    address: source.address || '',
    companyId: source.companyId || 'default',
    ...options,
  }, { id: newCardId(), template, isDefault: false });
  return projectActive({
    ...ready,
    cards: ready.cards.concat(card),
    activeCardId: card.id,
  });
}

module.exports = {
  TEMPLATES,
  templateLabel,
  ensureCards,
  projectActive,
  identityPhone,
  presentCard,
  writeActive,
  writeDefault,
  writeCard,
  assignCardCompany,
  writeCompanyTemplateCard,
  removeCard,
  switchTo,
  projectCard,
  addCard,
};
