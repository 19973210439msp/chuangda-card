# 名片权限 V2 完成记录

- 完成时间：2026-10-20
- 分支：`codex/card-access-v2`

## 已完成

- 员工账号支持真正的零名片；OCR 联系人改用独立投影。
- 企业认证改为账号与企业维度，总公司 `default` 同样需要认证。
- 员工可用模板取“已认证企业”和“总部授权模板”的交集。
- 子公司没有模板授权时，子管理员不能新建或导入名片，员工也不能创建名片。
- 认证撤销后归档该企业全部名片，并重算 `activeCardId`。
- 子管理员删除员工改为归档本企业名片并撤销认证，不再删除整个人员和历史数据。
- 公开详情、二维码、浏览统计和名片夹统一使用名片公开状态校验。
- 名片夹保存具体 `shareCardId`，不会在原名片归档后切到另一张名片。
- PostgreSQL 新增 `company_certifications`，以 `(person_id, company_id)` 保证唯一。
- 启动迁移为存量名片补齐 `lifecycle` 和 `source`，不自动生成名片。
- 管理后台和小程序均增加无模板、零名片和全企业认证状态。
- 总部管理员可选择目标企业创建或导入名片，服务端强制校验模板授权。
- 归档名片不占有效名片上限，员工可查看并永久删除自己的归档名片。
- 认证撤销后，对应名片详情、二维码和名片夹入口全部失效。
- 浏览记录更新使用独立随机令牌，停留时长由服务端按实际经过时间限制。
- 增加 `npm run audit:card-access`，只输出数量统计，不输出姓名、手机号等个人数据。

## 验证结果

- 后端完整测试：50 项通过，0 项失败。
- 关键 JavaScript 文件语法检查：19 项通过。
- 管理后台浏览器检查：内置模板授权、无模板提示、禁用新建按钮和窄屏布局正常。
- 敏感信息扫描：未发现私钥、访问密钥、真实凭据或被跟踪的 `.env`/证书文件。
- 生产 HTTPS：`/api/auth/options` 正常；`/admin/` 返回 HTTP 200。
- systemd 服务：`chuangda-card` 为 `active`。

## 生产数据审计

部署前统计：

- 员工账号 3 个，真实名片 1 张，零名片账号 2 个。
- 未归属且有真实内容的存量名片 1 张。
- 该名片缺少 `lifecycle/source`，没有自动合成的 `card-default`。

启动迁移后：

- 名片仍为 1 张，没有新增名片。
- 唯一存量名片已回填为 `lifecycle: active`，并补齐 `source`。
- 现有企业 2 个，自定义模板 1 个，内置模板对子公司的授权数为 0。

## 发布状态和下一步

- GitHub 功能分支和 `main` 已上传。
- 服务器 `/opt/chuangda-card` 已部署并重启。
- 部署前备份位于 `/root/chuangda-card-backups/pre-card-access-v2-20261020.tar.gz`。
- V1 兼容开关已移除，新账号始终从零名片开始并执行全企业认证规则。
- 新版小程序需要在微信开发者工具上传并通过审核。

## 未纳入本次提交的用户文件

- `miniprogram/project.config.json`
- `TLS_HANDSHAKE_TRIAGE.md`
- `brand-logo-under-30kb.jpg`
- `brand-logo-under-30kb.png`
- `pelican-bicycle.html`
- `tools/`
