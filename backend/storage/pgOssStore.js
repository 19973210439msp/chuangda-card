const config = require('../config');
const { seedData, demoSeedAllowed } = require('../lib/person');
const { stripAvatarPortrait, avatarPortraitOssKeys } = require('../lib/media');

let pool;
let oss;
let readyPromise;

function pointerBody(userId, cardId) {
  return { userId, cardId };
}

function pointerKey(userId, cardId) {
  return `holders/${userId}/${cardId}.json`;
}

function create() {
  config.assertPgOssConfig();
  const { Pool } = require('pg');
  const OSS = require('ali-oss');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  const ossOptions = {
    region: process.env.OSS_REGION,
    bucket: process.env.OSS_BUCKET,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  };
  if ((process.env.OSS_ENDPOINT || '').trim()) ossOptions.endpoint = process.env.OSS_ENDPOINT.trim();
  oss = new OSS(ossOptions);
  readyPromise = null;
  return store;
}

async function query(text, params) {
  return pool.query(text, params);
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      employee_no TEXT,
      openid TEXT,
      owner_id TEXT,
      status TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS people_openid_idx ON people (openid);
    CREATE INDEX IF NOT EXISTS people_employee_no_idx ON people (employee_no);
    CREATE TABLE IF NOT EXISTS views (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      data JSONB NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS views_card_idx ON views (card_id, started_at);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      secret_stamp TEXT
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS secret_stamp TEXT;
    UPDATE sessions SET expires_at = created_at + interval '12 hours'
      WHERE expires_at IS NULL AND role = 'admin';
    UPDATE sessions SET expires_at = created_at + interval '7 days'
      WHERE expires_at IS NULL AND role <> 'admin';
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS account_links (
      openid TEXT NOT NULL,
      person_id TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (openid, person_id)
    );
    CREATE TABLE IF NOT EXISTS card_applications (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      status TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS card_applications_company_idx ON card_applications (company_id, status);
    CREATE TABLE IF NOT EXISTS verify_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      target TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await migrateDropAvatarPortrait();
  const existing = await query('SELECT id FROM company_settings WHERE id = $1', ['default']);
  if (existing.rowCount) return;
  const seed = seedData();
  await query(
    'INSERT INTO company_settings (id, data) VALUES ($1, $2::jsonb)',
    ['default', JSON.stringify(seed.company)]
  );
  if (!demoSeedAllowed()) return;
  for (const person of seed.people) {
    await insertPerson(person);
  }
  for (const view of seed.views) {
    await insertView(view);
  }
}

async function migrateDropAvatarPortrait() {
  const result = await query(
    `SELECT id, data FROM people WHERE data ? 'avatar' OR data ? 'portrait'`
  );
  for (const row of result.rows) {
    const person = row.data || {};
    for (const key of avatarPortraitOssKeys(person)) {
      try {
        await oss.delete(key);
      } catch (err) {
        if (!(err && (err.status === 404 || err.code === 'NoSuchKey'))) {
          console.error('删除头像/形象照 OSS 对象失败', key, err.message || err);
        }
      }
    }
    const cleaned = stripAvatarPortrait(person);
    await query(
      'UPDATE people SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [row.id, JSON.stringify(cleaned)]
    );
  }
}

function rowToPerson(row) {
  return row ? stripAvatarPortrait(row.data) : null;
}

async function insertPerson(person) {
  const cleaned = stripAvatarPortrait(person);
  await query(
    `INSERT INTO people (id, kind, employee_no, openid, owner_id, status, data, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      cleaned.id,
      cleaned.kind,
      cleaned.employeeNo || '',
      cleaned.openid || '',
      cleaned.ownerId || '',
      cleaned.status,
      JSON.stringify(cleaned),
      cleaned.createdAt,
      cleaned.updatedAt,
    ]
  );
  return cleaned;
}

async function insertView(view) {
  await query(
    'INSERT INTO views (id, card_id, data, started_at) VALUES ($1,$2,$3::jsonb,$4)',
    [view.id, view.cardId, JSON.stringify(view), view.startedAt]
  );
  return view;
}

const store = {
  driver: 'pg-oss',
  async ready() {
    if (!readyPromise) readyPromise = ensureSchema();
    await readyPromise;
  },
  async getCompany(id) {
    const companyId = id || 'default';
    const result = await query('SELECT data FROM company_settings WHERE id = $1', [companyId]);
    return result.rows[0] ? result.rows[0].data : null;
  },
  async saveCompany(company) {
    return this.saveCompanyRecord('default', company);
  },
  async saveCompanyRecord(id, company) {
    await query(
      `INSERT INTO company_settings (id, data, updated_at) VALUES ($2, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(company), id || 'default']
    );
    return company;
  },
  async listCompanies() {
    const result = await query('SELECT id, data FROM company_settings ORDER BY id ASC');
    return result.rows.map((row) => ({ id: row.id, ...(row.data || {}) }));
  },
  async getAdmin(id) {
    const result = await query('SELECT data FROM admins WHERE id = $1', [id]);
    return result.rows[0] ? result.rows[0].data : null;
  },
  async findAdminByUsername(username) {
    const result = await query('SELECT data FROM admins WHERE username = $1', [username]);
    return result.rows[0] ? result.rows[0].data : null;
  },
  async saveAdmin(admin) {
    await query(
      `INSERT INTO admins (id, username, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, data = EXCLUDED.data, updated_at = NOW()`,
      [admin.id, admin.username, JSON.stringify(admin)]
    );
    return admin;
  },
  async listPeople({ kind } = {}) {
    const result = kind
      ? await query('SELECT data FROM people WHERE kind = $1 ORDER BY created_at ASC', [kind])
      : await query('SELECT data FROM people ORDER BY created_at ASC');
    return result.rows.map(rowToPerson);
  },
  async getPerson(id) {
    const result = await query('SELECT data FROM people WHERE id = $1', [id]);
    return rowToPerson(result.rows[0]);
  },
  async findEmployeeByOpenid(openid) {
    const result = await query(
      `SELECT data FROM people WHERE kind = 'employee' AND openid = $1 LIMIT 1`,
      [openid]
    );
    return rowToPerson(result.rows[0]);
  },
  async findByEmployeeNo(employeeNo) {
    if (!employeeNo) return null;
    const result = await query(
      `SELECT data FROM people WHERE kind = 'employee' AND employee_no = $1 LIMIT 1`,
      [employeeNo]
    );
    return rowToPerson(result.rows[0]);
  },
  insertPerson,
  async updatePerson(id, person) {
    const cleaned = stripAvatarPortrait(person);
    const result = await query(
      `UPDATE people
       SET kind = $2, employee_no = $3, openid = $4, owner_id = $5, status = $6, data = $7::jsonb, updated_at = $8
       WHERE id = $1`,
      [
        id,
        cleaned.kind,
        cleaned.employeeNo || '',
        cleaned.openid || '',
        cleaned.ownerId || '',
        cleaned.status,
        JSON.stringify(cleaned),
        cleaned.updatedAt,
      ]
    );
    return result.rowCount ? cleaned : null;
  },
  async deleteHolderRefsForCard(cardId) {
    const suffix = '/' + cardId + '.json';
    const prefix = 'holders/';
    let marker;
    do {
      const listed = await oss.list({ prefix, marker, 'max-keys': 1000 });
      const names = (listed.objects || [])
        .map((object) => object.name || '')
        .filter((name) => name.endsWith(suffix));
      if (names.length) await oss.deleteMulti(names);
      marker = listed.isTruncated ? listed.nextMarker : null;
    } while (marker);
  },
  async deleteUploadsForUser(userId) {
    const owner = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!owner) return;
    const prefix = 'uploads/' + owner + '/';
    let marker;
    do {
      const listed = await oss.list({ prefix, marker, 'max-keys': 1000 });
      const names = (listed.objects || []).map((object) => object.name).filter(Boolean);
      if (names.length) await oss.deleteMulti(names);
      marker = listed.isTruncated ? listed.nextMarker : null;
    } while (marker);
  },
  async deletePerson(id) {
    await query('DELETE FROM views WHERE card_id = $1', [id]);
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await query('DELETE FROM verify_codes WHERE user_id = $1', [id]);
    await store.deleteHolderRefs(id);
    await store.deleteHolderRefsForCard(id);
    await store.deleteUploadsForUser(id);
    const result = await query('DELETE FROM people WHERE id = $1', [id]);
    return result.rowCount > 0;
  },
  async deleteApplicationsForPerson(personId) {
    const result = await query('DELETE FROM card_applications WHERE person_id = $1', [personId]);
    return result.rowCount;
  },
  async purgeExpiredCodes({ olderThan } = {}) {
    const cutoff = olderThan || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await query(
      'DELETE FROM verify_codes WHERE used = TRUE OR expires_at <= $1',
      [cutoff]
    );
    return result.rowCount;
  },
  async listHolderRefs(userId) {
    const prefix = `holders/${userId}/`;
    const refs = [];
    let marker;
    do {
      const listed = await oss.list({ prefix, marker, 'max-keys': 1000 });
      for (const object of listed.objects || []) {
        const name = object.name || '';
        const cardId = name.slice(prefix.length).replace(/\.json$/, '');
        if (!cardId || cardId.indexOf('/') >= 0) continue;
        refs.push({
          userId,
          cardId,
          createdAt: object.lastModified,
        });
      }
      marker = listed.isTruncated ? listed.nextMarker : null;
    } while (marker);
    return refs;
  },
  async hasHolderRef(userId, cardId) {
    try {
      await oss.head(pointerKey(userId, cardId));
      return true;
    } catch (err) {
      if (err.status === 404 || err.code === 'NoSuchKey') return false;
      throw err;
    }
  },
  async deleteHolderRefs(userId) {
    const prefix = `holders/${userId}/`;
    let marker;
    do {
      const listed = await oss.list({ prefix, marker, 'max-keys': 1000 });
      const names = (listed.objects || []).map((object) => object.name);
      if (names.length) await oss.deleteMulti(names);
      marker = listed.isTruncated ? listed.nextMarker : null;
    } while (marker);
  },
  async reassignHolderUser(fromId, toId) {
    const refs = await store.listHolderRefs(fromId);
    for (const ref of refs) {
      await store.putHolderRef({ userId: toId, cardId: ref.cardId, createdAt: ref.createdAt || new Date().toISOString() });
    }
    await store.deleteHolderRefs(fromId);
  },
  async reassignViews(fromCardId, toCardId) {
    const views = await store.listViews({ cardId: fromCardId });
    for (const view of views) {
      view.cardId = toCardId;
      await store.updateView(view.id, view);
    }
  },
  async putPublicObject(key, buffer, contentType) {
    await oss.put(key, buffer, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
      },
    });
    const base = (process.env.OSS_PUBLIC_BASE || '').trim().replace(/\/$/, '');
    if (base) return base + '/' + key;
    return '/api/files/' + key;
  },
  async getObject(key) {
    const result = await oss.get(key);
    const headers = result.res && result.res.headers ? result.res.headers : {};
    return {
      content: result.content,
      contentType: headers['content-type'] || 'application/octet-stream',
    };
  },
  async putHolderRef({ userId, cardId, createdAt, overwrite }) {
    const key = pointerKey(userId, cardId);
    if (!overwrite) {
      const exists = await store.hasHolderRef(userId, cardId);
      if (exists) return { userId, cardId, createdAt, already: true };
    }
    await oss.put(key, Buffer.from(JSON.stringify(pointerBody(userId, cardId))));
    return { userId, cardId, createdAt, already: false };
  },
  async deleteHolderRef(userId, cardId) {
    const key = pointerKey(userId, cardId);
    const exists = await store.hasHolderRef(userId, cardId);
    if (!exists) return false;
    await oss.delete(key);
    return true;
  },
  async listViews({ cardId } = {}) {
    const result = cardId
      ? await query('SELECT data FROM views WHERE card_id = $1 ORDER BY started_at DESC', [cardId])
      : await query('SELECT data FROM views ORDER BY started_at DESC');
    return result.rows.map((row) => row.data);
  },
  async summarizeViews({ cardIds, from, to } = {}) {
    if (Array.isArray(cardIds) && !cardIds.length) return [];
    const params = [];
    const where = [];
    if (Array.isArray(cardIds)) {
      params.push(cardIds);
      where.push('card_id = ANY($' + params.length + ')');
    }
    if (from) {
      params.push(from);
      where.push('started_at >= $' + params.length + '::date');
    }
    if (to) {
      params.push(to);
      where.push('started_at < ($' + params.length + '::date + interval \'1 day\')');
    }
    const sql = `
      SELECT
        card_id AS "cardId",
        COUNT(*)::int AS views,
        COUNT(DISTINCT NULLIF(data->>'visitorId', ''))::int AS visitors,
        COALESCE(ROUND(AVG(COALESCE((data->>'durationSec')::numeric, 0))), 0)::int AS "avgDurationSec",
        COUNT(*) FILTER (
          WHERE COALESCE(data->'exchange'->>'phone', '') <> ''
             OR COALESCE(data->'exchange'->>'name', '') <> ''
        )::int AS exchanges
      FROM views
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY card_id`;
    const result = await query(sql, params);
    return result.rows;
  },
  async listViewsPage({ cardId, cardIds, from, to, limit = 50, offset = 0 } = {}) {
    const params = [];
    const where = [];
    if (cardId) {
      params.push(cardId);
      where.push('card_id = $' + params.length);
    }
    if (Array.isArray(cardIds)) {
      params.push(cardIds);
      where.push('card_id = ANY($' + params.length + ')');
    }
    if (from) {
      params.push(from);
      where.push('started_at >= $' + params.length + '::date');
    }
    if (to) {
      params.push(to);
      where.push('started_at < ($' + params.length + '::date + interval \'1 day\')');
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countResult = await query('SELECT COUNT(*)::int AS total FROM views ' + whereSql, params);
    const total = countResult.rows[0].total;
    params.push(limit);
    params.push(offset);
    const result = await query(
      'SELECT data FROM views ' + whereSql + ' ORDER BY started_at DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length,
      params
    );
    return {
      items: result.rows.map((row) => row.data),
      total,
      limit,
      offset,
    };
  },
  async getView(id) {
    const result = await query('SELECT data FROM views WHERE id = $1', [id]);
    return result.rows[0] ? result.rows[0].data : null;
  },
  insertView,
  async updateView(id, view) {
    const result = await query(
      'UPDATE views SET card_id = $2, data = $3::jsonb, started_at = $4 WHERE id = $1',
      [id, view.cardId, JSON.stringify(view), view.startedAt]
    );
    return result.rowCount ? view : null;
  },
  async createSession(session) {
    await query(
      'INSERT INTO sessions (token, user_id, role, created_at, expires_at, secret_stamp) VALUES ($1,$2,$3,$4,$5,$6)',
      [session.token, session.userId, session.role, session.createdAt, session.expiresAt || null, session.secretStamp || '']
    );
    return session;
  },
  async getSession(token) {
    const result = await query(
      'SELECT token, user_id, role, created_at, expires_at, secret_stamp FROM sessions WHERE token = $1',
      [token]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      token: row.token,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      secretStamp: row.secret_stamp || '',
    };
  },
  async deleteSession(token) {
    await query('DELETE FROM sessions WHERE token = $1', [token]);
  },
  async deleteSessionsForUser(userId) {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  },
  async reassignSessionUser(token, userId) {
    const result = await query('UPDATE sessions SET user_id = $2 WHERE token = $1', [token, userId]);
    return result.rowCount > 0;
  },
  async listAccountLinks(openid) {
    const result = await query('SELECT data FROM account_links WHERE openid = $1 ORDER BY updated_at DESC', [openid]);
    return result.rows.map((row) => row.data);
  },
  async saveAccountLink(row) {
    await query(
      `INSERT INTO account_links (openid, person_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (openid, person_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [row.openid, row.personId, JSON.stringify(row)]
    );
    return row;
  },
  async listApplications() {
    const result = await query('SELECT data FROM card_applications ORDER BY updated_at DESC');
    return result.rows.map((row) => row.data);
  },
  async saveApplication(row) {
    await query(
      `INSERT INTO card_applications (id, person_id, card_id, company_id, status, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         person_id = EXCLUDED.person_id,
         card_id = EXCLUDED.card_id,
         company_id = EXCLUDED.company_id,
         status = EXCLUDED.status,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [row.id, row.personId, row.cardId, row.companyId, row.status, JSON.stringify(row)]
    );
    return row;
  },
  async insertCode(row) {
    await query(
      `INSERT INTO verify_codes (id, user_id, channel, target, code_hash, expires_at, used, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.userId, row.channel, row.target, row.codeHash, row.expiresAt, row.used, row.createdAt]
    );
    return row;
  },
  async findValidCode({ userId, channel, target, codeHash, now }) {
    const result = await query(
      `SELECT id, user_id, channel, target, code_hash, expires_at, used, created_at
       FROM verify_codes
       WHERE user_id = $1 AND channel = $2 AND target = $3 AND code_hash = $4
         AND used = FALSE AND expires_at > $5
       LIMIT 1`,
      [userId, channel, target, codeHash, now]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      target: row.target,
      codeHash: row.code_hash,
      expiresAt: row.expires_at,
      used: row.used,
      createdAt: row.created_at,
    };
  },
  async markCodeUsed(id) {
    await query('UPDATE verify_codes SET used = TRUE WHERE id = $1', [id]);
  },
  async countRecentCodes({ userId, channel, since }) {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM verify_codes WHERE user_id = $1 AND channel = $2 AND created_at >= $3',
      [userId, channel, since]
    );
    return result.rows[0].count;
  },
};

module.exports = { create, pointerBody, pointerKey };
