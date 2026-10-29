import { useState } from 'react'
import { today, isBusinessDate } from '../../domain/calendar'
import { taskProgress } from '../../domain/work-logs'
import { displayQuantity, type Snapshot } from '../../domain/model'
import type { Editor } from './TaskEditor'
export function TaskList({ snapshot, disabled, edit }: { snapshot: Snapshot; disabled: boolean; edit: (editor: Editor) => void }) {
  const [through, setThrough] = useState(today)
  const [showArchived, setShowArchived] = useState(false)
  return <>
    <div className="actions">
      <button disabled={disabled} onClick={() => edit({ kind: 'category', base: snapshot.revision, value: { id: crypto.randomUUID(), name: '', color: '#32796b', archived: false } })}>新增分类</button>
      <button disabled={disabled || !snapshot.categories.length} onClick={() => edit({ kind: 'task', base: snapshot.revision, value: { id: crypto.randomUUID(), title: '', categoryId: snapshot.categories.find(c => !c.archived)?.id ?? snapshot.categories[0].id, unitName: '节', totalUnits: null, initialCompletedUnits: '0', initialProgressLabel: '', note: '', archived: false } })}>新增长期任务</button>
    </div>
    <label>进度统计截至日期<input type="date" min="0001-01-01" max="9999-12-31" value={through} onChange={e => { if (isBusinessDate(e.target.value)) setThrough(e.target.value) }} /></label>
    <label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />显示已归档分类与任务</label>
    {!snapshot.categories.length && <p className="empty">还没有分类。先创建分类，再添加学习任务。</p>}
    <div className="category-list">{snapshot.categories.filter(c => showArchived || !c.archived || snapshot.tasks.some(t => t.categoryId === c.id && !t.archived)).map(c => <section className="panel" key={c.id}>
      <div className="row"><h2><span className="color-dot" style={{ background: c.color }} />{c.name}{c.archived && '（已归档）'}</h2>
        <button disabled={disabled} onClick={() => edit({ kind: 'category', base: snapshot.revision, value: { id: c.id, name: c.name, color: c.color, archived: c.archived } })}>编辑分类</button></div>
      {snapshot.tasks.filter(t => t.categoryId === c.id && (showArchived || !t.archived)).map(t => <article className="task-card" key={t.id}>
        <h3>{t.title}{t.archived && '（已归档）'}</h3>
        <p>已完成 {taskProgress(t, snapshot.workLogs, through).completedUnits} / {t.totalUnits === null ? '总量未设置' : displayQuantity(t.totalUnits)} {t.unitName}</p>
        <p>截至 {through} 实际投入：{taskProgress(t, snapshot.workLogs, through).actualMinutes} 分钟</p>
        <p>位置：{taskProgress(t, snapshot.workLogs, through).progressLabel || '尚未填写'}</p>{t.note && <p className="preserve-lines">{t.note}</p>}
        <button disabled={disabled} onClick={() => {
          const value = { id: t.id, categoryId: t.categoryId, title: t.title, unitName: t.unitName, totalUnits: t.totalUnits, initialCompletedUnits: t.initialCompletedUnits, initialProgressLabel: t.initialProgressLabel, note: t.note, archived: t.archived }
          edit({ kind: 'task', base: snapshot.revision, value })
        }}>编辑任务 / 归档</button>
      </article>)}
    </section>)}</div>
  </>
}
