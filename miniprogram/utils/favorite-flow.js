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

function cardDetailRequest(cardId, shareCardId, from) {
  const shared = value(shareCardId);
  const query = shared ? '?shareCard=' + encodeURIComponent(shared) : '';
  return {
    url: '/api/cards/' + encodeURIComponent(value(cardId)) + query,
    redirectOnAuth: false,
    auth: value(from) === 'holder',
  };
}

module.exports = { favoritePayload, sharedCardPath, holderCardPath, cardDetailRequest };
