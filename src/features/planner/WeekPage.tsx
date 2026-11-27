import { hoursLabel } from '../../domain/calendar'
import { subjectKey, type Dataset } from '../../domain/model'
import { capacityFor, dueWithinTwoWeeks, emptyCapacity, entrySubject, isPlannable, poolEntries, weekCandidates,
  WEEK_STATUS, weekSummary, type GoalRow } from '../../domain/planning'
import type { PlannerActions } from './actions'
import { ActionMenu, DateToolbar, Empty, EntryTag, GoalProgress, Metric, type PageToolbar } from './controls'

function GoalCard({ row, data, now, actions }: {
  row: GoalRow; data: Dataset; now: string; actions: PlannerActions
}) {
  const { entry, item, budget } = row
  const active = item.status === 'active'
  return <article className="goal-card goal-list-card">
    <div className="card-title">
      <div><h3>{entry?.title}</h3><EntryTag entry={entry} data={data} now={now} /></div>
      {!active && <span className="tag">{WEEK_STATUS[item.status]}</span>}
    </div>
    <dl className="goal-budget">
      <div><dt>本周计划</dt><dd>{hoursLabel(item.minutes)}</dd></div>
      <div><dt>{budget >= 0 ? '预算剩余' : '超出预算'}</dt><dd className={budget < 0 ? 'warning-text' : ''}>{hoursLabel(Math.abs(budget))}</dd></div>
    </dl>
    <GoalProgress row={row} />
    {active && entry && <div className="actions">
      <button className="button-text" disabled={actions.disabled} onClick={() => actions.plan(item.weekStart, entry)}>编辑目标</button>
      {!row.projected && <ActionMenu className="icon-menu quiet-actions" label="目标操作">
        <button type="button" disabled={actions.disabled} onClick={() => actions.run({
          type: 'setWeekItemStatus', value: { id: item.id, status: 'cancelled' },
        }, '取消本周目标？已有安排和实际记录会保留。')}>取消目标</button>
      </ActionMenu>}
    </div>}
  </article>
}

export function WeekPage({ data, date, now, setDate, actions, toolbar }: {
  data: Dataset; date: string; now: string; setDate: (date: string) => void; actions: PlannerActions; toolbar: PageToolbar
}) {
  const summary = weekSummary(data, date, now), { week, end } = summary
  const targets = summary.items.filter(row => row.item.status === 'active')
  const history = summary.items.filter(row => row.item.status !== 'active')
  const hiddenSubjects = new Set(summary.items.filter(r => r.item.status === 'active' || r.item.status === 'carried').map(r => subjectKey(r.item)))
  const candidates = weekCandidates(data, week, now)
  const visible = new Set([...hiddenSubjects, ...candidates.map(e => subjectKey(entrySubject(e)))])
  const hasMore = poolEntries(data).some(entry => isPlannable(entry, data) && !visible.has(subjectKey(entrySubject(entry))))
  const capacity = capacityFor(data, week, now)
  const template = data.settings.capacityTemplate
  const overload = summary.capacity === null ? 0 : Math.max(summary.plannedMinutes - summary.capacity, 0)
  return <>
    {toolbar(<DateToolbar date={week} end={end} now={now} step={7} onChange={setDate} />)}
    <div className="stack week-page">
      <section className="panel stack" aria-label="本周容量">
        <div className="section-heading">
          <h2>本周可用时间</h2>
          <ActionMenu label="容量设置" trigger="容量设置">
            <button type="button" disabled={actions.disabled || template === null} onClick={() => {
              if (template) actions.run({ type: 'saveWeekCapacity', value: { weekStart: week, capacity: template } })
            }}>采用默认配置</button>
            <button type="button" disabled={actions.disabled} onClick={() => actions.edit({
              type: 'saveWeekCapacity', value: { weekStart: week, capacity: capacity ?? template ?? emptyCapacity() },
            }, { title: '本周临时配置' })}>本周临时配置</button>
            <button type="button" disabled={actions.disabled} onClick={() => actions.edit({
              type: 'saveCapacityTemplate', value: { capacity: template ?? emptyCapacity() },
            }, { title: '编辑默认配置' })}>编辑默认配置</button>
          </ActionMenu>
        </div>
        <div className="metrics metrics-three">
          <Metric label="每周可用" minutes={summary.capacity} />
          <Metric label="目标计划" minutes={summary.plannedMinutes} tone={overload ? 'warning' : undefined} />
          <Metric label="剩余可安排时间" minutes={summary.remainingCapacity}
            tone={summary.capacity !== null && summary.scheduledMinutes > summary.capacity ? 'warning' : 'accent'} />
        </div>
        {overload > 0 && <p className="notice notice-warning" role="status">目标计划超出本周容量 {hoursLabel(overload)}。</p>}
      </section>
      <section className="panel stack" aria-label="本周目标清单">
        <div className="section-heading">
          <h2>目标清单</h2>
          <div className="actions">
            <button className="button-primary" disabled={actions.disabled || !hasMore} onClick={() => actions.plan(week)}>＋ 选择本周任务</button>
            {!summary.committedAt && <button disabled={actions.disabled || !targets.length}
              onClick={() => actions.run({ type: 'commitWeek', value: { weekStart: week } }, '保存此时的目标供复盘对照？')}>确认周初计划</button>}
          </div>
        </div>
        {!targets.length && !candidates.length && <Empty>在任务池激活任务，或在这里选择本周任务。</Empty>}
        <div className="goal-list">
          {targets.map(row => <GoalCard key={subjectKey(row.item)} row={row} data={data} now={now} actions={actions} />)}
          {candidates.map(entry => <article className="goal-card goal-list-card" key={subjectKey(entrySubject(entry))}>
            <div className="card-title">
              <div><h3>{entry.title}</h3><EntryTag entry={entry} data={data} now={now} /></div>
              <span className="tag tag-accent">{dueWithinTwoWeeks(entry, week) ? '近两周截止' : '已激活'}</span>
            </div>
            <div className="item-detail">本周计划与预算待设置</div>
            <button className="button-text" disabled={actions.disabled} onClick={() => actions.plan(week, entry)}>设定目标</button>
          </article>)}
        </div>
        {history.length > 0 && <details className="history-details">
          <summary>历史调整（{history.length}）</summary>
          <div className="goal-list">{history.map(row =>
            <GoalCard key={row.item.id} row={row} data={data} now={now} actions={actions} />)}</div>
        </details>}
      </section>
    </div>
  </>
}
