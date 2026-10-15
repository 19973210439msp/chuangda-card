/**
 * 头像 / 形象照已下线。工具函数用于：
 * - 从 person JSON 去掉 avatar、portrait
 * - 从 URL 解析本地 uploads 文件名或 OSS object key，便于删除孤儿文件
 */

function stripAvatarPortrait(person) {
  if (!person || typeof person !== 'object') return person;
  if (!('avatar' in person) && !('portrait' in person)) return person;
  const next = { ...person };
  delete next.avatar;
  delete next.portrait;
  return next;
}

function uploadBasename(url) {
  if (!url || typeof url !== 'string') return '';
  const match = url.match(/\/uploads\/([^/?#]+)$/);
  if (!match) return '';
  const name = match[1];
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return '';
  return name;
}

function ossObjectKey(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const apiMatch = trimmed.match(/\/api\/files\/(uploads\/[^?#]+)/);
  if (apiMatch) return apiMatch[1];

  const pathMatch = trimmed.match(/(uploads\/[A-Za-z0-9_./-]+)/);
  if (pathMatch && !pathMatch[1].includes('..')) return pathMatch[1];

  const base = (process.env.OSS_PUBLIC_BASE || '').trim().replace(/\/$/, '');
  if (base && trimmed.startsWith(base + '/')) {
    const key = trimmed.slice(base.length + 1).split(/[?#]/)[0];
    if (key.startsWith('uploads/') && !key.includes('..')) return key;
  }
  return '';
}

function avatarPortraitUploadNames(person) {
  const names = new Set();
  if (!person) return names;
  for (const value of [person.avatar, person.portrait]) {
    const name = uploadBasename(value);
    if (name) names.add(name);
  }
  return names;
}

function avatarPortraitOssKeys(person) {
  const keys = new Set();
  if (!person) return keys;
  for (const value of [person.avatar, person.portrait]) {
    const key = ossObjectKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

module.exports = {
  stripAvatarPortrait,
  uploadBasename,
  ossObjectKey,
  avatarPortraitUploadNames,
  avatarPortraitOssKeys,
};
