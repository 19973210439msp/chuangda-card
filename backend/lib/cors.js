function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function allowedOrigins() {
  const configured = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
  if (configured.length) return configured;
  const base = normalizeOrigin(process.env.PUBLIC_BASE_URL || '');
  if (base) return [base];
  return [];
}

function allowedHosts() {
  return allowedOrigins().map((origin) => {
    try { return new URL(origin).hostname.toLowerCase(); } catch { return ''; }
  }).filter(Boolean);
}

function requestHost(req) {
  const raw = String((req.headers && req.headers.host) || '').trim();
  if (!raw) return '';
  try { return new URL('http://' + raw).hostname.toLowerCase(); } catch { return ''; }
}

function localDevOrigin(origin) {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function originAllowed(origin) {
  const value = normalizeOrigin(origin);
  if (!value) return false;
  if (allowedOrigins().includes(value)) return true;
  return localDevOrigin(value);
}

function miniProgramReferer(req) {
  const appid = (process.env.WECHAT_APPID || '').trim();
  const referer = String((req.headers && (req.headers.referer || req.headers.referrer)) || '').trim();
  if (!appid || !referer) return false;
  try {
    const url = new URL(referer);
    return url.protocol === 'https:'
      && url.hostname === 'servicewechat.com'
      && (url.pathname === '/' + appid || url.pathname.startsWith('/' + appid + '/'));
  } catch {
    return false;
  }
}

function accessDecision(req) {
  const origin = normalizeOrigin(req.headers && req.headers.origin);
  if (process.env.NODE_ENV === 'production') {
    const hosts = allowedHosts();
    if (!hosts.length || !hosts.includes(requestHost(req))) return { allow: false, reflect: false };
  }
  if (!origin) return { allow: true, reflect: false };
  if (originAllowed(origin)) return { allow: true, reflect: true };
  if (miniProgramReferer(req)) return { allow: true, reflect: false };
  return { allow: false, reflect: false };
}

function applyCors(req, res) {
  const decision = accessDecision(req);
  if (decision.reflect) {
    res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(req.headers.origin));
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  return decision;
}

module.exports = {
  allowedOrigins,
  accessDecision,
  applyCors,
};
