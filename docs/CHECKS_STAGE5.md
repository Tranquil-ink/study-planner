# 阶段 5 检查记录

## 冷灰雾蓝界面

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过。 |
| `npm run build` | 通过，含 TypeScript 检查。Vite 仍报告 Zod 注释与主包体积警告。 |
| `npm run test -- --run` | 8 个文件、70 项通过。 |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser` | 通过。覆盖键盘菜单、手机触控入口、周目标关闭后恢复焦点、桌面侧栏与跨日拖动、同周翻页、日期跳转及原有业务流程。检查 320／360／430／820／1280 像素的页面与看板宽度。 |
| `npm run test:integration` | 缺少隔离 Supabase 项目与空测试账号配置，退出 2，检查未执行。 |

浏览器检查使用虚构数据、模拟 Auth 和本地 PostgreSQL。安卓实机验收待完成。 [验收清单](ACCEPTANCE_STAGE5.md)

## v0.5.2 周期任务（2026-11-27，Asia/Shanghai）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过。 |
| `npm run build` | 通过，含 TypeScript 检查。Vite 仍报告 Zod 注释与主包体积警告。 |
| `npm run test -- --run` | 8 个文件、70 项通过。覆盖精确减法、剩余容量、周期完成跨周隔离、遗漏周补齐、RLS、已有数据升级和备份恢复。 |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser` | 通过。验证顶部分类按钮、目标页码输入、跨周周期任务、日程完成和 v7 恢复。检查 320／360／430／1280 像素。 |
| `npm run test:integration` | 缺少隔离 Supabase 项目和空测试账号的配置，退出 2，检查未执行。 |

远端迁移、部署和安卓实机待验证。 [Supabase 配置](SUPABASE.md) · [验收清单](ACCEPTANCE_STAGE5.md)

## v0.5.1 日程看板（2026-11-26，Asia/Shanghai）

本地使用 Node.js 24.19.0、npm 11.9.0 和系统 Chromium。用虚构数据测试。

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过。 |
| `npm run build` | 通过，含 TypeScript 检查。Vite 仍报告 Zod 注释与主包体积警告。 |
| `npm run test -- --run` | 8 个文件、65 项通过。验证已有阶段 5 和 5A 的升级、阶段 4 源数据、权限隔离、移动、完成和跳过、原请求重试、备份回滚与恢复。 |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser` | 通过。覆盖激活跨周、截止候选、容量配置、手机移动、桌面跨日拖拽、完成输入、日进度、复盘图表、双会话冲突、断网与恢复。检查 320／360／430／1280 像素。 |
| `npm run test:integration` | 缺少隔离 Supabase 项目配置和空测试账号，退出 2，集成检查未执行。 |

真实 Supabase 迁移、前端部署及安卓实机验收仍待完成。见 [Supabase 配置](SUPABASE.md) 与 [验收清单](ACCEPTANCE_STAGE5.md)。

## v0.5.0 历史记录

执行日期为 2026-11-19（Asia/Shanghai）。本地使用 Node.js v24.19.0、npm 11.9.0 和系统 Chromium。所有样例均为虚构数据。

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 通过，按锁文件安装依赖。 |
| `npm run lint` | 通过。 |
| `npm run build` | 通过，包含 TypeScript 检查。Vite 报告依赖纯函数注释和主包体积警告。 |
| `npm run test -- --run` | 8 个测试文件，共 60 项通过。PGlite 验证阶段 4 直升及应用 5A 原始 SQL 后升级两条路径，覆盖旧时段、5A 测试数据替换、账号隔离、周初目标、结转、并发、幂等和备份恢复。 |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser` | 通过。验证同一天多项安排、计划与实际分离、周初与当前目标对照、主动取数、重试、断网回退、备份恢复和 320／360／430／1280 CSS 像素布局。使用本地数据库和模拟传输。 |
| `npm run test:integration` | 环境缺少隔离 Supabase 项目配置及两个空账号，按预期退出 2。 |

真实项目迁移、HTTPS 前端部署、集成检查和安卓实机验收仍待执行。配置见 [Supabase 升级说明](SUPABASE.md)，逐项操作见 [阶段 5 验收清单](ACCEPTANCE_STAGE5.md)。
