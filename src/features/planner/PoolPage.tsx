import { useState } from 'react'
import { displayQuantity, quantityTicks, subjectKey, type Category, type Dataset, type Project } from '../../domain/model'
import { hoursLabel } from '../../domain/calendar'
import { entrySubject, isOpen, isPlannable, poolEntries, sortPool, type PoolEntry } from '../../domain/planning'
import { taskProgress } from '../../domain/work-logs'
import { AddButton, Empty, EntryTag, ProgressBar } from './controls'
import { newTask, newTodo, type PlannerActions } from './actions'

function PoolCard({ entry, data, now, actions }: { entry: PoolEntry; data: Dataset; now: string; actions: PlannerActions }) {
  const progress = entry.kind === 'task' ? taskProgress(entry, data.workLogs, now) : null
  const total = entry.kind === 'task' && entry.totalUnits !== null ? quantityTicks(entry.totalUnits) : 0n
  const edit = () => {
    const { id, title, categoryId, projectId, priority, dueDate, note, archived } = entry
    const shared = { id, title, projectId, priority, dueDate, note, archived }
    if (entry.kind === 'task') {
      const { unitName, totalUnits, initialCompletedUnits, initialProgressLabel } = entry
      actions.edit({ type: 'saveTask', value: { ...shared, categoryId: entry.categoryId, unitName, totalUnits, initialCompletedUnits, initialProgressLabel } }, { existing: true })
    } else {
      actions.edit({ type: 'saveTodo', value: { ...shared, categoryId, estimatedMinutes: entry.estimatedMinutes } }, { existing: true })
    }
  }
  return <article className="pool-card">
    <div className="card-title">
      <div><h3>{entry.title}</h3><EntryTag entry={entry} data={data} now={now} /></div>
      <button type="button" className="activation-button" aria-pressed={entry.activated}
        aria-label={`${entry.title}：${entry.activated ? '取消激活' : '激活'}`}
        disabled={actions.disabled || (!entry.activated && !isPlannable(entry, data))}
        onClick={() => actions.run({ type: 'setSubjectActivated', value: { id: entry.id, kind: entry.kind, activated: !entry.activated } })}>
        <span className="activation-dot" aria-hidden="true" />{entry.activated ? '已激活' : '激活'}
      </button>
    </div>
    {entry.kind === 'task' && progress && <>
      {total > 0n ? <ProgressBar label="累计进度" ratio={Number(progress.completedTicks) / Number(total)}
        detail={`${progress.completedUnits} / ${displayQuantity(entry.totalUnits!)} ${entry.unitName}`} />
        : <p className="item-detail">累计进度 <strong>{progress.completedUnits} {entry.unitName}</strong></p>}
      <p className="muted">累计投入 {hoursLabel(progress.actualMinutes)}{progress.progressLabel && ` · 最近位置 ${progress.progressLabel}`}</p>
    </>}
    {entry.kind === 'todo' && <p className="muted">{entry.completedOn ? `${entry.completedOn} 完成` :
      entry.estimatedMinutes === null ? '待估算' : `预计 ${hoursLabel(entry.estimatedMinutes)}`}</p>}
    {entry.note && <p className="item-note">{entry.note}</p>}
    <div className="pool-card-footer">
      <span className="muted">{entry.archived ? '已归档' : entry.kind === 'todo' ? '临时待办' : '长期任务'}</span>
      <button disabled={actions.disabled} className="button-text" onClick={edit}>编辑</button>
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
  const search = query.trim().toLowerCase()
  const entries = sortPool(poolEntries(data).filter(e => (filter === 'all' || e.kind === filter)
    && (closed || isOpen(e))
    && (!search || [e.title, e.note, data.categories.find(c => c.id === e.categoryId)?.name,
      data.projects.find(p => p.id === e.projectId)?.title].some(part => part?.toLowerCase().includes(search)))), now)
  const cards = (rows: PoolEntry[]) => rows.length > 0 &&
    <div className="pool-cards">{rows.map(e => <PoolCard key={subjectKey(entrySubject(e))} entry={e} data={data} now={now} actions={actions} />)}</div>
  const categoryGroups = data.categories.filter(c => (!search && (closed || !c.archived)) || entries.some(e => e.categoryId === c.id))
  const inbox = entries.filter(e => e.categoryId === null)
  const addTodo = (categoryId: string | null, projectId: string | null) =>
    actions.edit({ type: 'saveTodo', value: newTodo(categoryId, projectId) }, { title: '新增临时待办' })
  const addItemButtons = (category: Category, project: Project | null) =>
    <div className="pool-additions">
      {filter !== 'todo' && <AddButton disabled={actions.disabled}
        onClick={() => actions.edit({ type: 'saveTask', value: newTask(category.id, project?.id) }, { title: '新增长期任务' })}>新增长期任务</AddButton>}
      {filter !== 'task' && <AddButton disabled={actions.disabled}
        onClick={() => addTodo(category.id, project?.id ?? null)}>新增临时待办</AddButton>}
      {project === null && <AddButton disabled={actions.disabled}
        onClick={() => actions.edit({ type: 'saveProject', value: { id: crypto.randomUUID(), categoryId: category.id, title: '', archived: false } },
          { title: '新增项目' })}>新增项目</AddButton>}
    </div>
  return <div className="stack">
    <div className="filter-row">
      <div className="segmented" aria-label="任务类型">
        {(['all', 'todo', 'task'] as const).map((id, i) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{['全部', '临时待办', '长期任务'][i]}</button>)}
      </div>
      <input type="search" aria-label="搜索任务" placeholder="搜索任务或分类" value={query} onChange={e => setQuery(e.target.value)} />
      <label className="check"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} />显示完成与归档</label>
    </div>
    {filter !== 'task' && (!search || inbox.length > 0) && <section className="panel stack" aria-labelledby="pool-inbox">
      <div className="section-heading"><h2 id="pool-inbox">收件箱</h2></div>
      {cards(inbox)}
      <div className="pool-additions"><AddButton disabled={actions.disabled} onClick={() => addTodo(null, null)}>新增临时待办</AddButton></div>
    </section>}
    {categoryGroups.map(category => <section className="panel stack" key={category.id} aria-label={category.name}>
      <div className="section-heading"><h2><span className="color-dot" style={{ background: category.color }} />{category.name}{category.archived && '（已归档）'}</h2>
        <EditGroup category={category} actions={actions} /></div>
      {cards(entries.filter(e => e.categoryId === category.id && !e.projectId))}
      {!category.archived && addItemButtons(category, null)}
      {data.projects.filter(p => p.categoryId === category.id && (entries.some(e => e.projectId === p.id) || (!search && (closed || !p.archived)))).map(project =>
        <section className="project-group stack" key={project.id} aria-label={project.title}>
          <div className="section-heading"><h3>{project.title}{project.archived && '（已归档）'}</h3><EditGroup project={project} actions={actions} /></div>
          {cards(entries.filter(e => e.projectId === project.id))}
          {!category.archived && !project.archived && addItemButtons(category, project)}
        </section>)}
    </section>)}
    {search && entries.length === 0 && <Empty>没有匹配的任务。</Empty>}
    {!search && <AddButton disabled={actions.disabled} onClick={() => actions.edit({ type: 'saveCategory', value: {
      id: crypto.randomUUID(), name: '', color: '#087b68', archived: false,
    } }, { title: '新增分类' })}>新增分类</AddButton>}
  </div>
}
