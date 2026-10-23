const express = require('express');
const crypto = require('crypto');
const { asyncRoute, httpError } = require('../lib/errors');
const { requireEmployee } = require('../lib/access');
const { getStore } = require('../storage');
const { nowIso, blankPerson, toCard } = require('../lib/person');
const { publicCardState } = require('../lib/cardAccess');
const { text, normalizePhone } = require('../lib/validate');

const router = express.Router();

async function holderItems(userId) {
  const store = getStore();
  const refs = await store.listHolderRefs(userId);
  const items = [];
  for (const ref of refs) {
    const card = await store.getPerson(ref.cardId);
    if (!card) continue;
    let visible = card;
    if (card.kind === 'employee') {
      const state = publicCardState(card, ref.shareCardId || '');
      if (!state.ok) continue;
      visible = state.person;
    }
    items.push({
      cardId: ref.cardId,
      shareCardId: ref.shareCardId || '',
      savedAt: ref.createdAt,
      card: toCard(visible),
    });
  }
  items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return items;
}

router.get('/', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  res.json({ items: await holderItems(user.id) });
}));

function contactKey(card) {
  const phone = normalizePhone(card && card.phone);
  const wechat = String((card && card.wechat) || '').trim();
  return { phone, wechat };
}

async function assertNotDuplicate(userId, incoming, ignoreCardId) {
  const items = await holderItems(userId);
  const next = contactKey(incoming);
  const duplicated = items.some((item) => {
    if (ignoreCardId && item.cardId === ignoreCardId) return false;
    const current = contactKey(item.card);
    if (next.phone && current.phone && next.phone === current.phone) return true;
    if (next.wechat && current.wechat && next.wechat === current.wechat) return true;
    return false;
  });
  if (duplicated) throw httpError(409, 'DUPLICATE_CARD', '该手机号或微信号已在名片夹中');
}

router.delete('/:cardId', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const cardId = req.params.cardId;
  const store = getStore();
  const card = await store.getPerson(cardId);
  if (!card) throw httpError(404, 'CARD_NOT_FOUND', '名片不在名片夹中');
  const removed = await store.deleteHolderRef(user.id, cardId);
  if (!removed) throw httpError(404, 'CARD_NOT_FOUND', '名片不在名片夹中');
  if (card.kind === 'ocr' && card.ownerId === user.id) await store.deletePerson(cardId);
  res.json({ ok: true });
}));

router.post('/', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const cardId = text(req.body && req.body.cardId, 64);
  if (!cardId) throw httpError(400, 'VALIDATION_ERROR', '收藏需要 cardId');
  const store = getStore();
  const card = await store.getPerson(cardId);
  const shareCardId = text(req.body && req.body.shareCardId, 64);
  const state = publicCardState(card, shareCardId);
  if (!state.ok) {
    throw httpError(404, 'CARD_NOT_FOUND', '只能收藏本系统中的有效名片');
  }
  if (card.id === user.id) throw httpError(400, 'VALIDATION_ERROR', '不能收藏自己的名片');
  if (!(await store.hasHolderRef(user.id, cardId))) await assertNotDuplicate(user.id, state.person);
  const saved = await store.putHolderRef({
    userId: user.id,
    cardId,
    shareCardId: state.card.id,
    createdAt: nowIso(),
  });
  res.status(saved.already ? 200 : 201).json({
    already: saved.already,
    item: {
      cardId,
      shareCardId: saved.shareCardId || state.card.id,
      savedAt: saved.createdAt,
      card: toCard(state.person),
    },
  });
}));

router.post('/confirm', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const body = req.body || {};
  const fields = {
    name: text(body.name, 40),
    company: text(body.company, 80),
    title: text(body.title, 40),
    phone: text(body.phone, 30),
    wechat: text(body.wechat, 40),
    email: text(body.email, 80),
    address: text(body.address, 120),
  };
  const store = getStore();
  await assertNotDuplicate(user.id, fields);
  const card = blankPerson({
    id: 'card-' + crypto.randomBytes(4).toString('hex'),
    kind: 'ocr',
    ownerId: user.id,
    ...fields,
  });
  await store.insertPerson(card);
  const saved = await store.putHolderRef({
    userId: user.id,
    cardId: card.id,
    createdAt: nowIso(),
    overwrite: true,
  });
  res.status(201).json({
    item: { cardId: card.id, savedAt: saved.createdAt, card: toCard(card) },
  });
}));

module.exports = router;
