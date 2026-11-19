# Supabase 配置与阶段 5 升级

阶段 4 已经有隔离测试项目。本轮可复用该项目和账号。仓库与云项目相互独立，同一代码也可以连接不同的测试与正式项目。

## 升级现有测试项目

1. 确认目标为隔离测试项目，且数据库已执行阶段 1～4 的迁移。
2. 在 SQL Editor 中执行新增的 [阶段 5 迁移](../supabase/migrations/202611190001_week_planner.sql) 一次。使用 CLI 管理迁移历史的项目可以用 `supabase db push`，避免 SQL Editor 与 CLI 重复执行。
3. 检查迁移成功后构建并更新测试前端。两端重新打开页面，验证「今天」「本周」「日历」及数据设置。
4. 可选地保存一份升级前的数据库快照，留作运行旧前端时的参考。Git 只能切回代码。阶段 4 的前端与新版数据库不能混用。

迁移保留 Auth 用户、分类、任务及实际记录。旧日程的计划分钟数从原起止差得到，时段占位表和时段字段在新版移除。v5 仅导入本版备份。阶段 5 之前的测试数据和备份不需要为本期另行迁移。

## 空项目安装

按文件名顺序执行 `supabase/migrations/` 的全部五份迁移。使用现有项目时无需重新建数据库或新仓库。正式开始保存真实记录时，可按需建立独立正式项目，并把现有测试项目继续用于验证。

在 Supabase Auth 中关闭公开注册和匿名登录，创建授权使用者。前端的 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY` 为公开配置，后者使用 publishable key 或旧 anon key。管理密钥和数据库密码仅在受控管理端使用。测试网址需为手机和电脑均能访问的 HTTPS。

## 真实云端集成

使用升级后的隔离测试项目，创建两个空测试账号 A/B。通过环境配置或本地未跟踪的 `.env.integration` 提供下列变量。

```text
SUPABASE_TEST_URL
SUPABASE_TEST_PUBLIC_KEY
SUPABASE_TEST_PROJECT_REF
SUPABASE_TEST_EMAIL_A
SUPABASE_TEST_PASSWORD_A
SUPABASE_TEST_EMAIL_B
SUPABASE_TEST_PASSWORD_B
SUPABASE_TEST_ACK=isolated-disposable
```

运行 `npm run test:integration`。脚本先检查账号为空，随后验证两会话取数、匿名与跨账号隔离、受控写入、过期版本、原请求重试和恢复回滚。结束时尝试恢复 A 账号的空业务数据。缺配置会退出 2。本地测试与浏览器模拟不代表通过真实云端或安卓实机。

数据库变更及备份字段见 [数据模型](DATA_MODEL.md)。阶段 0～4 的验证与部署信息见 [历史进度](PROGRESS.md)。
