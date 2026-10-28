const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { initialStoreData } = require('../lib/person');
const {
  stripAvatarPortrait,
  uploadBasename,
  avatarPortraitUploadNames,
} = require('../lib/media');

function localUploadNames(person) {
  const names = new Set();
  if (!person) return names;
  for (const name of avatarPortraitUploadNames(person)) names.add(name);
  for (const file of person.attachments || []) {
    const name = uploadBasename(file && file.url);
    if (name) names.add(name);
  }
  return names;
}

async function purgeAvatarPortraitFiles(people) {
  const root = config.uploadDir();
  const names = new Set();
  for (const person of people || []) {
    for (const name of avatarPortraitUploadNames(person)) names.add(name);
  }
  await Promise.all(Array.from(names).map((name) => fs.rm(path.join(root, name), { force: true })));
}

let chain = Promise.resolve();

function locked(work) {
  const run = chain.then(work, work);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function readFile() {
  const file = config.dataFile();
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeFile(data) {
  const file = config.dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rm(file, { force: true });
  await fs.rename(tmp, file);
}

async function ready() {
  return locked(async () => {
    const existing = await readFile();
    if (!existing) {
      const seeded = initialStoreData();
      await writeFile(seeded);
      return seeded;
    }
    const dirty = (existing.people || []).some(
      (person) => person && ('avatar' in person || 'portrait' in person)
    );
    if (!dirty) return existing;
    await purgeAvatarPortraitFiles(existing.people);
    existing.people = (existing.people || []).map(stripAvatarPortrait);
    await writeFile(existing);
    return existing;
  });
}

async function mutate(work) {
  return locked(async () => {
    const data = (await readFile()) || initialStoreData();
    const result = await work(data);
    await writeFile(data);
    return result;
  });
}

async function snapshot() {
  return locked(async () => (await readFile()) || initialStoreData());
}

function matchKind(person, kind) {
  return !kind || person.kind === kind;
}

const store = {
  driver: 'json',
  async ready() {
    await ready();
  },
  async getCompany(id) {
    const data = await snapshot();
    if (!id || id === 'default') return data.company;
    return (data.companies && data.companies[id]) || null;
  },
  async saveCompany(company) {
    return mutate((data) => {
      data.company = company;
      if (!data.companies) data.companies = {};
      data.companies.default = company;
      return company;
    });
  },
  async saveCompanyRecord(id, company) {
    return mutate((data) => {
      if (!data.companies) data.companies = { default: data.company };
      data.companies[id] = company;
      if (!id || id === 'default') data.company = company;
      return company;
    });
  },
  async listCompanies() {
    const data = await snapshot();
    const companies = data.companies || { default: data.company };
    return Object.keys(companies).filter((id) => companies[id]).map((id) => ({ id, ...companies[id] }));
  },
  async getAdmin(id) {
    const data = await snapshot();
    return (data.admins || []).find((item) => item.id === id) || null;
  },
  async findAdminByUsername(username) {
    const data = await snapshot();
    return (data.admins || []).find((item) => item.username === username) || null;
  },
  async saveAdmin(admin) {
    return mutate((data) => {
      if (!Array.isArray(data.admins)) data.admins = [];
      const index = data.admins.findIndex((item) => item.id === admin.id);
      if (index >= 0) data.admins[index] = admin;
      else data.admins.push(admin);
      return admin;
    });
  },
  async listPeople({ kind } = {}) {
    const data = await snapshot();
    return data.people.filter((person) => matchKind(person, kind));
  },
  async getPerson(id) {
    const data = await snapshot();
    return data.people.find((person) => person.id === id) || null;
  },
  async findEmployeeByOpenid(openid) {
    const data = await snapshot();
    return data.people.find((person) => person.kind === 'employee' && person.openid === openid) || null;
  },
  async findByEmployeeNo(employeeNo) {
    if (!employeeNo) return null;
    const data = await snapshot();
    return data.people.find((person) => person.kind === 'employee' && person.employeeNo === employeeNo) || null;
  },
  async insertPerson(person) {
    return mutate((data) => {
      const cleaned = stripAvatarPortrait(person);
      data.people.push(cleaned);
      return cleaned;
    });
  },
  async updatePerson(id, person) {
    return mutate((data) => {
      const index = data.people.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const cleaned = stripAvatarPortrait(person);
      data.people[index] = cleaned;
      return cleaned;
    });
  },
  async deletePerson(id) {
    const removed = await mutate((data) => {
      const person = data.people.find((item) => item.id === id) || null;
      const before = data.people.length;
      data.people = data.people.filter((item) => item.id !== id);
      data.holders = data.holders.filter((item) => item.cardId !== id && item.userId !== id);
      data.views = data.views.filter((view) => view.cardId !== id);
      data.sessions = data.sessions.filter((session) => session.userId !== id);
      data.codes = data.codes.filter((row) => row.userId !== id);
      data.accountLinks = (data.accountLinks || []).filter((row) => row.personId !== id);
      data.certifications = (data.certifications || []).filter((row) => row.personId !== id);
      return {
        ok: data.people.length !== before,
        files: Array.from(localUploadNames(person)),
      };
    });
    if (removed && removed.files && removed.files.length) {
      const root = config.uploadDir();
      await Promise.all(removed.files.map((name) => fs.rm(path.join(root, name), { force: true })));
    }
    return !!(removed && removed.ok);
  },
  async purgeExpiredCodes({ olderThan } = {}) {
    const cutoff = olderThan || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return mutate((data) => {
      const before = data.codes.length;
      data.codes = data.codes.filter((row) => !row.used && row.expiresAt > cutoff);
      return before - data.codes.length;
    });
  },
  async listHolderRefs(userId) {
    const data = await snapshot();
    return data.holders
      .filter((item) => item.userId === userId)
      .map((item) => ({
        userId: item.userId,
        cardId: item.cardId,
        shareCardId: item.shareCardId || '',
        createdAt: item.createdAt,
      }));
  },
  async hasHolderRef(userId, cardId) {
    const data = await snapshot();
    return data.holders.some((item) => item.userId === userId && item.cardId === cardId);
  },
  async reassignHolderUser(fromId, toId) {
    return mutate((data) => {
      const kept = new Set(data.holders.filter((item) => item.userId === toId).map((item) => item.cardId));
      data.holders = data.holders.filter((item) => {
        if (item.userId !== fromId) return true;
        if (kept.has(item.cardId)) return false;
        item.userId = toId;
        kept.add(item.cardId);
        return true;
      });
    });
  },
  async reassignViews(fromCardId, toCardId) {
    return mutate((data) => {
      data.views.forEach((view) => {
        if (view.cardId === fromCardId) view.cardId = toCardId;
      });
    });
  },
  async putHolderRef({ userId, cardId, shareCardId, createdAt, overwrite }) {
    return mutate((data) => {
      const existing = data.holders.find((item) => item.userId === userId && item.cardId === cardId);
      if (existing && !overwrite) return { ...existing, already: true };
      if (existing) {
        existing.shareCardId = shareCardId || existing.shareCardId || '';
        existing.createdAt = createdAt || existing.createdAt;
        return { ...existing, already: false };
      }
      const row = { userId, cardId, shareCardId: shareCardId || '', createdAt };
      data.holders.push(row);
      return { ...row, already: false };
    });
  },
  async deleteHolderRef(userId, cardId) {
    return mutate((data) => {
      const before = data.holders.length;
      data.holders = data.holders.filter((item) => !(item.userId === userId && item.cardId === cardId));
      return before !== data.holders.length;
    });
  },
  async listViews({ cardId, shareCardIds } = {}) {
    const data = await snapshot();
    const shareAllow = Array.isArray(shareCardIds) ? new Set(shareCardIds) : null;
    return data.views.filter((view) => (
      (!cardId || view.cardId === cardId)
      && (!shareAllow || shareAllow.has(view.shareCardId))
    ));
  },
  async summarizeViews({ cardIds, shareCardIds, from, to } = {}) {
    const data = await snapshot();
    if (Array.isArray(cardIds) && !cardIds.length) return [];
    if (Array.isArray(shareCardIds) && !shareCardIds.length) return [];
    const allow = Array.isArray(cardIds) ? new Set(cardIds) : null;
    const shareAllow = Array.isArray(shareCardIds) ? new Set(shareCardIds) : null;
    const groups = new Map();
    for (const view of data.views) {
      if (allow && !allow.has(view.cardId)) continue;
      if (shareAllow && !shareAllow.has(view.shareCardId)) continue;
      const startedAt = String(view.startedAt || '');
      if (from && startedAt < from) continue;
      if (to && startedAt >= to) continue;
      let group = groups.get(view.cardId);
      if (!group) {
        group = { cardId: view.cardId, views: 0, visitors: new Set(), totalDuration: 0, exchanges: 0 };
        groups.set(view.cardId, group);
      }
      group.views += 1;
      if (view.visitorId) group.visitors.add(view.visitorId);
      group.totalDuration += Number(view.durationSec) || 0;
      if (view.exchange && (view.exchange.phone || view.exchange.name)) group.exchanges += 1;
    }
    return Array.from(groups.values()).map((group) => ({
      cardId: group.cardId,
      views: group.views,
      visitors: group.visitors.size,
      avgDurationSec: group.views ? Math.round(group.totalDuration / group.views) : 0,
      exchanges: group.exchanges,
    }));
  },
  async listViewsPage({ cardId, cardIds, shareCardIds, from, to, limit = 50, offset = 0 } = {}) {
    const data = await snapshot();
    const allow = Array.isArray(cardIds) ? new Set(cardIds) : null;
    const shareAllow = Array.isArray(shareCardIds) ? new Set(shareCardIds) : null;
    const filtered = data.views
      .filter((view) => {
        if (cardId && view.cardId !== cardId) return false;
        if (allow && !allow.has(view.cardId)) return false;
        if (shareAllow && !shareAllow.has(view.shareCardId)) return false;
        const startedAt = String(view.startedAt || '');
        if (from && startedAt < from) return false;
        if (to && startedAt >= to) return false;
        return true;
      })
      .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  },
  async getView(id) {
    const data = await snapshot();
    return data.views.find((view) => view.id === id) || null;
  },
  async insertView(view) {
    return mutate((data) => {
      data.views.push(view);
      return view;
    });
  },
  async updateView(id, view) {
    return mutate((data) => {
      const index = data.views.findIndex((item) => item.id === id);
      if (index < 0) return null;
      data.views[index] = view;
      return view;
    });
  },
  async createSession(session) {
    return mutate((data) => {
      data.sessions.push(session);
      return session;
    });
  },
  async getSession(token) {
    const data = await snapshot();
    return data.sessions.find((session) => session.token === token) || null;
  },
  async deleteSession(token) {
    return mutate((data) => {
      data.sessions = data.sessions.filter((session) => session.token !== token);
    });
  },
  async deleteSessionsForUser(userId) {
    return mutate((data) => {
      data.sessions = data.sessions.filter((session) => session.userId !== userId);
    });
  },
  async reassignSessionUser(token, userId) {
    return mutate((data) => {
      const session = data.sessions.find((item) => item.token === token);
      if (!session) return null;
      session.userId = userId;
      return session;
    });
  },
  async listAccountLinks(openid) {
    const data = await snapshot();
    return (data.accountLinks || []).filter((item) => item.openid === openid);
  },
  async saveAccountLink(row) {
    return mutate((data) => {
      if (!Array.isArray(data.accountLinks)) data.accountLinks = [];
      const index = data.accountLinks.findIndex((item) => item.openid === row.openid && item.personId === row.personId);
      if (index >= 0) data.accountLinks[index] = { ...data.accountLinks[index], ...row };
      else data.accountLinks.push(row);
      return row;
    });
  },
  async listApplications() {
    const data = await snapshot();
    return Array.isArray(data.applications) ? data.applications : [];
  },
  async saveApplication(row) {
    return mutate((data) => {
      if (!Array.isArray(data.applications)) data.applications = [];
      const index = data.applications.findIndex((item) => item.id === row.id);
      if (index >= 0) data.applications[index] = row;
      else data.applications.push(row);
      return row;
    });
  },
  async listCertifications() {
    const data = await snapshot();
    return Array.isArray(data.certifications) ? data.certifications : [];
  },
  async saveCertification(row) {
    return mutate((data) => {
      if (!Array.isArray(data.certifications)) data.certifications = [];
      const index = data.certifications.findIndex((item) => (
        item.personId === row.personId && item.companyId === row.companyId
      ));
      if (index >= 0) data.certifications[index] = row;
      else data.certifications.push(row);
      return row;
    });
  },
  async deleteCertificationsForPerson(personId) {
    return mutate((data) => {
      if (!Array.isArray(data.certifications)) data.certifications = [];
      const before = data.certifications.length;
      data.certifications = data.certifications.filter((item) => item.personId !== personId);
      return before - data.certifications.length;
    });
  },
  async deleteApplicationsForPerson(personId) {
    return mutate((data) => {
      if (!Array.isArray(data.applications)) data.applications = [];
      const before = data.applications.length;
      data.applications = data.applications.filter((item) => item.personId !== personId);
      return before - data.applications.length;
    });
  },
  async insertCode(row) {
    return mutate((data) => {
      data.codes.push(row);
      return row;
    });
  },
  async reserveCode(row, { userId, channel, since }) {
    return mutate((data) => {
      const blocked = data.codes.some((item) => (
        item.channel === channel
        && item.createdAt >= since
        && item.userId === userId
      ));
      if (blocked) return false;
      data.codes.push(row);
      return true;
    });
  },
  async deleteCode(id) {
    return mutate((data) => {
      const before = data.codes.length;
      data.codes = data.codes.filter((row) => row.id !== id);
      return before !== data.codes.length;
    });
  },
  async findActiveCode({ userId, channel, target, now }) {
    const data = await snapshot();
    return data.codes
      .filter((row) => (
        row.userId === userId
        && row.channel === channel
        && row.target === target
        && !row.used
        && row.expiresAt > now
      ))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  },
  async recordCodeFailure(id, maxAttempts) {
    return mutate((data) => {
      const row = data.codes.find((item) => item.id === id);
      if (!row || row.used) return row || null;
      row.failedAttempts = (Number(row.failedAttempts) || 0) + 1;
      if (row.failedAttempts >= maxAttempts) row.used = true;
      return row;
    });
  },
  async markCodeUsed(id) {
    return mutate((data) => {
      const row = data.codes.find((item) => item.id === id);
      if (row) row.used = true;
      return row || null;
    });
  },
  async countRecentCodes({ userId, channel, since }) {
    const data = await snapshot();
    return data.codes.filter((row) => row.userId === userId && row.channel === channel && row.createdAt >= since).length;
  },
};

module.exports = store;
