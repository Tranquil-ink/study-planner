# 学习日程规划器

**阶段 1 交付已完成，剩余专项按用户决定暂缓，全量专项验收仍未全部验证。** Supabase 登录、任务池、云端保存与完整备份均已实现；真实云端/双设备核心流程和主要安卓操作已由用户报告通过，修复版 `a20e1a7` 的三项安卓网络补验通过。用户已补齐项目区域、设备/浏览器版本和实际验收日期，完整通过记录及暂缓清单 D01～D11 见 [用户验收记录](docs/OWNER_ACCEPTANCE_STAGE1.md)。

规范：[PROJECT_SPEC.md](PROJECT_SPEC.md) v2.0。进度：[docs/PROGRESS.md](docs/PROGRESS.md)。检查：[docs/CHECKS.md](docs/CHECKS.md)。协作规则：[AGENTS.md](AGENTS.md)。本分支基于 `605ea447`，包含已合并阶段 0（PR #1）与 Supabase 新规范（PR #2）。

## 启动

固定 Node.js **24.19.0 LTS**、npm **11.9.0**；不混用包管理器，不随意更新依赖。

```bash
nvm install
nvm use
npm ci
cp .env.example .env.local
# 按 docs/SUPABASE.md 创建项目、应用迁移、创建账号并填写公开配置
npm run dev
```

Windows 无 nvm 时安装相同版本 Node/npm，复制 `.env.example` 为 `.env.local` 后执行 npm 命令。打开 Vite 输出的网址（通常 localhost:5173）；手机不能使用电脑的 localhost，双设备需配置可达 HTTPS 验收网址。修改 `.env.local` 后重启服务。

只允许 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 为前端配置。后者可使用 publishable 或旧 anon key，绝不能使用 service_role/secret key。凭据与个人备份不提交 Git。

数据库安装、关闭注册、账号恢复、网络允许列表与真实集成测试配置详见 [docs/SUPABASE.md](docs/SUPABASE.md)。用户已建立 Cloudflare HTTPS 测试站点；正式 GitHub Pages 配置仍属于阶段 7。

## 本阶段可用功能

- 邮箱密码登录、SDK 会话恢复/续期、退出；会话验证前不显示个人数据。
- 分类新增、改名、颜色与归档；长期任务新增、修改、归档/取消归档、查看归档内容。保留原五个中文入口、hash 刷新/前进后退与键盘导航。
- 任务包含分类、单位、可选总量、初始已完成量、位置文字与备注。初始 8 节/总量 40/位置 `2.1.1` 分别保存，不把章节当小数。
- 真实 `@supabase/supabase-js` 访问云端；所有写入经过受控事务，按账号 RLS 隔离，版本冲突拒绝覆盖，稳定请求 ID 支持确认/幂等重试。
- 获取最新数据、最近成功获取时间、保存中/已保存/失败/结果待确认。切页保留任务表单；刷新取数不自动提高旧表单版本，核对后显式重新应用。
- 云端一致快照导出、JSON 预检、数量摘要与确认后原子完整替换；约定 v0 本地 JSON 迁移入口。归档实体和设置也完整备份。
- 手机单列编辑，主要按钮/输入至少 44px，清楚的标签与错误提示。

学习业务数据只在云端持久保存，浏览器仅有 SDK 会话和内存草稿。没有离线修改、补传、自动轮询或实时推送。另一设备需主动刷新或重新打开。

## 检查命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务 |
| `npm run typecheck` | 应用、配置、测试和集成脚本类型检查 |
| `npm run lint` | 代码检查，警告视为失败 |
| `npm run test -- --run` | 数量/备份、客户端失败、迁移在本地 PostgreSQL 引擎上的测试 |
| `npm run test:integration` | 指定真实 Supabase 隔离项目，检查 Auth、RLS、并发、幂等与恢复；缺配置退出码 2 |
| `npm run check:browser` | 可重跑的浏览器风险检查：模拟 Auth/HTTP + 本地 PostgreSQL，不替代云端验收 |
| `npm run build` | 检查类型并构建到 dist/ |
| `npm run preview` | 预览已构建的静态网页，通常 localhost:4173 |

先 build 再 preview，不直接双击 HTML。本地测试中的 PGlite 仅为开发依赖，不进入生产包，不是应用存储方案。真实集成与安卓手动验收必须另外执行。阶段 7 再汇总正式 E2E/CI。本次为阶段 1 数据风险加入独立浏览器检查，运行前安装浏览器：

```bash
npx playwright install chromium
npm run check:browser
```

已有系统 Chromium 时可设置 `CHROMIUM_EXECUTABLE_PATH` 指向它（本次 Linux 用 `/usr/bin/chromium`）。脚本自行启动 5174 端口的 Vite，只在测试内拦截请求并使用虚构样例，不连接真实 Supabase；产物写到已忽略的 work/。环境与范围见 CHECKS。

## 双设备快速验收

1. 按 Supabase 文档建好测试项目并配置同一 HTTPS 网页，手机与电脑登录同一个账号。
2. 手机创建“物理 → 理论力学”，总量 40、初始 8、位置 `2.1.1`，等待云端确认；电脑获取最新数据应见同一内容。
3. 电脑修改备注，手机获取最新数据应一致；归档后勾选显示归档仍可查看。清除一个设备的测试网站数据，重新登录仍能取回已确认记录。
4. 两端同时打开旧表单，先保存者成功，后保存者提示冲突且保留输入；刷新后核对并明确重新应用。
5. 导出完整 JSON，修改后恢复；预检展示两份数据的数量并要求确认替换。另一设备刷新见恢复结果，旧表单必须冲突。
6. 断网取数不冒充空库，保存失败不显示成功；联网后确认原请求、幂等重试。执行真实集成脚本检查权限、响应丢失与回滚。

完整操作、网络/过期会话/恢复/迁移和实机记录表见 [docs/ACCEPTANCE_STAGE1.md](docs/ACCEPTANCE_STAGE1.md)。

## 数据规则和限制

详细契约见 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)。进度为最多 9 位整数、6 位小数的非负精确数量，超精度拒绝、不截断；初始量不能超过总量。备份 v1 用十进制字符串；v0 是明确约定的测试迁移格式，未得到真实旧 IndexedDB 样本，不支持猜测格式或跨 origin 直接读取。

阶段 2～7 未实现：实际日历、合并拆分、WorkLog、周期预算、复盘与预测仍为占位入口。当前累计只等于初始量，无学习速度或实际投入。分类/任务采用归档，不提供硬删除。设置固定中国时区与日期格式。

未知请求只保留在当前页内；关闭/刷新页面会丢失草稿和内存请求信息，重新打开后需获取云端并核对，不能盲目重复创建。备份导入上限 10 MiB，导出没有分页截断；超过此个人使用规模须先扩展恢复能力。恢复重建服务器审计时间但保留 UUID 和业务内容。

真实测试项目、HTTPS 网址及主要安卓操作已有用户报告，修复版三项安卓网络补验也已报告通过；本 Codex 环境没有测试凭据，未独立重跑云端检查。自然 token 过期、全部无效备份等剩余专项按用户决定暂缓（未验证），Safari/Firefox 未验证。没有邮件恢复链接回调界面，密码恢复按管理端说明进行。暂缓项保留供后续补验，不计为通过。

本次验收结果、证据边界、交付结项决定及暂缓清单见 [用户验收与补验记录](docs/OWNER_ACCEPTANCE_STAGE1.md)。修复仅涉及前端身份验证，不需要再次执行数据库建表迁移。
