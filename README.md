# 创大产控集团 · 电子名片小程序

一套面向集团的电子名片系统，覆盖**管理后台、员工端、客户端**三端，实现对外形象统一、名片集中管理、一键分享与数据追踪分析。

---

## 一、三端架构

| 端 | 形态 | 使用者 | 核心能力 |
|----|------|--------|----------|
| **管理后台** | H5 Web（浏览器/手机均可） | 管理员 | 批量导入/创建员工名片、统一设置 LOGO/模板/配色/公司信息、查看数据看板 |
| **员工端** | 微信小程序 | 集团员工 | 查看并编辑自己的名片、一键分享（微信转发/复制链接）、查看"我的数据" |
| **客户端** | 微信小程序 + H5 名片页 | 客户 | 扫码/点链接看名片，一键拨打电话、保存联系人、加微信、交换名片 |

> 客户端采用"小程序 + H5 名片页"双形态：微信内打开走小程序（体验最佳、可加微信），微信外（邮件/短信/浏览器）打开走 H5 名片页，保证"链接分享"在任何环境都能用。

---

## 二、目录结构

```
chuangda-card/
├── backend/                # 后端服务（Node/Express + JSON 存储，零数据库依赖）
│   ├── server.js           # 全部 REST API + 静态托管
│   ├── db.js               # JSON 文件存储（后期可无缝替换为 SQLite/MySQL）
│   ├── package.json
│   └── data.json           # 运行时自动生成的数据文件
├── miniprogram/            # 微信小程序（员工端 + 客户端）
│   ├── app.js / app.json / app.wxss
│   ├── components/card-view/  # 名片展示组件（员工/客户共用，确保形象一致）
│   ├── pages/
│   │   ├── login/          # 角色入口（员工登录 / 客户预览 / 管理后台入口）
│   │   ├── employee/       # home 我的名片 / edit 编辑 / share 分享 / stats 我的数据
│   │   └── client/         # card 客户名片页（拨号/保存/微信/交换 + 浏览埋点）
│   └── utils/              # request / util
├── admin-web/              # H5 管理后台（被后端 /admin 托管）
│   ├── index.html          # 管理台 SPA
│   ├── card.html           # 公开名片页（链接分享的 H5 落地页）
│   ├── css/style.css
│   └── js/{api.js,app.js}
└── README.md
```

---

## 三、快速启动

### 1. 启动后端（必需，先启动）
```bash
cd backend
npm install
node server.js
# 默认 http://localhost:3000
# 管理后台： http://localhost:3000/admin
# 公开名片页：http://localhost:3000/card.html?cardId=emp-1001
# 管理员账号： admin / admin123  （可用环境变量 ADMIN_USER / ADMIN_PASS 修改）
```

### 2. 运行管理后台（H5）
浏览器直接打开 `http://localhost:3000/admin`，用管理员账号登录即可。

### 3. 运行微信小程序
1. 用**微信开发者工具**导入 `miniprogram/` 目录。
2. 在 `miniprogram/app.js` 的 `globalData.apiBase` 填入后端地址（本机调试填 `http://localhost:3000`；手机预览需填电脑局域网 IP，并勾选"不校验合法域名"）。
3. `project.config.json` 中的 `appid` 改为你的小程序 AppID（或先用测试号）。
4. 编译运行：员工端用工号 `1001` / `1002` 登录；客户端可在登录页"客户预览"输入 `emp-1001` 体验。

---

## 四、REST API 清单

**认证**
- `POST /api/login` — 管理员/员工登录，返回 token
- `GET  /api/me` — 当前身份

**公司品牌**
- `GET  /api/company` — 获取品牌信息（公开）
- `PUT  /api/company` — 修改品牌（管理员）

**员工名片**
- `GET    /api/employees` — 列表（管理员，支持 `?q=` 搜索）
- `POST   /api/employees` — 新建（管理员）
- `POST   /api/employees/batch` — 批量导入 `{list:[...]}`
- `GET/PUT/DELETE /api/employees/:id` — 查看/更新/删除
- `GET/PUT /api/employee/me` — 员工查看/编辑自己名片

**公开名片（客户端）**
- `GET /api/cards/:id` — 公开名片（含公司品牌）

**数据追踪**
- `POST /api/analytics/view` — 记录一次浏览开始，返回 viewId
- `PUT  /api/analytics/view/:id` — 上报停留时长 / 补录访客交换信息
- `GET  /api/analytics/summary` — 汇总（按名片维度：浏览/访客/平均时长/兴趣指数）
- `GET  /api/analytics/list` — 浏览明细（管理员，支持 cardId/date 过滤）

---

## 五、需求对照

| 需求 | 落地实现 |
|------|----------|
| ① 对外形象一致 | `card-view` 组件 + 后台统一品牌（LOGO/配色/模板），所有员工名片同源渲染 |
| ② 名片统一管理 | 后台批量导入(JSON)/新建/编辑/启停；统一设置公司 LOGO、模板、品牌信息 |
| ③ 分享与触达 | 员工端微信转发 + 复制网页链接；客户端一键拨号、保存联系人(`addPhoneContact`)、加微信、交换名片 |
| ④ 数据追踪分析 | 客户端进入即埋点、离开上报时长；后台看板呈现谁看了、看了多久、兴趣指数，支持优先跟进 |
| 参考补足 | 兴趣度打分模型、H5 名片页兜底链接、交换名片留资、模板化配色、搜索、批量导入 |

---

## 六、替换为创大产控真实素材

1. **品牌**：后台「品牌设置」填公司全称、简称、标语、简介、官网、地址、电话、微信；上传 LOGO 后填入图片 URL（建议图床或对象存储），选模板与主题/辅色。
2. **员工**：后台「名片管理」批量导入（JSON 数组，字段见页面内模板），或逐条新建；头像建议统一规格。
3. **生产部署**：
   - 后端部署到服务器并配置 HTTPS 域名；
   - 小程序后台「开发管理-服务器域名」添加该域名为 request 合法域名；
   - 管理后台与 H5 名片页挂到同一域名下；
   - 把 `db.js` 的存储替换为数据库（接口不变）以支持更大规模。

---

## 七、后续迭代建议

- 名片海报生成（canvas 合成带小程序码的图片，方便朋友圈/群发）
- 客户留资后自动同步到企微/CRM，触发销售跟进提醒
- 管理员按部门/时间维度导出报表
- 多语言名片、电子手册/产品册挂载
- 真实微信 `openid` + 微信分析，提升"谁看了"的识别准确率
