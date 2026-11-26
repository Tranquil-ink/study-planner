import { useEffect, useRef, useState, type DragEvent } from 'react'
import { dateLabel, hoursLabel, minutesLabel, monthDay, sumMinutes, WEEKDAYS, weekdayIndex } from '../../domain/calendar'
import { displayQuantity, PERIODS, subjectKey, type Dataset, type ScheduleBlock, type SchedulePeriod, type WorkLog } from '../../domain/model'
import { daySummary, entrySubject, PERIOD_LABEL, selectedEntry, weekCandidates, weekSummary } from '../../domain/planning'
import { AddButton, DateToolbar, Empty, EntryTag, GoalProgress, ProgressBar } from './controls'
import { editSchedule, type PlannerActions } from './actions'

const SCHEDULE_DRAG_TYPE = 'application/x-study-planner-schedule'

interface DropLocation { date: string; period: SchedulePeriod; beforeId: string | null }
interface BoardDrag {
  id: string | null
  target: DropLocation | null
  start: (e: DragEvent, id: string) => void
  over: (e: DragEvent, to: DropLocation) => void
  drop: (e: DragEvent, to: DropLocation) => void
  end: () => void
}

function useBoardDrag(actions: PlannerActions): BoardDrag {
  const [id, setId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropLocation | null>(null)
  const end = () => { setId(null); setTarget(null) }
  return {
    id, target, end,
    start(e, rowId) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(SCHEDULE_DRAG_TYPE, rowId)
      setId(rowId)
    },
    over(e, to) {
      if (!id || actions.disabled) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setTarget(old => old?.date === to.date && old.period === to.period && old.beforeId === to.beforeId ? old : to)
    },
    drop(e, to) {
      if (!id || actions.disabled) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer.getData(SCHEDULE_DRAG_TYPE) === id && to.beforeId !== id) {
        actions.run({ type: 'moveSchedule', value: { id, ...to } })
      }
      end()
    },
  }
}

function ScheduleCard({ data, row, now, actions, drag, following }: {
  data: Dataset; row: ScheduleBlock; now: string; actions: PlannerActions; drag?: BoardDrag; following?: string | null
}) {
  const entry = selectedEntry(data, row)
  const title = entry?.title ?? row.title
  const logs = data.workLogs.filter(log => log.scheduleBlockId === row.id && log.date <= now)
  const actual = sumMinutes(logs, log => log.actualMinutes)
  const { id, date, period, outcome } = row
  const pending = outcome === 'pending'
  const target = { date, period, beforeId: id }
  const edit = () => actions.edit({ type: 'saveSchedule', value: editSchedule(row) }, { existing: true, title: '编辑安排' })
  return <article className={`schedule-card schedule-${outcome} ${drag?.id === id ? 'dragging' : ''} ${drag?.target?.beforeId === id ? 'drop-before' : ''}`}
    draggable={Boolean(drag) && !actions.disabled} onDragStart={e => drag?.start(e, id)} onDragEnd={drag?.end}
    onDragOver={e => drag?.over(e, target)} onDrop={e => drag?.drop(e, target)}>
    <div className="schedule-top">
      <h3><button className="schedule-title-button" disabled={actions.disabled} onClick={edit}>{title}</button></h3>
      <span className="schedule-duration" title={logs.length ? '实际时长 / 计划时长' : '计划时长'}>
        {logs.length ? `${hoursLabel(actual)} / ` : ''}{hoursLabel(row.plannedMinutes)}
      </span>
    </div>
    <EntryTag entry={entry} data={data} now={now} />
    {(row.plannedUnits || row.plannedRangeText) && <p className="schedule-target">
      {row.plannedUnits && entry?.kind === 'task' ? `+${displayQuantity(row.plannedUnits)} ${entry.unitName}` : ''}
      {row.plannedUnits && row.plannedRangeText && ' · '}{row.plannedRangeText}
    </p>}
    {row.note && <p className="item-note schedule-note">{row.note}</p>}
    <div className="schedule-card-actions">
      <div className="schedule-outcome">
        {pending && <>
          <button className="schedule-mark" type="button" title="标记完成" aria-label="标记完成" disabled={actions.disabled}
            onClick={() => actions.complete(row)}>✓</button>
          {logs.length === 0 && <button className="schedule-mark schedule-mark-skip" type="button" title="标记未做" aria-label="标记未做" disabled={actions.disabled}
            onClick={() => actions.run({ type: 'setScheduleOutcome', value: { id, outcome: 'skipped' } })}>×</button>}
        </>}
        {outcome === 'completed' && <span className="schedule-result">
          <span className="filled-mark" aria-hidden="true">✓</span><span>已完成</span>
        </span>}
        {outcome === 'skipped' && <button type="button" className="schedule-result undo-skip" aria-label="撤销未做" title="撤销未做"
          disabled={actions.disabled} onClick={() => actions.run({ type: 'setScheduleOutcome', value: { id, outcome: 'pending' } })}>
          <span className="filled-mark" aria-hidden="true">×</span>未做
        </button>}
      </div>
      <button className="button-text schedule-move" type="button" disabled={actions.disabled} onClick={() => actions.edit({
        type: 'moveSchedule', value: { id, date, period, beforeId: following ?? null },
      })}>移动</button>
    </div>
  </article>
}

type DayData = ReturnType<typeof daySummary>

function DayColumn({ day, data, now, actions, drag, openDay }: {
  day: DayData; data: Dataset; now: string; actions: PlannerActions; drag: BoardDrag; openDay?: () => void
}) {
  const { date, capacity, scheduledMinutes, completedCount, schedules } = day
  const ratio = capacity === null ? null : capacity > 0 ? scheduledMinutes / capacity : Number(scheduledMinutes > 0)
  const over = capacity !== null && scheduledMinutes > capacity
  const scheduledDetail = capacity === null ? `${hoursLabel(scheduledMinutes)} · 容量未设`
    : capacity === 0 && over ? '超额 · 无可用时间' : `${Math.round((ratio ?? 0) * 100)}%`
  const completedRatio = schedules.length ? completedCount / schedules.length : 0
  const heading = WEEKDAYS[weekdayIndex(date)]
  return <section className={`board-day ${date === now ? 'board-today' : ''}`} aria-label={dateLabel(date)} data-board-date={date}>
    <header className="board-day-header">
      <div className="board-day-name">
        <h2>{openDay ? <button type="button" className="board-day-link" onClick={openDay}>{heading}</button> : heading}</h2>
        {date === now && <span className="board-today-tag">今天</span>}
      </div>
      <p>{monthDay(date)}</p>
      <div className="board-day-meters">
        <ProgressBar label="已安排时间" detail={scheduledDetail} ratio={ratio} tone={over ? 'warning' : 'warm'} />
        <ProgressBar label="已完成" detail={`${Math.round(completedRatio * 100)}% · ${completedCount}/${schedules.length}`}
          ratio={completedRatio} />
      </div>
    </header>
    {PERIODS.map((period, index) => {
      const rows = schedules.filter(s => s.period === period)
      const limit = day.periodCapacity?.[index]
      const planned = sumMinutes(rows, row => row.plannedMinutes)
      const tail = { date, period, beforeId: null }
      const isTarget = drag.target?.date === date && drag.target.period === period && drag.target.beforeId === null
      return <section key={period} className={`board-period ${isTarget ? 'drop-period' : ''}`} aria-label={PERIOD_LABEL[period]}
        onDragOver={event => drag.over(event, tail)} onDrop={event => drag.drop(event, tail)}>
        <div className="period-heading">
          <h3>{PERIOD_LABEL[period]}</h3>
          <span className={limit !== undefined && planned > limit ? 'warning-text' : ''}>
            {hoursLabel(planned)}{limit !== undefined && ` / ${hoursLabel(limit)}`}
          </span>
        </div>
        <div className="period-cards">
          {rows.map((row, i) => <ScheduleCard key={row.id} data={data} row={row} now={now} actions={actions} drag={drag} following={rows[i + 1]?.id} />)}
        </div>
        <AddButton disabled={actions.disabled} onClick={() => actions.schedule(date, period)}
          label={`${monthDay(date)} ${PERIOD_LABEL[period]}新增安排`}>新增安排</AddButton>
      </section>
    })}
  </section>
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

function WeeklyGoals({ week, data, now }: { week: ReturnType<typeof weekSummary>; data: Dataset; now: string }) {
  const goals = week.items.filter(row => row.item.status === 'active')
  const candidates = weekCandidates(data, week.week, now)
  return <section className="board-goals" aria-label="日程中的本周目标">
    <div className="board-goals-header"><h2>本周目标</h2><a href="#planning">{goals.length ? '查看本周目标' : '设定本周目标'}</a></div>
    {(goals.length > 0 || candidates.length > 0) && <div className="board-goals-items">
      {goals.map(row => <article key={row.item.id} className="board-goal">
        <div className="board-goal-heading">
          <h3>{row.entry?.title}</h3>
          <span className={row.budget < 0 ? 'warning-text' : ''}>
            {row.budget < 0 ? '超出预算' : '预算剩余'} <strong>{hoursLabel(Math.abs(row.budget))}</strong>
          </span>
        </div>
        <GoalProgress row={row} through={week.through} />
      </article>)}
      {candidates.map(entry => <article key={subjectKey(entrySubject(entry))} className="board-goal">
        <div className="board-goal-heading"><h3>{entry.title}</h3><span>待设目标</span></div>
      </article>)}
    </div>}
  </section>
}

export function DayPage({ data, date, now, actions }: {
  data: Dataset; date: string; now: string; actions: PlannerActions
}) {
  const day = daySummary(data, date, now), drag = useBoardDrag(actions)
  const overdue = date === now ? data.schedules.filter(s => s.date < now && s.outcome === 'pending') : []
  return <div className="stack">
    <div className="day-columns">
      <DayColumn day={day} data={data} now={now} actions={actions} drag={drag} />
      <section className="panel stack">
        <div className="section-heading">
          <h2>实际记录</h2>
          {date <= now && <button className="button-text" disabled={actions.disabled} onClick={() => actions.record(date)}>补记实际</button>}
        </div>
        {!day.logs.length && <Empty>{date > now ? '这一天还没有实际投入。' : '这一天还没有实际学习记录。'}</Empty>}
        {day.logs.map(log => <LogCard key={log.id} log={log} data={data} actions={actions} />)}
      </section>
    </div>
    {overdue.length > 0 && <section className="panel">
      <details className="history-details"><summary>过去的安排待处理（{overdue.length}）</summary>
        <div className="pool-cards">{[...overdue].reverse().map(row => <div key={row.id}>
          <p className="muted">{dateLabel(row.date)} · {PERIOD_LABEL[row.period]}</p>
          <ScheduleCard data={data} row={row} now={now} actions={actions} />
        </div>)}</div>
      </details>
    </section>}
  </div>
}

function WeekBoard({ days, date, data, now, actions, openDay }: {
  days: DayData[]; date: string; data: Dataset; now: string; actions: PlannerActions; openDay: (day: string) => void
}) {
  const board = useRef<HTMLDivElement>(null)
  const drag = useBoardDrag(actions)
  useEffect(() => {
    const viewport = board.current
    const selected = viewport?.querySelector<HTMLElement>(`[data-board-date="${date}"]`)
    if (!viewport || !selected) return
    viewport.scrollLeft += selected.getBoundingClientRect().left - viewport.getBoundingClientRect().left
  }, [date])
  return <div ref={board} className="week-board" role="region" aria-label="按天排列的周日程" tabIndex={0}>
    {days.map(day => <DayColumn key={day.date} day={day} data={data} now={now} actions={actions} drag={drag}
      openDay={() => openDay(day.date)} />)}
  </div>
}

export function CalendarPage({ data, date, now, setDate, initialMode, actions }: {
  data: Dataset; date: string; now: string; setDate: (date: string) => void; initialMode: 'week' | 'day'; actions: PlannerActions
}) {
  const [mode, setMode] = useState(initialMode)
  const week = weekSummary(data, date, now)
  const inWeek = mode === 'week'
  return <div className="stack calendar-page">
    <div className="calendar-tools">
      <DateToolbar date={inWeek ? week.week : date} end={inWeek ? week.end : undefined} now={now} step={inWeek ? 7 : 1} onChange={setDate} />
      <div className="segmented" aria-label="日程视图">
        <button aria-pressed={inWeek} onClick={() => setMode('week')}>周视图</button>
        <button aria-pressed={!inWeek} onClick={() => setMode('day')}>日视图</button>
      </div>
    </div>
    <WeeklyGoals week={week} data={data} now={now} />
    {inWeek ? <WeekBoard days={week.days} date={date} data={data} now={now} actions={actions}
      openDay={day => { setDate(day); setMode('day') }} />
      : <DayPage data={data} date={date} now={now} actions={actions} />}
  </div>
}
