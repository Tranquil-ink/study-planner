# 学习日程规划器

个人学习任务池、周计划和按天日历。手机与电脑用同一账号，学习数据保存到 Supabase。

本版为 **v0.5.0，按天安排与周复盘**。规划方式参考 Marvin 的任务总览、本周、日历与今天。保留阶段 4 的账号、长期任务、实际记录和精确累计能力。固定时段改为日期与分钟数。

| 页面 | 用法 |
| --- | --- |
| 今天 | 查看当天安排、记录实际、处理过去没有收尾的安排 |
| 任务池 | 收集临时待办，按分类和可选项目整理长期任务 |
| 本周 | 挑选重点，设定时间或进度目标，查看可用容量、排程缺口和结转 |
| 日历 | 按周或按天查看。每条安排有日期、计划分钟数和可选的计划新增量 |
| 复盘 | 看周初与调整后的达成情况、计划外投入、近 4／12 周趋势和累计进度 |
| 数据设置 | 导出和恢复完整 v5 JSON |

## 启动

使用 Node.js 24.19.0 和 npm 11.9.0。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

在 `.env.local` 填写 Supabase 项目 URL 与公开 publishable key 或旧 anon key。安装数据库及登录步骤见 [Supabase 配置](docs/SUPABASE.md)。

**已完成阶段 4 的隔离测试项目可直接复用。** 先应用新增的 `202611190001_week_planner.sql`，然后部署 v0.5.0 前端。迁移只执行一次。旧测试安排的计划分钟数取原时段长度，旧钟点不再使用。旧版 JSON 只在对应版本使用。

旧版代码保存在阶段 4 合并提交 `94a970a`。如需单独查看旧版，可以用 `git worktree add --detach work/stage-4 94a970a`。运行旧版时需连接阶段 4 结构的数据库。切换 Git 版本不会改变 Supabase 数据库结构。

## 验收示例

1. 在任务池建「物理 / 理论力学 / 教材」和一项一次性报告，分别加入本周。在本周填每日可用时间，确认周初计划。
2. 将教材分几次排入日历，每次只选日期和计划分钟数。同一天也可安排报告。
3. 在今天录入实际 80 分钟、读 6 页。检查已排时长和旧计划保持原值，实际记录和累计进度更新。
4. 过去没处理的安排可改期、补记或标为已处理。一次性待办完成须手动确认。结转会保存原周结果，并让你设置下周目标。
5. 调整周目标，查看复盘中原目标和现目标。另一台设备登录同一账号后，在账号菜单获取最新数据。参见 [阶段 5 验收清单](docs/ACCEPTANCE_STAGE5.md)。

## 检查

```sh
npm run lint
npm run test -- --run
npm run build
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser
npm run test:integration
```

浏览器检查使用虚构数据、模拟 Auth/HTTP 和本地 PostgreSQL。若系统没有 Chromium，可以用 `npx playwright install chromium` 安装并省略环境变量。集成检查使用真实隔离 Supabase 的两个空测试账号。相关设置和结果见 [阶段 5 检查记录](docs/CHECKS_STAGE5.md)。

[现行规范](PROJECT_SPEC.md) · [数据模型](docs/DATA_MODEL.md) · [进度与历史](docs/PROGRESS.md)
