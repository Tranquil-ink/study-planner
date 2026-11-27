# Supabase 配置与周期任务升级

## 已部署 v0.5.1 的项目

1. 在「数据设置」导出当前数据，关闭正在编辑的旧版页面。
2. 在原项目的 SQL Editor 执行周期任务迁移。 [202611270001_weekly_recurring_tasks.sql](../supabase/migrations/202611270001_weekly_recurring_tasks.sql)
3. 迁移成功后部署 v0.5.2，再重新打开网页。迁移与部署应连续执行，因为读取格式随版本变化。

迁移保留现有任务、激活状态、周目标、安排和实际记录。已存在的待办继续按临时待办处理。新版导出 v7 备份，支持恢复 v5 与 v6。

可用只读查询核对升级位置。

```sql
select to_regclass('public.planner_weeks') as stage_5,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'planner_schedules' and column_name = 'period'
       ) as schedule_board,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'planner_todos' and column_name = 'recurs_weekly'
       ) as weekly_recurring_tasks;
```

通过 CLI 管理时，先用 `supabase migration list` 对照远端，再用 `supabase db push`。对已经由 SQL Editor 完整执行且未登记的迁移，核实版本后可用 `supabase migration repair <版本号> --status applied` 登记，避免重复执行。

## 已部署 v0.5.0 的项目

先执行日程看板迁移，再执行周期任务迁移。旧安排和每日容量默认归到上午。旧「已处理」且有关联实际的安排迁移为已完成，其余已处理安排迁移为未做。 [202611260001_schedule_board.sql](../supabase/migrations/202611260001_schedule_board.sql)

## 阶段 4 或 5A 项目

先执行阶段 5 迁移，再依次执行日程看板与周期任务迁移。阶段 5 迁移会识别已执行 5A 的库，在事务中替换该阶段的测试待办、周计划及容量模板。 [202611190001_week_planner.sql](../supabase/migrations/202611190001_week_planner.sql) · [5A 历史迁移](../supabase/migrations/202611010001_stage5a.sql)

## 空项目安装

按文件名顺序执行 `supabase/migrations/` 中的全部迁移。在 Supabase Auth 中关闭公开注册和匿名登录，创建授权账号。前端的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY` 使用项目 URL 及公开 publishable key 或旧 anon key。测试网址使用手机和电脑均可访问的 HTTPS。

## 真实云端集成

准备已升级的隔离 Supabase 项目和两个空测试账号 A/B。通过环境配置或本地未跟踪的 `.env.integration` 提供变量。

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

`npm run test:integration` 检查两会话取数、周期任务自动纳入与完成、账号隔离、权限、过期版本、重试回执和恢复回滚。脚本验证两账号为空并在结束时尝试恢复 A 的空业务数据。缺配置时退出 2。

[数据模型](DATA_MODEL.md) · [验收步骤](ACCEPTANCE_STAGE5.md)
