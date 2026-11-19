import { useState } from 'react'
import { minutesLabel, shiftDate } from '../../domain/calendar'
import { displayQuantity, subjectKey, type Capacity, type Dataset } from '../../domain/model'
import { capacityFor, entrySubject, isPlannable, poolEntries, sortPool, WEEK_STATUS, weekSummary } from '../../domain/planning'
import { editWeekItem, type PlannerActions } from './actions'
import { DateToolbar, Empty, EntryTag, Metric } from './controls'

type GoalRow = ReturnType<typeof weekSummary>['items'][number]

function GoalCard({ row, data, now, actions, nextWeek }: {
  row: GoalRow; data: Dataset; now: string; actions: PlannerActions; nextWeek: string | null
}) {
  const { entry, item } = row
  const unit = entry?.kind === 'task' ? entry.unitName : ''
  const active = item.status === 'active'
  const nextExists = data.weekItems.some(i => i.weekStart === nextWeek && subjectKey(i) === subjectKey(item))
  const canCarry = !!nextWeek && !nextExists && entry && isPlannable(entry, data) && !row.current.reached
  return <article className="goal-card">
    <div className="card-title">
      <h3>{entry?.title}</h3>
      <span className={`tag ${active && row.needsMore ? 'tag-warning' : 'tag-accent'}`}>{active ? row.scheduling : WEEK_STATUS[item.status]}</span>
    </div>
    <EntryTag entry={entry} data={data} now={now} />
    <p className="item-detail"><span>本周计划 <strong>{minutesLabel(item.minutes)}{item.targetUnits && ` · ${displayQuantity(item.targetUnits)} ${unit}`}</strong></span>
      <span>已排 {minutesLabel(row.plannedMinutes)}</span><span>实际 {minutesLabel(row.actualMinutes)}{unit && ` · ${row.actualUnits} ${unit}`}</span></p>
    {active && !row.current.reached && <p className="goal-gap">
      {row.missingUnits !== null
        ? `未来已覆盖 ${row.futureUnits} ${unit}，仍需安排 ${row.missingUnits} ${unit}`
        : `归入未来安排 ${minutesLabel(row.futureMinutes)}，剩余未排 ${minutesLabel(row.missingMinutes)}`}
      {row.missed > 0 && ` · ${row.missed} 项过去的安排待处理`}
    </p>}
    {!item.baseline && data.weeks.find(w => w.weekStart === item.weekStart)?.committedAt && <span className="tag">周中新增</span>}
    {active ? <div className="actions card-actions">
      {entry && isPlannable(entry, data) && <button disabled={actions.disabled} onClick={() => actions.schedule(item.weekStart, item,
        row.missingMinutes > 0 ? Math.min(1440, row.missingMinutes) : 0,
        row.missingUnits && row.missingUnits !== '0' ? row.missingUnits : null)}>安排到一天</button>}
      <button className="button-text" disabled={actions.disabled} onClick={() => actions.edit(editWeekItem(item), { existing: true })}>编辑目标</button>
      {entry?.kind === 'todo' && !entry.completedOn && <button className="button-text" disabled={actions.disabled}
        onClick={() => actions.run({ type: 'completeTodo', value: { id: entry.id, completed: true } })}>完成待办</button>}
      {canCarry && <button className="button-text" disabled={actions.disabled} onClick={() => actions.edit({
        type: 'carryWeekItem', value: { id: item.id, next: { id: crypto.randomUUID(), weekStart: nextWeek, taskId: item.taskId, todoId: item.todoId,
          minutes: item.targetUnits !== null ? item.minutes : row.leftMinutes || item.minutes,
          targetUnits: row.leftUnits && row.leftUnits !== '0' ? row.leftUnits : null } },
      })}>结转下周</button>}
      <details className="inline-menu"><summary>更多</summary><div className="actions">
        <button disabled={actions.disabled} onClick={() => actions.run({ type: 'setWeekItemStatus', value: { id: item.id, status: 'returned' } }, '将此目标退回任务池？已保存的安排和实际记录会保留。')}>退回待办</button>
        <button disabled={actions.disabled} onClick={() => actions.run({ type: 'setWeekItemStatus', value: { id: item.id, status: 'cancelled' } }, '取消本周目标？周初承诺、已有安排和实际记录会保留。')}>取消本周目标</button>
      </div></details>
    </div> : item.status !== 'carried' && entry && isPlannable(entry, data) && <button disabled={actions.disabled}
      onClick={() => actions.run({ type: 'setWeekItemStatus', value: { id: item.id, status: 'active' } })}>重新加入本周</button>}
  </article>
}

export function WeekPage({ data, date, now, setDate, actions }: {
  data: Dataset; date: string; now: string; setDate: (date: string) => void; actions: PlannerActions
}) {
  const [filter, setFilter] = useState(false)
  const summary = weekSummary(data, date, now), { week, end } = summary
  const nextWeek = shiftDate(week, 7)
  const planned = new Set(summary.items.map(r => subjectKey(r.item)))
  const pool = poolEntries(data).filter(e => isPlannable(e, data))
  const due = sortPool(pool.filter(e => e.dueDate && e.dueDate <= end && !planned.has(subjectKey(entrySubject(e)))), now, end)
  const targets = summary.items.filter(r => r.item.status === 'active')
  const edited = summary.items.filter(r => r.item.status !== 'active')
  const byPriority = new Map(sortPool(targets.flatMap(r => r.entry ? [r.entry] : []), now, end).map((e, i) => [subjectKey(entrySubject(e)), i]))
  targets.sort((a, b) => {
    const rank = (r: GoalRow) => r.entry?.dueDate && r.entry.dueDate <= end && !r.current.reached ? 0 : r.current.reached ? 3 : r.needsMore ? 1 : 2
    return rank(a) - rank(b) || (byPriority.get(subjectKey(a.item)) ?? 0) - (byPriority.get(subjectKey(b.item)) ?? 0)
  })
  const capacity = capacityFor(data, week, now)
  const emptyCapacity: Capacity = [0, 0, 0, 0, 0, 0, 0]
  const overload = summary.capacity === null ? 0 : Math.max(summary.plannedMinutes - summary.capacity, 0)
  const hasUnestimated = pool.filter(e => e.kind === 'todo' && e.estimatedMinutes === null && !planned.has(subjectKey(entrySubject(e)))).length
  return <div className="stack">
    <DateToolbar date={week} end={end} now={now} step={7} onChange={setDate} />
    <section className="panel stack" aria-label="本周容量">
      <div className="section-heading"><div><h2>时间容量</h2><p className="muted">{capacity === null ? '给这周设定每天可用的学习时间。' : summary.leftCapacity !== null ? `从今天起还可排 ${minutesLabel(summary.leftCapacity)}` : ''}</p></div>
        <div className="actions">
          <button disabled={actions.disabled} onClick={() => actions.edit({ type: 'saveWeekCapacity', value: { weekStart: week, capacity: [...(capacity ?? data.settings.capacityTemplate ?? emptyCapacity)] } })}>调整本周</button>
          <button disabled={actions.disabled} className="button-text" onClick={() => actions.edit({ type: 'saveCapacityTemplate', value: { capacity: [...(data.settings.capacityTemplate ?? capacity ?? emptyCapacity)] } })}>常规模板</button>
        </div>
      </div>
      <div className="metrics">
        <Metric label="每周可用" minutes={summary.capacity} />
        <Metric label="本周计划" minutes={summary.plannedMinutes} tone={overload ? 'warning' : undefined} />
        <Metric label="已排日历" minutes={summary.scheduledMinutes} />
        <Metric label="实际投入" minutes={summary.actualMinutes} tone="accent" />
      </div>
      {overload > 0 && <p className="notice notice-warning" role="status">本周计划超出容量 {minutesLabel(overload)}。可以减少目标、增加容量或保留当前计划。</p>}
      {hasUnestimated > 0 && <p className="muted">任务池还有 {hasUnestimated} 项未纳入本周的待办待估算。</p>}
    </section>
    {due.length > 0 && <section className="panel stack">
      <h2>本周到期及逾期 · 尚未纳入计划</h2>
      {due.map(e => <div className="list-row" key={subjectKey(entrySubject(e))}><div><strong>{e.title}</strong><EntryTag entry={e} data={data} now={now} /></div>
        <button disabled={actions.disabled} onClick={() => actions.plan(e)}>加入本周</button></div>)}
    </section>}
    <section className="panel stack" aria-label="本周目标">
      <div className="section-heading">
        <div><h2>本周目标</h2><p className="muted">{summary.committedAt ? '已保存周初计划。调整与新增会在复盘中分别展示。' : '先选重点并估时，确认后保留周初目标供复盘。'}</p></div>
        <div className="actions">
          <button disabled={actions.disabled || !pool.some(e => !planned.has(subjectKey(entrySubject(e))))} className="button-primary" onClick={() => actions.plan()}>＋ 加入本周</button>
          {!summary.committedAt && <button disabled={actions.disabled || !targets.length}
            onClick={() => actions.run({ type: 'commitWeek', value: { weekStart: week } }, '确认当前列出的目标为本周初始计划？后续仍可调整，复盘会保留此版本。')}>确认周初计划</button>}
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={filter} onChange={e => setFilter(e.target.checked)} />只看仍需安排</label>
      {!targets.length && <Empty>本周还没有目标。可以从任务池挑选长期任务或一次性待办。</Empty>}
      {targets.length > 0 && filter && !targets.some(r => r.needsMore) && <Empty>本周没有待安排的目标。</Empty>}
      {targets.filter(r => !filter || r.needsMore).map(row => <GoalCard key={row.item.id} row={row} data={data} now={now} actions={actions} nextWeek={nextWeek} />)}
      {!filter && edited.length > 0 && <details className="history-details">
        <summary>已调整的目标（{edited.length}）</summary>
        {edited.map(row => <GoalCard key={row.item.id} row={row} data={data} now={now} actions={actions} nextWeek={nextWeek} />)}
      </details>}
    </section>
  </div>
}
