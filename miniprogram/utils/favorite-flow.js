function value(input) {
  return String(input || '').trim();
}

function favoritePayload(cardId, shareCardId) {
  const payload = { cardId: value(cardId) };
  const shared = value(shareCardId);
  if (shared) payload.shareCardId = shared;
  return payload;
}

function sharedCardPath(cardId, shareCardId, collected) {
  let path = '/pages/client/card?cardId=' + encodeURIComponent(value(cardId));
  const shared = value(shareCardId);
  if (shared) path += '&shareCard=' + encodeURIComponent(shared);
  if (collected) path += '&collected=1';
  return path;
}

function holderCardPath(cardId, shareCardId) {
  return sharedCardPath(cardId, shareCardId, false) + '&from=holder';
}

function favoriteCompletion(pageCount, cardId, shareCardId) {
  if (Number(pageCount) > 1) return { action: 'back', delta: 1 };
  return { action: 'redirect', url: sharedCardPath(cardId, shareCardId, true) };
}

const SHARE_SCENES = [1007, 1008, 1036, 1044, 1047, 1048, 1049, 1065, 1167, 1179, 1194];

function sharedEntryPath(enter, pendingCardId) {
  if (value(pendingCardId)) return '';
  const query = enter && enter.query ? enter.query : {};
  const cardId = value(query.cardId);
  if (!cardId) return '';
  const path = String((enter && enter.path) || '');
  if (path.indexOf('pages/client/card') >= 0) return sharedCardPath(cardId, query.shareCard, false);
  const openedLogin = !path || path.indexOf('pages/login/') >= 0;
  if (openedLogin && SHARE_SCENES.indexOf(Number(enter && enter.scene)) >= 0) {
    return sharedCardPath(cardId, query.shareCard, false);
  }
  return '';
}

function cardDetailRequest(cardId, shareCardId, from) {
  const shared = value(shareCardId);
  const query = shared ? '?shareCard=' + encodeURIComponent(shared) : '';
  return {
    url: '/api/cards/' + encodeURIComponent(value(cardId)) + query,
    redirectOnAuth: false,
    auth: value(from) === 'holder',
  };
}

module.exports = {
  favoritePayload,
  favoriteCompletion,
  sharedCardPath,
  sharedEntryPath,
  holderCardPath,
  cardDetailRequest,
};
