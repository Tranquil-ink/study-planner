# 阶段 3 数据与备份契约

云端为唯一业务真值；浏览器只保存 Supabase SDK 会话、内存快照和当前页草稿，不使用 IndexedDB/localStorage 保存学习业务数据，不做离线队列。SDK 的会话持久化不等于本地业务库。

## 领域数据

Category：稳定 UUID、name、color、archived、createdAt、updatedAt。

LearningTask：稳定 UUID、categoryId、title、unitName、totalUnits（可空）、initialCompletedUnits、initialProgressLabel、note、archived、createdAt、updatedAt。

Settings：timezone 固定 Asia/Shanghai，dateFormat 固定 YYYY-MM-DD。本阶段不提供设置编辑器，备份完整保留这两个已实现设置。设置表也保存服务器审计时间。

实体创建/更新审计时间由 PostgreSQL 生成。恢复保留实体 ID 和业务内容，重新生成服务器审计时间；备份内原时间仅用于格式和顺序校验，不冒充本次服务器提交时间。原文件应保留为来源记录。

初始量是进入软件前已完成的量。阶段 3 尚无 WorkLog，当前累计仅等于初始量；不伪造速度、分钟数或预计日期。位置 `2.1.1` 始终是字符串。

## ScheduleBlock 与固定时段

`planner_schedules` / `Snapshot.schedules`：id、date、slotTemplateVersion、slotIds、startMinute、endMinute、taskId（临时事项为 null）、title、plannedRangeText、note、createdAt、updatedAt。数据库另有 owner_id，前端命令/备份不接收 owner_id。

- date 是 `0001-01-01`～`9999-12-31` 的有效公历日，数据库为 date，接口为 YYYY-MM-DD。今天使用 Asia/Shanghai；日期加减用 UTC 午夜作为纯日期计算基准，不使用设备本地时区；周一开始。
- 不可变模板 v1：白天 8×60，晚间 18:30–20:15 / 20:15–22:00 各 105。新建使用 v2：白天不变，晚间 18:30–20:00 / 20:00–21:00 / 21:00–22:00 为 90/60/60。两版均为 690 分钟，午休／晚饭不可排程。迁移不修改既有日程时间、ID 或审计时间。
- slotIds 为按真实时间排列、无重复的连续基础时段 ID；数据库 CHECK 与命令验证都核实模板和每段边界，起止快照必须一致。计划时长=endMinute−startMinute，因禁止间隔也等于基础时段之和。
- 主键 `(owner_id,id)`，任务外键 `(owner_id,task_id)`。阶段 2 数组唯一约束已移除，不能用它保护多时段。
- `planner_schedule_slots` 每个基础时段一行，主键 `(owner_id,date,template_version,slot_id)`，含 schedule_id，外键 `(owner_id,schedule_id)` 级联删除。数据库唯一键拒绝 `[2,3]` 与 `[3]` 的部分重叠。
- `planner_schedule_cells` 主键 `(owner_id,date,cell_id)`，同样含日程复合外键。时间单元是两个模板的共同分界：白天 8 个原块，晚间分为 `[18:30,20:00)`、`[20:00,20:15)`、`[20:15,21:00)`、`[21:00,22:00)` 四段。各合法时段是若干完整单元之和，所以该唯一键还阻止 v1 与 v2 重叠，不能通过换模板绕过占用。
- 两张支持表启用 RLS，客户端只读本人、无直接写权限；私有函数无客户端执行权限。日程 INSERT/UPDATE 触发器删除旧占位、插入新占位，DELETE 级联释放；这些操作和父日程属于同一事务，冲突回滚所有改变。新增迁移原子回填全部历史占位。
- 长期任务名称/颜色从同版本任务、分类按 ID 解析；title 保存创建/选择时的标题文本，临时事项用它显示。归档保留引用，已有日程仍可查看/编辑。临时事项不进入任务池，不参与任务进度。
- saveSchedule 为同 ID 新建/编辑，removeSchedule 只删除本人日程；两者沿用账号锁、revision 和 requestId。同 slot 新 ID 被唯一约束拒绝；旧 revision 先返回版本冲突；同 ID/同命令重试先返回旧回执。已移除的旧编辑器刷新后不能重新应用，以免复活删除项。
- `mergeSchedules { ids, result, contentConfirmed: true }`：至少两个不同且属于本账号的源日程，按时间检查同日、端点连续；result 保留其中一个源 ID、原始总时间和第一个源模板，禁止跨日或改变合并范围。服务端完整验证结果任务 ID、文字和时间后删除源日程并插入结果，任一异常整体回滚。界面不同内容逐项选择并最终确认；可反复合并。
- `splitSchedule { id, copyPlanText }`：云端读取原日程，按其保存的模板逐基础时段重建。首块保留原 ID，其余在首次事务内分配 UUID；重试先返回原回执，不重复分配。taskId/title 都保留；copyPlanText=true 复制范围和备注，否则仅首块保留。总时长不变，没有实际投入或进度写入。
- 混合模板的白天块可合并（基础定义相同）；合并结果仍须满足第一个源模板的准确边界。旧晚间块拆分仍为原 105 分钟定义，不强制转换为新模板。
- 只有分类、任务、日程、设置属于阶段 3 业务备份。两张占位表是可重建索引，不单独导入或导出；恢复插入日程时由触发器重建并检查。没有实际记录、预算或预测。

## 精确数量

前端与 JSON 的 totalUnits / initialCompletedUnits 使用十进制**字符串**，数据库使用精确 numeric。允许 0～999999999.999999、最多 6 位小数；不接受负数、指数、空格、前导零、NaN 或 Infinity。超精度拒绝，不四舍五入。TypeScript 用 BigInt 百万分单位比较，不经浮点加减。展示可移除小数末尾零；单位可自定义，最多 20 字符。

初始量不能超过已设总量。以后加入实际记录/周期目标时必须在同一账号事务锁内验证全部相关量，不能只沿用本阶段的初始量检查。

## 版本、读取与写入

- 数据库迁移文件版本、JSON schemaVersion、每用户 revision 是三个不同概念。
- 表单打开时固定 expectedRevision；全局刷新不会自动修改表单基础版本。用户对照最新列表后明确重新应用才会更新基础版本。
- 读取通过单个 RPC，账号版本行锁使完整快照与受控写入串行；一次返回所有已实现数据，不拼分页，不导出当前页面子集。
- 相同会话忽略迟到的旧版本；会话变化作废在途读取。换账号或退出销毁业务视图/草稿；保存结果未知时提示先确认再退出。
- 写入返回回执后才显示保存成功，随后重新读取完整快照。保存成功但重读失败会保留成功状态并提示取数失败，禁止基于尚未更新的快照继续编辑。
- 网络失败、超时、响应格式不明时保留原 Operation，锁定输入并提供确认/同 ID 重试。状态只在当前页面保留；关闭页面不后台补传，重新登录后需获取并人工核对是否已提交。
- 设置账号级锁是一种有意的简单取舍：两个设备修改不同任务也可能冲突，需要刷新后重新确认。

## 备份 v3

完整文件的顶层精确字段：`format: "study-planner"`、`schemaVersion: 3`、appVersion、exportedAt（含时区 ISO 时间）、可选 sourceRevision、data。data 精确包含 categories、tasks、schedules、settings；全部归档数据也在内。数组 ID 不重复、引用存在、数值有限且不超量，未知实体/额外字段拒绝，避免旧版应用吞掉新版数据。

不导出 owner_id、Auth 身份、密码/token/key、内部 revision 表或回执。sourceRevision 仅诊断；恢复不能重设服务器版本。新 owner 一律取当前 Auth 用户。导入限制 10 MiB；导出无分页截断，超出该规模需先升级恢复能力，不应删减备份。

预检读取最新云端，显示文件与当前数量，明确确认完整替换。点击确认时提交预检版本；期间任一设备写入都会拒绝恢复。服务器再次检查类型、引用和业务约束，事务替换日程、分类、任务、设置；失败不改变旧数据、版本或回执。恢复后产生更高版本，旧表单失效。

## 阶段 2 v2 迁移

v2 与 v3 的顶层字段相同，schemaVersion=2；严格要求每个日程为 v1 模板且恰好一个基础时段，拒绝伪装为 v2 的新模板／多时段文件。校验后升级版本号，完整保留日程 UUID、任务引用、原始 105 分钟快照、分类、任务与设置；不自动挪动或重切历史安排。导入预览显示 v2→v3 和日程数量，不显示“旧备份无日程”的错误提示。

v3 可包含两个模板、合并和基础块。按日期／实际时间排序检查相邻重叠，涵盖部分数组重叠及跨模板重叠；数据库约束再次验证。未来版本拒绝，不丢弃未知字段后恢复。

## 阶段 1 v1 迁移

v1 顶层字段与 v2 相同，但 schemaVersion=1，data 仅 categories/tasks/settings。先严格校验原结构，补 `schedules: []` 并通过完整 v3 引用、ID、进度与时间校验；保留 UUID、归档、位置和精确数值。伪称 v1 但带日程或未知字段的文件拒绝，不能静默丢弃。

来源版本、转换方向、文件/云端日程数量都在预检显示。旧备份完整恢复会清空现有日程，需显式确认；失败全部回滚，旧文件不变。服务器只接受当前完整数据集命令，不接受缺少 schedules 的旧客户端恢复请求；前端负责已验证的旧文件迁移。

## 约定旧格式与已有本地数据

阶段 0 没有业务存储，没有已发布的 IndexedDB 格式或已提供真实旧样本。此处仅定义并验证一个可支持的迁移契约，不声称迁移过真实个人数据：

- 顶层 `format: "study-planner-local"`、`schemaVersion: 0`、appVersion、exportedAt、data。
- data 字段与阶段 1 v1 相同（无 schedules），分类/任务 UUID、审计时间、归档字段都完整存在。
- 任务 totalUnits 是非负有限 JSON number 或 null，initialCompletedUnits 是非负有限 number；转换成十进制字符串后仍须通过最多 6 位小数检查，其余业务内容不变，补空 schedules 后完整校验到 v3。
- 如旧文件采用其他字段名、ID 或包含日程/记录/预算，本阶段拒绝；取得真实样本并建立完整映射后再支持，不能删掉未知实体后导入。

迁移入口与完整恢复共用校验和 RPC。旧数据在原浏览器/原网址导出，不改动原 IndexedDB；新网址不能读取其他 origin 的数据库。云端非空也必须先预览并确认替换，不自动合并。
