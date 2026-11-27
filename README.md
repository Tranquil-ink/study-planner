# 学习日程规划器

个人学习任务池、周目标和日程看板。手机与电脑用同一账号，学习数据保存到 Supabase。

当前版本为 **v0.5.1**。日程按天排列，每天用上午、下午、晚上组织安排。

| 页面 | 用法 |
| --- | --- |
| 今天 | 看当天安排和实际记录，补记学习，处理过去未收尾的安排 |
| 任务池 | 在分类和项目中录入任务、设置待办截止日、持续激活任务及查看累计进度 |
| 本周目标 | 给任务设定每周计划时长与目标进度；选用默认容量或设本周临时容量 |
| 日程 | 用早中晚看板安排、拖动和移动卡片，确认完成或标记未做 |
| 复盘 | 看周进度、近 4／12 周分类投入、学习分布和长期任务平均完成率 |
| 数据设置 | 导出 v6 JSON，并恢复 v5 或 v6 备份 |

## 启动

使用 Node.js 24.19.0 和 npm 11.9.0。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

在 `.env.local` 填写 Supabase 项目 URL 与公开 publishable key 或旧 anon key。已执行阶段 5 迁移的项目可应用 [日程看板迁移](supabase/migrations/202611260001_schedule_board.sql)，随后部署 v0.5.1 前端。旧安排及每天容量默认归到上午。所有安装及升级路径见 [Supabase 配置](docs/SUPABASE.md)。

## 使用示例

1. 在任务池的分类或项目内添加长期任务并点「激活」。激活跨周保留。未完成的临时待办距离所选周周一不足 14 天截止时，也会出现在目标清单。
2. 在「本周目标」点「设定目标」，填 `4` 小时和本周计划读 50 页。每天按上午、下午、晚上设可用时间，可填 `2.5` 或 `0.5` 小时。
3. 在「日程」从时段内新增安排。电脑可拖到同一时段的其他卡片前，或拖到其他天和时段。也可用卡片上的「移动」选择日期、时段与位置。
4. 点 ✓，可将默认计划时长改为实际时长，并填实际读到的页码或章节。点 × 标记未做，原计划分钟仍占当周预算，待办仍留在任务池。
5. 到「复盘」看实际投入和周进度。周初读到 250 页、目标 300 页、实际读到 275 页时，显示 `p275 / p300 · 50%`。未达标无需结转，下周可以重新设目标。

## 检查

```sh
npm run lint
npm run test -- --run
npm run build
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser
npm run test:integration
```

浏览器检查使用虚构数据、模拟 Auth 与本地 PostgreSQL。系统未安装 Chromium 时，可用 `npx playwright install chromium` 安装测试浏览器并省略环境变量。真实集成检查使用隔离 Supabase 项目的两个空测试账号。见 [检查记录](docs/CHECKS_STAGE5.md) 与 [验收清单](docs/ACCEPTANCE_STAGE5.md)。

[现行规范](PROJECT_SPEC.md) · [数据模型](docs/DATA_MODEL.md) · [进度与历史](docs/PROGRESS.md)
