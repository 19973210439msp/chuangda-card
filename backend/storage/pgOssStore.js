const config = require('../config');
const { seedData } = require('../lib/person');

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  const existing = await query('SELECT id FROM company_settings WHERE id = $1', ['default']);
  if (existing.rowCount) return;
  const seed = seedData();
  await query(
    'INSERT INTO company_settings (id, data) VALUES ($1, $2::jsonb)',
    ['default', JSON.stringify(seed.company)]
  );
  for (const person of seed.people) {
    await insertPerson(person);
  }
  for (const view of seed.views) {
    await insertView(view);
  }
}

function rowToPerson(row) {
  return row ? row.data : null;
}

async function insertPerson(person) {
  await query(
    `INSERT INTO people (id, kind, employee_no, openid, owner_id, status, data, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      person.id,
      person.kind,
      person.employeeNo || '',
      person.openid || '',
      person.ownerId || '',
      person.status,
      JSON.stringify(person),
      person.createdAt,
      person.updatedAt,
    ]
  );
  return person;
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
  async getCompany() {
    const result = await query('SELECT data FROM company_settings WHERE id = $1', ['default']);
    return result.rows[0] ? result.rows[0].data : null;
  },
  async saveCompany(company) {
    await query(
      `INSERT INTO company_settings (id, data, updated_at) VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(company)]
    );
    return company;
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
    const result = await query(
      `UPDATE people
       SET kind = $2, employee_no = $3, openid = $4, owner_id = $5, status = $6, data = $7::jsonb, updated_at = $8
       WHERE id = $1`,
      [
        id,
        person.kind,
        person.employeeNo || '',
        person.openid || '',
        person.ownerId || '',
        person.status,
        JSON.stringify(person),
        person.updatedAt,
      ]
    );
    return result.rowCount ? person : null;
  },
  async deletePerson(id) {
    await query('DELETE FROM views WHERE card_id = $1', [id]);
    const result = await query('DELETE FROM people WHERE id = $1', [id]);
    return result.rowCount > 0;
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
      : await query('SELECT data FROM views ORDER BY started_at DESC LIMIT 500');
    return result.rows.map((row) => row.data);
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
      'INSERT INTO sessions (token, user_id, role, created_at) VALUES ($1,$2,$3,$4)',
      [session.token, session.userId, session.role, session.createdAt]
    );
    return session;
  },
  async getSession(token) {
    const result = await query('SELECT token, user_id, role, created_at FROM sessions WHERE token = $1', [token]);
    const row = result.rows[0];
    if (!row) return null;
    return { token: row.token, userId: row.user_id, role: row.role, createdAt: row.created_at };
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
