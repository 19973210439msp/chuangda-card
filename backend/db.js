/**
 * README 中的存储入口。具体读写由 storage/index.js 按 STORAGE_DRIVER 切换。
 * json：个人名片、名片夹、埋点都在 data.json。
 * pg-oss：个人名片进 PostgreSQL，名片夹只在 OSS 保存 { userId, cardId }。
 */
module.exports = require('./storage');
