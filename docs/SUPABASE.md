# Supabase 配置与阶段 5 升级

可复用已执行阶段 4 或阶段 5A 迁移的隔离测试项目及其账号。Git 分支和数据库迁移历史独立。PR #7 的阶段 5A SQL 即使尚未合并，也可能已经在 Supabase 执行。

## 升级现有测试项目

1. 确认目标为已经完成阶段 4 的隔离测试项目。关闭正在编辑的旧版页面。如果想留存 5A 的测试待办、周计划或容量模板，可先用 5A 前端导出备份。
2. 使用 SQL Editor 的项目只需执行 [PR #8 最新版阶段 5 迁移](../supabase/migrations/202611190001_week_planner.sql) 一次。已运行 5A 的库也用这份 SQL。它会识别 5A，在同一事务中替换其待办、周计划和容量模板的表及函数。
3. 检查迁移成功后构建并更新测试前端。两端重新打开页面，验证「今天」「本周」「日历」及数据设置。
4. 可选地保存一份升级前的数据库快照，留作运行旧前端时的参考。Git 只能切回代码。阶段 4 的前端与新版数据库不能混用。

迁移保留 Auth 用户、分类、长期任务、实际记录及旧日程的日期和计划分钟数。5A 的测试待办、周计划和容量模板从空白开始。v5 仅导入本版备份。

可在 SQL Editor 用以下只读查询确认当前结构。阶段 5A 已应用时出现 `stage_5a`，阶段 5 已应用时出现 `stage_5`。

```sql
select to_regclass('public.planner_week_plans') as stage_5a,
       to_regclass('public.planner_weeks') as stage_5;
```

使用 CLI 管理的项目，在 PR #8 分支运行 `supabase migration list` 对照版本，然后运行 `supabase db push`。仓库已保留 5A 的原始 `202611010001_stage5a.sql`。如果核实它已通过 SQL Editor 完整执行，且远端迁移历史中没有该版本，先运行 `supabase migration repair 202611010001 --status applied` 登记。其他手动执行的版本同样需要先核实并对齐历史。已登记的迁移由 CLI 跳过。

## 空项目安装

按文件名顺序执行 `supabase/migrations/` 的全部六份迁移。使用现有项目时无需重新建数据库或新仓库。正式开始保存真实记录时，可按需建立独立正式项目，并把现有测试项目继续用于验证。

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
