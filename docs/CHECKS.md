# 阶段 0 检查记录

检查日期：2026-10-17（Asia/Shanghai）。环境：Linux、Node.js 24.19.0 LTS（Krypton）、npm 11.9.0、Chromium 154.0.8037.57。

## 实际执行结果

| 命令／检查 | 结果 |
| --- | --- |
| `npm install --cache /workspace/work/npm-cache` | 成功，生成 lockfile；后续调整 ESLint 版本后同步更新 lockfile |
| `npm ci --cache /workspace/work/npm-cache` | 成功，按最终 lockfile 安装 168 个包 |
| `npm ls --depth=0` | 成功，没有缺失或不兼容的直接依赖 |
| `npm run typecheck` | 通过；应用与 Vite 配置均启用 strict，最终 build 也重新执行通过 |
| `npm run lint` | 最终 ESLint 10 检查通过，0 错误、0 警告 |
| `npm run build` | 通过；生成 dist/index.html、CSS、JS 和站点图标 |
| `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | 启动成功，浏览器请求 HTTP 200 |
| `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` | 启动成功，构建产物请求 HTTP 200 |
| `git diff --check` | 通过；提交前另检查暂存区 |
| `git hash-object PROJECT_SPEC.md` | 与原仓库一致：ea89ca595d7f5f10ba2c80b4010f92a3100f1579 |

缓存参数仅用于本次受限云环境，把 npm 缓存放在可写工作目录；一般本机直接运行 `npm ci` 即可。

## 实际浏览器检查

使用环境已有的 Playwright 驱动系统 Chromium，临时脚本位于开发工作目录，不作为阶段 7 的正式 E2E 测试集，不增加项目依赖。在开发服务（5173）与构建预览（4173）分别完成以下检查，全部通过：

- 默认日历；五个导航链接均切换到相应标题、说明和未实现提示；当前链接有 aria-current，浏览器标题同步变化。
- 刷新保持当前页面；浏览器前进／后退正常；未知 hash 回到日历。
- 键盘 Enter 激活导航；“跳到主要内容”聚焦 main 且保持当前页面。
- 桌面 1366×900；375px 与 320px 窄屏下五个入口可见、可点击，无横向溢出。已查看桌面与 320px 截图。
- 干净浏览器上下文中，IndexedDB 数据库列表为空、localStorage.length 为 0。
- 最终页面运行错误、控制台错误与 HTTP 4xx／5xx 请求均为 0。

## 发现并处理的问题

- 初始受限命令无法连接环境代理；启用命令的网络权限后恢复。npm 默认缓存目录不可写，改用工作目录缓存后安装成功。
- 首选 ESLint 9 安装提示已停止支持；核对插件 peerDependencies 后改为 ESLint 10.13.0，并重装、重跑检查通过。
- 首轮浏览器检查出现资源 404；补充站点图标并重新构建，开发与构建预览的完整复查均无错误。

## 未执行与验证边界

- 未运行业务单元测试：本阶段没有业务计算／存储逻辑，也没有 `test` 占位脚本。
- 未集成阶段 7 的 Playwright 测试套件、CI 或 Pages 部署；未验证正式域名／仓库子路径发布。
- 未验证 Safari、Firefox、真实手机或屏幕阅读器；窄屏检查使用 Chromium 模拟视口。
- 未验证任务保存、备份、预算与预测等功能，因为阶段 1～7 尚未实现。
