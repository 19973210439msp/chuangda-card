# 创大产控 · 电子名片 — Agent 规格

改这个项目前先读本文，再读同目录 `README.md`。README 描述集团三端原文；本文是已经确认的增量，包括登录方式和原先四项待定的做法。

项目目录：`D:\AI\chuangda-card`。

---

## 1. 产品范围（已确认）

两层同时保留：

| 层 | 内容 |
|----|------|
| 集团三端 | 管理后台（H5）、员工端（小程序）、客户名片页（小程序 + H5 公开页） |
| 小程序结构 | 三个 Tab：**首页、名片夹、我的** |

原文能力继续保留：品牌统一、批量导入员工、分享、浏览埋点、停留时长、兴趣指数、H5 公开页。

本次新增：

- 小程序登录：只能微信授权；测试可跳过。管理员只在网页后台用工号登录
- 首页先看自己的名片，点编辑再改
- 编辑字段：姓名、公司、职业、手机号、微信号、邮箱、地址、名片附件（不再支持头像 / 形象照）
- 名片夹：收藏他人名片；拍摄纸质名片识别后存入名片夹
- 我的：展示当前微信授权手机号（不可切换多账号）、注销账号；邮箱在编辑页直接改

技术：

- 小程序用**原生微信小程序**
- 后端用 **Node + Express**
- 存储两套可切换，**默认方案 1**

---

## 2. 存储（配置切换）

文件：`backend/config.js`  
环境变量：`STORAGE_DRIVER`

| 值 | 方案 | 规则 |
|----|------|------|
| `json` | 方案 1，**默认** | `data.json`，零数据库。个人名片、名片夹、埋点都在 JSON |
| `pg-oss` | 方案 2 | **个人名片**进 PostgreSQL；**名片夹**按 `user_id` 进 OSS |

方案 2 的 OSS **不必存完整名片正文**，但必须能据此取回完整数据：

- 收藏本系统名片：OSS 对象只存 `{ userId, cardId }`，字段从 PostgreSQL 读
- 拍纸质名片、系统里没有原名片：完整字段写入 PostgreSQL 的夹内名片记录，OSS 仍只存 `{ userId, cardId }`

没有 `STORAGE_DRIVER` 时用 `json`。方案 2 缺 `DATABASE_URL` 或 OSS 配置时直接报错，不要悄悄写回 JSON。

密钥只放环境变量，不写入仓库。

---

## 3. 登录

| 端 | 规则 |
|----|------|
| 小程序 | **只能登录时微信授权手机号**。`getPhoneNumber` + `wx.login` → `POST /api/auth/wechat`（带 `phoneCode`）。用手机号匹配管理员已导入员工并直接领取名片；未匹配则建空白名片。编辑页手机号只读，不可再次授权换号（避免重复计费） |
| 网页管理后台 | **只能管理员账号登录**。沿用 `POST /api/login`，不走微信 |
| 测试 | `SKIP_WECHAT_AUTH=true` 且 `NODE_ENV` 不是 `production` 时，小程序可跳过微信授权；可用 `phoneCode: "dev:13800138000"` 测领取 |
| 正式发布 | `SKIP_WECHAT_AUTH` 必须为 false。正式环境缺少手机号授权会返回 `PHONE_REQUIRED` |

一微信对应登录时授权的一个手机号；「我的」只展示该号，不做多账号切换。换号需退出后重新微信授权登录。员工不能在小程序里用管理员账号进入后台。

---

## 4. 小程序页面

在 README 的员工端、客户端之外，Tab 为：

| 路径 | 作用 |
|------|------|
| `miniprogram/pages/home/index` | 首页：看我的名片 |
| `miniprogram/pages/home/edit` | 编辑第 1 节字段和附件 |
| `miniprogram/pages/holder/index` | 名片夹 |
| `miniprogram/pages/holder/scan` | 拍名片识别 |
| `miniprogram/pages/mine/index` | 展示绑定手机号、注销 |
| `miniprogram/pages/client/card` | 保留：客户看名片、拨号、存通讯录、加微信、交换、埋点 |
| `miniprogram/pages/employee/stats` | 保留：我的数据 / 兴趣指数，不单独占 Tab |

头像、形象照字段已移除；PostgreSQL `people.data` 与 OSS `uploads/` 中对应对象会在启动迁移时清理。

---

## 5. 新增文件（README 目录里没有的）

```text
backend/config.js
backend/.env.example
backend/storage/index.js
backend/storage/jsonStore.js
backend/storage/pgOssStore.js
backend/routes/holder.js
backend/routes/account.js
backend/routes/card-ocr.js
miniprogram/pages/home/index.*
miniprogram/pages/home/edit.*
miniprogram/pages/holder/index.*
miniprogram/pages/holder/scan.*
miniprogram/pages/mine/index.*
```

原文已有的 `server.js`、`db.js`、`admin-web/`、`employee/`、`client/` 保持职责不变。新路由挂到 Express，存储一律走 `storage/index.js`。

---

## 6. 新增接口

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/auth/wechat` | 微信 code 登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET/PUT | `/api/employee/me` | 查看 / 保存我的名片（姓名、联系方式、附件等；无头像/形象照） |
| GET/POST | `/api/holder` | 名片夹列表 / 收藏（body 要有 `cardId`） |
| POST | `/api/holder/recognize` | 上传名片照片，返回识别草稿，确认后再入库 |
| POST | `/api/account/close` | 注销：停用账号并下架对外名片，不物理删除 |

埋点和兴趣指数继续用 README 的 `/api/analytics/*`，不要另做一套统计。

---

## 7. Agent 约束

1. 默认存储是 `json`。
2. 方案 2 未配置数据库或 OSS 时失败返回，不降级写入 JSON。
3. 生产环境不得默认跳过微信授权。
4. 个人名片主数据在当前方案的主存储（JSON 或 PostgreSQL），OSS 只做名片夹引用。
5. 不删除管理后台、H5 公开页、埋点和兴趣指数。
6. 小程序不要做工号登录；网页后台不要做微信登录。
7. 拍名片识别走腾讯云名片识别；未配置密钥时接口返回未配置，不要换一家厂商。
8. 手机号仅登录时微信授权；编辑页可直接改邮箱，不再要求邮箱验证码。
9. 注销只停用，不删名片正文、埋点、OSS 引用。

---

## 8. 四项已定做法

### 拍名片识别

用 **腾讯云名片识别**（`OCR_PROVIDER=tencent`）。小程序只上传照片；后端调用识别，把草稿返回给用户核对，用户确认后再写入名片夹。密钥放环境变量 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`。没配密钥时返回「识别未配置」，不要在小程序里写死密钥，也不要改接其他厂商。

### 手机号与邮箱

手机号仅在登录时通过微信授权获取与更换（退出后重新授权登录）。编辑页可直接填写邮箱，无需验证码；「我的」不再提供邮箱绑定入口。

### 注销

**停用，不物理删除。** 账号标记为已注销，客户打开名片和 H5 公开页都不可见，本人名片夹不再列出。PostgreSQL 或 `data.json` 里的名片、埋点、OSS 上的 `{ userId, cardId }` 都保留。管理员在网页后台可以恢复该员工。本阶段不做「连数据一起删」。

### 收藏范围

收藏 **只限本系统已有名片**（请求里带 `cardId`，后端能查到才写入名片夹）。纸质名片、系统外的名片不走收藏，只走拍名片识别，确认后再入库。
