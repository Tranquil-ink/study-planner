# 阶段 5 检查记录

执行日期为 2026-11-19（Asia/Shanghai）。本地使用 Node.js v24.19.0、npm 11.9.0 和系统 Chromium。所有样例均为虚构数据。

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 通过，按锁文件安装依赖。 |
| `npm run lint` | 通过。 |
| `npm run build` | 通过，包含 TypeScript 检查。Vite 报告依赖纯函数注释和主包体积警告。 |
| `npm run test -- --run` | 8 个测试文件，共 59 项通过。PGlite 顺序执行全部 5 份迁移，验证旧时段升级、账号隔离、周初目标、结转、并发、幂等和备份恢复。 |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check:browser` | 通过。验证同一天多项安排、计划与实际分离、周初与当前目标对照、主动取数、重试、断网回退、备份恢复和 320／360／430／1280 CSS 像素布局。使用本地数据库和模拟传输。 |
| `npm run test:integration` | 环境缺少隔离 Supabase 项目配置及两个空账号，按预期退出 2。 |

真实项目迁移、HTTPS 前端部署、集成检查和安卓实机验收仍待执行。配置见 [Supabase 升级说明](SUPABASE.md)，逐项操作见 [阶段 5 验收清单](ACCEPTANCE_STAGE5.md)。
