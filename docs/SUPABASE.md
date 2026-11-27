# Supabase 配置与日程看板升级

## 现有阶段 5 项目升级

1. 在 v0.5.0 的「数据设置」导出一份当前数据。关闭正在编辑的旧版页面。
2. 在原项目的 SQL Editor 执行 [202611260001_schedule_board.sql](../supabase/migrations/202611260001_schedule_board.sql) 一次。
3. 迁移成功后部署 v0.5.1 前端，再在两台设备重新打开页面，核对日程、本周目标、实际记录和备份。迁移与前端部署应连续执行，因为读取格式随版本变化。

迁移保留账号、任务、原周目标、已保存安排、实际记录和回执。旧安排和旧每日容量统一归到上午，旧安排原顺序及日容量总和不变。旧「已处理」且有关联实际的安排视为已完成，其余旧「已处理」安排视为未做。已有任务的激活初始为关闭，已保存的周目标仍会显示。新版导出 v6 备份，恢复支持阶段 5 的 v5 备份。

可用只读查询核对升级位置。

```sql
select to_regclass('public.planner_weeks') as stage_5,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'planner_schedules' and column_name = 'period'
       ) as schedule_board;
```

通过 CLI 管理时，先用 `supabase migration list` 对照远端，再用 `supabase db push`。对已经由 SQL Editor 完整执行且未登记的迁移，核实版本后可用 `supabase migration repair <版本号> --status applied` 登记，避免重复执行。

## 阶段 4 或 5A 项目

先执行 [202611190001_week_planner.sql](../supabase/migrations/202611190001_week_planner.sql)，再执行日程看板迁移。第一步会识别已执行 5A 的库，在事务中替换该阶段的测试待办、周计划及容量模板。仓库保留 [202611010001_stage5a.sql](../supabase/migrations/202611010001_stage5a.sql) 以对照已有迁移记录。

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

`npm run test:integration` 检查两会话取数、移动与完成、账号隔离、权限、过期版本、重试回执和恢复回滚。脚本验证两账号为空并在结束时尝试恢复 A 的空业务数据。缺配置时退出 2。

[数据模型](DATA_MODEL.md) · [验收步骤](ACCEPTANCE_STAGE5.md)
