import { useState } from 'react'
import { dateLabel, minutesLabel, monthDay, sumMinutes } from '../../domain/calendar'
import { displayQuantity, type Dataset, type ScheduleBlock, type WorkLog } from '../../domain/model'
import { daySummary, selectedEntry, unresolved, weekSummary } from '../../domain/planning'
import { DateToolbar, Empty, EntryTag, Metric } from './controls'
import type { PlannerActions } from './actions'

function ScheduleCard({ data, row, today, actions }: { data: Dataset; row: ScheduleBlock; today: string; actions: PlannerActions }) {
  const { id, date, taskId, todoId, title, plannedMinutes, plannedUnits, plannedRangeText, note, resolved } = row
  const entry = selectedEntry(data, row)
  const records = data.workLogs.filter(log => log.scheduleBlockId === id && log.date <= today)
  const pending = unresolved(row, data, today)
  return <article className={`schedule-card ${pending ? '' : 'is-handled'}`}>
    <div className="card-title"><h3>{entry?.title ?? title}</h3>
      {!pending && <span className="tag tag-accent">{resolved ? '已处理' : '待办已完成'}</span>}
      {pending && date < today && <span className="tag tag-warning">待处理</span>}
    </div>
    <EntryTag entry={entry} data={data} now={today} />
    <p className="item-detail">
      <span>计划 <strong>{minutesLabel(plannedMinutes)}{entry?.kind === 'task' && plannedUnits && ` · ${displayQuantity(plannedUnits)} ${entry.unitName}`}</strong></span>
      <span>{records.length ? `关联实际 ${minutesLabel(sumMinutes(records, l => l.actualMinutes))}` : '尚无实际记录'}</span>
    </p>
    {(plannedRangeText || note) && <p className="item-note">{[plannedRangeText, note].filter(Boolean).join(' · ')}</p>}
    <div className="actions card-actions">
      {date <= today && <button disabled={actions.disabled} onClick={() => actions.record(date, row)}>记实际</button>}
      <button disabled={actions.disabled} className="button-text" onClick={() => actions.edit({
        type: 'saveSchedule', value: { id, date, taskId, todoId, title, plannedMinutes, plannedUnits, plannedRangeText, note, resolved },
      }, { existing: true, title: '编辑或改期' })}>编辑或改期</button>
      {(date <= today || resolved) && (pending || resolved) && <button disabled={actions.disabled} className="button-text"
        onClick={() => actions.run({ type: 'resolveSchedule', value: { id, resolved: !resolved } })}>
        {resolved ? '重新打开安排' : '标记已处理'}
      </button>}
      {entry?.kind === 'todo' && !entry.completedOn && <button disabled={actions.disabled} className="button-text"
        onClick={() => actions.run({ type: 'completeTodo', value: { id: entry.id, completed: true } })}>完成待办</button>}
    </div>
  </article>
}

function LogCard({ log, data, actions }: { log: WorkLog; data: Dataset; actions: PlannerActions }) {
  const { id, date, taskId, todoId, scheduleBlockId, titleSnapshot, actualMinutes, progressDelta, progressLabel, note } = log
  const entry = selectedEntry(data, log)
  return <article className="list-row log-row"><div>
    <h3>{entry?.title ?? titleSnapshot}</h3>
    <p className="muted">{minutesLabel(actualMinutes)}{entry?.kind === 'task' && progressDelta !== null && ` · 新增 ${displayQuantity(progressDelta)} ${entry.unitName}`}{progressLabel && ` · ${progressLabel}`}</p>
    {!scheduleBlockId && <span className="tag">补记</span>}
    {note && <p className="item-note">{note}</p>}
    {scheduleBlockId && data.schedules.some(s => s.id === scheduleBlockId && s.date !== date) && <p className="muted">关联安排的计划日期与实际发生日期不同</p>}
  </div>
    <button className="button-text" disabled={actions.disabled} onClick={() => actions.edit({
      type: 'saveWorkLog', value: { id, date, taskId, todoId, scheduleBlockId, titleSnapshot, actualMinutes, progressDelta, progressLabel, note },
    }, { existing: true, title: '编辑实际记录' })}>编辑记录</button></article>
}

export function DayPage({ data, date, now, actions }: {
  data: Dataset; date: string; now: string; actions: PlannerActions
}) {
  const day = daySummary(data, date, now)
  const overdue = date === now ? data.schedules.filter(s => s.date < now && unresolved(s, data, now)) : []
  const open = day.schedules.filter(s => unresolved(s, data, now))
  const closed = day.schedules.filter(s => !unresolved(s, data, now))
  const next = open[0]
  return <div className="stack">
    <section className="panel day-overview">
      <div className="section-heading"><div><h2>{date === now ? '今日概览' : dateLabel(date)}</h2>
        {next && date >= now && <p className="muted">下一项 · {selectedEntry(data, next)?.title ?? next.title}</p>}</div>
        <div className="actions"><button className="button-primary" disabled={actions.disabled} onClick={() => actions.schedule(date)}>＋ 安排任务</button>
          {date <= now && <button disabled={actions.disabled} onClick={() => actions.record(date)}>补记实际</button>}</div></div>
      <div className="metrics metrics-three"><Metric label="当天可用" minutes={day.capacity} />
        <Metric label="当天已排" minutes={day.scheduledMinutes} tone={day.capacity !== null && day.scheduledMinutes > day.capacity ? 'warning' : undefined} />
        <Metric label="当天实际" minutes={day.actualMinutes} tone="accent" /></div>
      {day.capacity !== null && day.scheduledMinutes > day.capacity && <p className="notice notice-warning">当天已排超出可用时间 {minutesLabel(day.scheduledMinutes - day.capacity)}。</p>}
    </section>
    <div className="day-columns">
      <section className="panel stack">
        <h2>学习安排</h2>
        {!day.schedules.length && <Empty>这一天还没有安排。可以在本周计划里选任务，或直接添加安排。</Empty>}
        {open.map(row => <ScheduleCard key={row.id} data={data} row={row} today={now} actions={actions} />)}
        {closed.length > 0 && <details className="history-details"><summary>已处理或完成（{closed.length}）</summary>
          {closed.map(row => <ScheduleCard key={row.id} data={data} row={row} today={now} actions={actions} />)}
        </details>}
      </section>
      <section className="panel stack">
        <h2>实际记录</h2>
        {!day.logs.length && <Empty>{date > now ? '到这一天后可以记录实际投入。' : '这一天还没有实际学习记录。'}</Empty>}
        {day.logs.map(log => <LogCard key={log.id} log={log} data={data} actions={actions} />)}
      </section>
    </div>
    {overdue.length > 0 && <section className="panel">
      <details className="history-details"><summary>过去的安排待处理（{overdue.length}）</summary>
        <div className="pool-cards">{[...overdue].reverse().map(row => <div key={row.id}>
          <p className="muted">{dateLabel(row.date)}</p><ScheduleCard data={data} row={row} today={now} actions={actions} />
        </div>)}</div>
      </details>
    </section>}
  </div>
}

export function CalendarPage({ data, date, now, setDate, initialMode, actions }: {
  data: Dataset; date: string; now: string; setDate: (date: string) => void; initialMode: 'week' | 'day'; actions: PlannerActions
}) {
  const [mode, setMode] = useState(initialMode)
  const week = weekSummary(data, date, now)
  const inWeek = mode === 'week'
  return <div className="stack">
    <div className="calendar-tools">
      <DateToolbar date={inWeek ? week.week : date} end={inWeek ? week.end : undefined} now={now} step={inWeek ? 7 : 1} onChange={setDate} />
      <div className="segmented" aria-label="日历视图">
        <button aria-pressed={inWeek} onClick={() => setMode('week')}>周视图</button>
        <button aria-pressed={!inWeek} onClick={() => setMode('day')}>日视图</button>
      </div>
    </div>
    {inWeek ? <>
      <section className="panel calendar-overview"><div className="section-heading"><h2>这一周</h2>
        <button className="button-primary" disabled={actions.disabled} onClick={() => actions.schedule(date)}>＋ 安排任务</button></div>
        <div className="metrics metrics-three">
          <Metric label="可用时间" minutes={week.capacity} /><Metric label="已排日历" minutes={week.scheduledMinutes} /><Metric label="实际投入" minutes={week.actualMinutes} tone="accent" />
        </div></section>
      <div className="week-grid">{week.days.map(day => <section className={`week-day ${day.date === now ? 'week-day-today' : ''}`} key={day.date}>
        <button type="button" className="week-day-link" onClick={() => { setDate(day.date); setMode('day') }}>
          <span>{dateLabel(day.date).slice(-2)}</span><strong>{monthDay(day.date)}</strong></button>
        <p className="day-total">{day.capacity === null ? '可用未设置' : `可用 ${minutesLabel(day.capacity)}`}</p>
        <p className="day-total">{day.scheduledMinutes ? `已排 ${minutesLabel(day.scheduledMinutes)}` : '未安排'}</p>
        {day.actualMinutes > 0 && <p className="day-total actual-text">实际 {minutesLabel(day.actualMinutes)}</p>}
        {day.capacity !== null && day.scheduledMinutes > day.capacity && <span className="tag tag-warning">超出容量</span>}
        {day.schedules.map(s => <div className="week-item" key={s.id}><strong>{selectedEntry(data, s)?.title ?? s.title}</strong>
          <span>{minutesLabel(s.plannedMinutes)}</span></div>)}
        <button className="button-text day-add" disabled={actions.disabled} aria-label={`在${monthDay(day.date)}安排任务`} onClick={() => actions.schedule(day.date)}>＋ 安排</button>
      </section>)}</div>
    </> : <DayPage data={data} date={date} now={now} actions={actions} />}
  </div>
}
