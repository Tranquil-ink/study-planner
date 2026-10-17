# 学习日程规划器

目前仅完成 **阶段 0：工程骨架**。可以在日历、任务池、周期计划、复盘、数据设置之间切换，每页明确标注“尚未实现”。这还不是可记录学习数据的完整工具。

完整产品范围、默认规则与分阶段验收标准见 [PROJECT_SPEC.md](PROJECT_SPEC.md)，开发进度见 [docs/PROGRESS.md](docs/PROGRESS.md)，协作约定见 [AGENTS.md](AGENTS.md)。本次保留原规范文件不变。

## 环境与启动

使用 **Node.js 24.19.0 LTS（Krypton）与 npm 11.9.0**。Node 版本固定在 `.nvmrc`，`package.json` 和 `.npmrc` 会检查版本；只使用 npm。直接依赖固定版本，间接依赖由 `package-lock.json` 锁定。

已安装 nvm 的 macOS／Linux 用户可在仓库目录执行：

```bash
nvm install
nvm use
node --version
npm --version
npm ci
npm run dev
```

Windows 或不使用 nvm 时，安装相同版本的 Node.js，确认 Node 和 npm 版本，再执行 `npm ci` 与 `npm run dev`。首次生成工程时使用 `npm install` 创建 lockfile；拉取本仓库后统一使用 `npm ci`。

打开终端打印的本地地址，通常是 `http://localhost:5173`。端口占用时以 Vite 实际输出为准。按 Ctrl+C 停止服务。运行本阶段不需要环境变量、密钥、后端或浏览器测试依赖。

## 可用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务，修改源码后自动更新 |
| `npm run typecheck` | 检查应用与 Vite 配置的 TypeScript 类型 |
| `npm run lint` | ESLint 检查，警告也视为失败 |
| `npm run build` | 先检查类型，再构建静态文件到 `dist/` |
| `npm run preview` | 在本地预览已构建的 `dist/`，通常为 `http://localhost:4173` |

`preview` 前先执行 `npm run build`，不要直接双击 `dist/index.html`。本阶段没有业务计算，不添加占位测试或虚假的 `test` 成功脚本；后续业务阶段引入 Vitest，阶段 7 再集成 Playwright 流程测试与浏览器安装说明。

## 本次实现

- React + TypeScript strict + Vite 工程，普通 CSS，无额外路由或状态管理框架。
- 中文侧栏导航、当前页面标记、标题与未实现提示；窄屏改为顶部导航。
- 原生 hash 导航支持刷新与前进／后退，无 hash 或未知地址显示日历。
- 键盘焦点样式、跳到主要内容入口和语义化主导航。
- 无示例任务、假统计或伪保存。未接入 IndexedDB，也不会读写 localStorage；初始没有业务数据，不创建空数据库来冒充持久化。

## 手动验收

1. 执行 `npm ci`、`npm run dev`，打开服务地址；默认页面为“日历”，浏览器标签显示“日历 · 学习日程规划器”。
2. 依次点击五个导航入口；当前项有边框和高亮，标题与说明对应页面，每页明确提示“尚未实现”。不应出现示例任务、数字统计或可保存的表单。
3. 在任务池页面刷新，仍显示任务池；使用浏览器后退／前进，应切换到相应页面。访问 `#unknown` 时应显示日历。
4. 用 Tab 遍历导航，焦点清晰；Enter 可切换。使用“跳到主要内容”应聚焦内容区，并保留当前页面。
5. 将窗口缩窄到约 375px（可再测 320px），五个入口均可见、可操作，文字不被截断，页面不应横向溢出。
6. 打开浏览器开发者工具，切换页面应没有运行错误。在新的浏览器配置／干净 origin 下检查存储，不应生成本应用的 IndexedDB 数据库或 localStorage 学习记录。不要为验收清除其他应用数据。
7. 执行 `npm run typecheck`、`npm run lint`、`npm run build`；再运行 `npm run preview`，重复页面切换检查。

## 代码位置与后续约束

```text
src/
  App.tsx                       页面外壳和导航
  navigation.ts                 页面描述，不是业务数据
  useCurrentPage.ts             hash 导航订阅
  components/FeaturePlaceholder.tsx  共用未实现提示
  main.tsx                      React 入口
  styles.css                    基础与响应式样式
docs/
  PROGRESS.md                   阶段清单和下一阶段入口
  CHECKS.md                     本次真实检查结果
```

后续按需增加 `src/domain/`（纯业务计算）、`src/data/`（统一存储入口）和 `src/features/`（模块界面），不预先创建空业务实现。

规范中的默认规则仍保留在 `PROJECT_SPEC.md` 第 2、7、8 节：周一为一周起点；日历日期采用 Asia/Shanghai；保存整数分钟；每天 10 个基础时段共 690 分钟且不可跨休息间隔合并；位置文字与数值进度分开；计划与实际分开；跳过周不自动分摊预算，部分周按天折算。本阶段尚无相关业务代码，不能把这些约定视为已实现。

## 检查与限制

实际执行的结果见 [docs/CHECKS.md](docs/CHECKS.md)。

阶段 1～7 均未开始：没有任务增改、真实日历、时段合并、实际学习记录、周期预算、预测、持久化或备份恢复。未接后端、登录、AI API、统计跟踪或远程业务服务。尚未配置 GitHub Pages 发布、仓库子路径或离线缓存，不承诺离线重开可用。

下一阶段只有在收到明确任务后才开始，须基于包含本阶段成果的分支或合并结果继续。
