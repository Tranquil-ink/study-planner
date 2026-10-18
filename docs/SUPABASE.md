# 阶段 1：Supabase 配置、迁移与云端检查

2026-10-18 收到用户报告：已创建隔离测试项目、应用迁移，真实集成脚本和核心双设备流程通过（未附终端日志）。本环境没有独立重跑；详情见 [用户验收记录](OWNER_ACCEPTANCE_STAGE1.md)。以下保留新环境配置步骤；已有测试项目不要重复建表。

## 1. 创建隔离环境

1. 在 Supabase 控制台创建测试项目，选择手机与电脑都可访问的区域。测试与日常个人数据分开；记录项目引用、区域及用途，不记录密码。
2. 在 SQL Editor 以项目管理身份执行 `supabase/migrations/202610170001_stage1.sql` **一次**。文件包含事务，出错应整笔回滚，不要跳过失败语句继续执行。此为从空库安装的迁移；后续升级新增迁移，不改写已部署迁移。
3. 如使用 Supabase CLI，先按官方说明登录/关联测试项目，再使用 `supabase db push` 应用同一迁移；不要同时用 SQL Editor 和 CLI 重复建表。手动执行时自行记录此迁移已经应用。
4. Auth 中关闭公开注册、匿名登录；通过管理端创建唯一日常使用者。真实集成检查另外使用两个新建、可丢弃的测试账号 A/B（测试专用，不提供公开注册界面）。使用已确认邮箱的账号与密码登录。两台日常设备必须使用同一用户 ID。
5. Site URL 和允许回调地址仅配置实际开发/验收/正式 HTTPS 地址；阶段 1 使用密码登录，不消费 URL 中的 Auth token。忘记密码时，由项目所有者通过受控管理工具调用 Auth Admin `updateUserById` 重设密码，或在支持该操作的管理界面重设；绝不向前端或聊天粘贴管理 key。邮件恢复链接回调尚未实现，不要将它作为当前验收路径。
6. 将 `.env.example` 复制为 `.env.local`，填写项目 URL 和 publishable key（或旧 anon key）。它们是公开配置。绝不把 service_role、secret key、数据库密码或测试密码写进 `VITE_*`。前端会拒绝可识别的特权 key，但真正安全边界仍在数据库授权和 RLS。
7. `npm ci && npm run dev`。修改环境配置后重启 Vite；正式构建需重新 build。缺失/错误配置时页面显示说明，不生成本地业务库。
8. 双设备验收需要同一个可达的 **HTTPS** 测试地址；用户已提供 Cloudflare HTTPS 测试站点，见验收记录。阶段 7 再完成正式 Pages 发布，不在本阶段擅自购买或部署服务。

当前 Codex 环境没有 Supabase 凭据，网络仅允许预置开发站点。项目创建后还需通过环境网络配置允许实际 `<project-ref>.supabase.co`，如通过 CLI 管理还需相应管理 API；不得绕过代理策略。密码/管理连接仅通过安全环境配置注入。

## 2. 表与权限

| 表 | 内容 | 客户端权限 |
| --- | --- | --- |
| `planner_categories` | 分类、颜色、归档、服务器审计时间 | 登录者只读本人行 |
| `planner_tasks` | 长期任务、精确进度、位置、备注、归档 | 登录者只读本人行 |
| `planner_settings` | Asia/Shanghai 与 YYYY-MM-DD 设置 | 登录者只读本人行 |
| `planner_dataset_state` | 每账号递增 revision | 登录者只读本人行 |
| `planner_operation_receipts` | 请求 ID、SHA-256 命令摘要、提交版本、回执 | 登录者只读本人行 |

五张表均启用 RLS；匿名没有表权限。读/写策略限制 `auth.uid() = owner_id`，但普通客户端的 INSERT/UPDATE/DELETE 授权全部撤销，不能绕过 RPC。任务外键为 `(owner_id, category_id)`，ID 命名空间也按 owner 隔离。

三个公开 RPC 只给 authenticated 执行权限：

- `planner_snapshot()`：按账号锁定版本后读取完整一致快照。首次调用幂等初始化内部状态和默认设置，不生成分类或任务。
- `planner_mutate(requestId, expectedRevision, command)`：锁定账号版本 → 检查幂等回执 → 校验基础版本 → 校验字段、引用、数值 → 写数据 → 版本 +1 → 写回执；任一失败全部回滚。支持 saveCategory、saveTask、restore。
- `planner_receipt(requestId)`：仅查本账号回执。未查到不能证明原请求失败，应用会用原 ID 和原参数重试。

函数采用固定空 `search_path`、全限定对象名与明确身份校验。辅助函数置于不向客户端开放的 `planner_private` schema。SECURITY DEFINER 不依赖 RLS 自动生效，因此内部每个查询/修改均限定当前身份。回执当前**不自动清理**，保证长期重试可确认；以后清理须另加请求过期协议，不能直接删除历史回执。

阶段 1 只建立上述实体；没有提前实现日程、实际记录或计划。后续新增实体必须同时扩展快照、RPC、约束、备份和恢复，不得从组件直写表。

## 3. 真实集成检查

创建两个空的隔离账号，在安全环境变量或被 Git 忽略的 `.env.integration` 中设置：

```dotenv
SUPABASE_TEST_URL=https://YOUR_TEST_PROJECT.supabase.co
SUPABASE_TEST_PUBLIC_KEY=YOUR_PUBLIC_KEY
SUPABASE_TEST_PROJECT_REF=YOUR_TEST_PROJECT
SUPABASE_TEST_EMAIL_A=TEST_ACCOUNT_A
SUPABASE_TEST_PASSWORD_A=SET_SECURELY
SUPABASE_TEST_EMAIL_B=TEST_ACCOUNT_B
SUPABASE_TEST_PASSWORD_B=SET_SECURELY
SUPABASE_TEST_ACK=isolated-disposable
```

执行 `npm run test:integration`。它会校验 URL/项目引用、账号不同、两账号业务库为空，再写入明确虚构的测试记录，最后清理 A 的业务数据。版本和回执保留，不重置内部状态。中途失败会尝试清理；清理失败需在测试项目确认，不能在正式账号上反复试跑。脚本不需要 service_role key。

检查覆盖真实 Auth 两次登录、同账号双会话读写、全部表匿名/跨账号读取、直接写入/修改/删除拒绝、伪造 owner、跨账号引用、匿名 RPC、并发版本竞争、提交后丢失响应及同 ID 重试、回执隔离、提交前断网、读取失败、恢复回滚、恢复幂等与旧表单拒绝、退出和重新登录。输出仅组名，不打印凭据和个人记录。

缺配置会以退出码 2 明确结束，**不是通过或跳过后成功**。脚本中的“手机/电脑”是独立 API 客户端；安卓浏览器、下载、触控、真实网络和会话自然过期仍必须按 [ACCEPTANCE_STAGE1.md](ACCEPTANCE_STAGE1.md) 手动验证。
