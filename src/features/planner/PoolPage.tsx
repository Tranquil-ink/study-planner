import { useState } from 'react'
import { minutesLabel } from '../../domain/calendar'
import { displayQuantity, quantityTicks, subjectKey, type Category, type Dataset, type Project } from '../../domain/model'
import { entrySubject, isOpen, isPlannable, poolEntries, sortPool, type PoolEntry } from '../../domain/planning'
import { taskProgress } from '../../domain/work-logs'
import { Empty, EntryTag } from './controls'
import type { PlannerActions } from './actions'

function PoolCard({ entry, data, now, actions }: { entry: PoolEntry; data: Dataset; now: string; actions: PlannerActions }) {
  const progress = entry.kind === 'task' ? taskProgress(entry, data.workLogs, now) : null
  return <article className="pool-card">
    <div className="card-title"><h3>{entry.title}</h3>
      <span className="tag">{entry.archived ? '已归档' : entry.kind === 'todo' && entry.completedOn ? '已完成' : entry.kind === 'todo' ? '一次性待办' : '长期任务'}</span>
    </div>
    <EntryTag entry={entry} data={data} now={now} />
    {entry.kind === 'task' && progress && <>
      <p className="item-detail"><strong>{progress.completedUnits}{entry.totalUnits === null ? '' : ` / ${displayQuantity(entry.totalUnits)}`} {entry.unitName}</strong>
        <span>累计投入 {minutesLabel(progress.actualMinutes)}</span></p>
      {entry.totalUnits !== null && quantityTicks(entry.totalUnits) > 0n && <progress
        aria-label={`${entry.title}累计进度`} value={Number(quantityTicks(progress.completedUnits))} max={Number(quantityTicks(entry.totalUnits))} />}
      {progress.progressLabel && <p className="muted">最近位置 · {progress.progressLabel}</p>}
    </>}
    {entry.kind === 'todo' && <p className="muted">{entry.estimatedMinutes === null ? '待估算' : `预计 ${minutesLabel(entry.estimatedMinutes)}`}{entry.completedOn && ` · ${entry.completedOn} 完成`}</p>}
    {entry.note && <p className="item-note">{entry.note}</p>}
    <div className="actions card-actions">
      {isPlannable(entry, data) && <button disabled={actions.disabled} onClick={() => actions.plan(entry)}>加入本周</button>}
      <button disabled={actions.disabled} className="button-text" onClick={() => {
        const { id, title, categoryId, projectId, priority, dueDate, note, archived } = entry
        const shared = { id, title, projectId, priority, dueDate, note, archived }
        if (entry.kind === 'task') {
          const { unitName, totalUnits, initialCompletedUnits, initialProgressLabel } = entry
          actions.edit({ type: 'saveTask', value: { ...shared, categoryId: entry.categoryId, unitName, totalUnits, initialCompletedUnits, initialProgressLabel } }, { existing: true })
        } else {
          actions.edit({ type: 'saveTodo', value: { ...shared, categoryId, estimatedMinutes: entry.estimatedMinutes } }, { existing: true })
        }
      }}>编辑</button>
      {entry.kind === 'todo' && !entry.archived && <button disabled={actions.disabled} className="button-text"
        onClick={() => actions.run({ type: 'completeTodo', value: { id: entry.id, completed: !entry.completedOn } })}>
        {entry.completedOn ? '重新打开' : '完成待办'}
      </button>}
    </div>
  </article>
}

function EditGroup({ category, project, actions }: { category?: Category; project?: Project; actions: PlannerActions }) {
  if (project) return <button disabled={actions.disabled} className="button-text" onClick={() => {
    const { id, categoryId, title, archived } = project
    actions.edit({ type: 'saveProject', value: { id, categoryId, title, archived } }, { existing: true })
  }}>编辑项目</button>
  if (category) return <button disabled={actions.disabled} className="button-text" onClick={() => {
    const { id, name, color, archived } = category
    actions.edit({ type: 'saveCategory', value: { id, name, color, archived } }, { existing: true })
  }}>编辑分类</button>
}

export function PoolPage({ data, now, actions }: { data: Dataset; now: string; actions: PlannerActions }) {
  const [filter, setFilter] = useState<'all' | 'todo' | 'task'>('all')
  const [closed, setClosed] = useState(false)
  const [query, setQuery] = useState('')
  const activeCategory = data.categories.find(c => !c.archived)
  const entries = sortPool(poolEntries(data).filter(e => (filter === 'all' || e.kind === filter)
    && (closed || isOpen(e))
    && (!query.trim() || [e.title, e.note, data.categories.find(c => c.id === e.categoryId)?.name,
      data.projects.find(p => p.id === e.projectId)?.title].some(part => part?.toLowerCase().includes(query.trim().toLowerCase())))), now)
  const cards = (rows: PoolEntry[]) => <div className="pool-cards">{rows.map(e => <PoolCard key={subjectKey(entrySubject(e))} entry={e} data={data} now={now} actions={actions} />)}</div>
  const categoryGroups = data.categories.filter(c => (filter === 'all' && !query.trim() && (closed || !c.archived)) || entries.some(e => e.categoryId === c.id))
  const inbox = entries.filter(e => e.categoryId === null)
  const blankTodo = { id: '', title: '', categoryId: null, projectId: null, priority: 'normal' as const, dueDate: null, estimatedMinutes: null, note: '', archived: false }
  return <div className="stack">
    <div className="page-tools">
      <button className="button-primary" disabled={actions.disabled} onClick={() => actions.edit({ type: 'saveTodo', value: { ...blankTodo, id: crypto.randomUUID() } }, { title: '收集一次性待办' })}>＋ 收集待办</button>
      <button disabled={actions.disabled || !activeCategory} onClick={() => actions.edit({ type: 'saveTask', value: {
        id: crypto.randomUUID(), categoryId: activeCategory?.id ?? '', projectId: null, title: '', unitName: '页',
        totalUnits: null, initialCompletedUnits: '0', initialProgressLabel: '', note: '', archived: false, priority: 'normal', dueDate: null,
      } }, { title: '新增长期任务' })}>新增长期任务</button>
      <button disabled={actions.disabled} onClick={() => actions.edit({ type: 'saveCategory', value: { id: crypto.randomUUID(), name: '', color: '#087b68', archived: false } }, { title: '新增分类' })}>新增分类</button>
      <button disabled={actions.disabled || !activeCategory} onClick={() => actions.edit({ type: 'saveProject', value: { id: crypto.randomUUID(), categoryId: activeCategory?.id ?? '', title: '', archived: false } }, { title: '新增项目' })}>新增项目</button>
    </div>
    <div className="filter-row">
      <div className="segmented" aria-label="任务类型">
        {(['all', 'todo', 'task'] as const).map((id, i) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{['全部', '一次性待办', '长期任务'][i]}</button>)}
      </div>
      <input type="search" aria-label="搜索任务" placeholder="搜索任务或分类" value={query} onChange={e => setQuery(e.target.value)} />
      <label className="check"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} />显示完成与归档</label>
    </div>
    {!data.categories.length && <Empty>创建分类后就可以添加长期任务。临时事项可以直接放入收件箱。</Empty>}
    {inbox.length > 0 && <section className="panel stack"><div className="section-heading"><h2>收件箱</h2><span className="muted">未分类待办</span></div>{cards(inbox)}</section>}
    {categoryGroups.map(category => <section className="panel stack" key={category.id}>
      <div className="section-heading"><h2><span className="color-dot" style={{ background: category.color }} />{category.name}{category.archived && '（已归档）'}</h2>
        <EditGroup category={category} actions={actions} /></div>
      {data.projects.filter(p => p.categoryId === category.id && (entries.some(e => e.projectId === p.id) || (filter === 'all' && !query.trim() && (closed || !p.archived)))).map(project => <section className="project-group" key={project.id}>
        <div className="section-heading"><h3>{project.title}{project.archived && '（已归档）'}</h3><EditGroup project={project} actions={actions} /></div>
        {cards(entries.filter(e => e.projectId === project.id))}
      </section>)}
      {cards(entries.filter(e => e.categoryId === category.id && !e.projectId))}
      {!entries.some(e => e.categoryId === category.id) && <p className="muted">这个分类还没有可显示的任务。</p>}
    </section>)}
    {entries.length === 0 && categoryGroups.length === 0 && (data.categories.length > 0 || query.trim()) && <Empty>没有匹配的任务。</Empty>}
  </div>
}
