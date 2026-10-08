const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { seedData } = require('../lib/person');

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
    if (existing) return existing;
    const seeded = seedData();
    await writeFile(seeded);
    return seeded;
  });
}

async function mutate(work) {
  return locked(async () => {
    const data = (await readFile()) || seedData();
    const result = await work(data);
    await writeFile(data);
    return result;
  });
}

async function snapshot() {
  return locked(async () => (await readFile()) || seedData());
}

function matchKind(person, kind) {
  return !kind || person.kind === kind;
}

const store = {
  driver: 'json',
  async ready() {
    await ready();
  },
  async getCompany() {
    const data = await snapshot();
    return data.company;
  },
  async saveCompany(company) {
    return mutate((data) => {
      data.company = company;
      return company;
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
      data.people.push(person);
      return person;
    });
  },
  async updatePerson(id, person) {
    return mutate((data) => {
      const index = data.people.findIndex((item) => item.id === id);
      if (index < 0) return null;
      data.people[index] = person;
      return person;
    });
  },
  async deletePerson(id) {
    return mutate((data) => {
      const before = data.people.length;
      data.people = data.people.filter((person) => person.id !== id);
      data.holders = data.holders.filter((item) => item.cardId !== id && item.userId !== id);
      return data.people.length !== before;
    });
  },
  async listHolderRefs(userId) {
    const data = await snapshot();
    return data.holders
      .filter((item) => item.userId === userId)
      .map((item) => ({ userId: item.userId, cardId: item.cardId, createdAt: item.createdAt }));
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
  async putHolderRef({ userId, cardId, createdAt }) {
    return mutate((data) => {
      const existing = data.holders.find((item) => item.userId === userId && item.cardId === cardId);
      if (existing) return { userId, cardId, createdAt: existing.createdAt, already: true };
      const row = { userId, cardId, createdAt };
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
  async listViews({ cardId } = {}) {
    const data = await snapshot();
    return data.views.filter((view) => !cardId || view.cardId === cardId);
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
  async insertCode(row) {
    return mutate((data) => {
      data.codes.push(row);
      return row;
    });
  },
  async findValidCode({ userId, channel, target, codeHash, now }) {
    const data = await snapshot();
    return data.codes.find((row) => (
      row.userId === userId
      && row.channel === channel
      && row.target === target
      && row.codeHash === codeHash
      && !row.used
      && row.expiresAt > now
    )) || null;
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
