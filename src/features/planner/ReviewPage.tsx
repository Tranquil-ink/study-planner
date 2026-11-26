import { useState } from 'react'
import { minutesLabel, monthDay } from '../../domain/calendar'
import { displayQuantity, type Dataset } from '../../domain/model'
import { recentWeeks, studyBreakdown, WEEK_STATUS, weekSummary } from '../../domain/planning'
import { taskProgress } from '../../domain/work-logs'
import { DateToolbar, Empty, Metric } from './controls'

function rate(done: number, total: number) {
  return total ? `${done} / ${total}（${Math.round(done * 100 / total)}%）` : '—'
}

export function ReviewPage({ data, date, now, setDate }: { data: Dataset; date: string; now: string; setDate: (date: string) => void }) {
  const [span, setSpan] = useState(4)
  const summary = weekSummary(data, date, now)
  const trend = recentWeeks(data, date, span, now)
  const maxMinutes = Math.max(1, ...trend.map(w => Math.max(w.plannedMinutes, w.actualMinutes)))
  const through = summary.end <= now ? summary.end : now
  const distribution = studyBreakdown(data, trend[0]?.week ?? summary.week, through)
  const total = distribution.reduce((sum, [, value]) => sum + value, 0)
  return <div className="stack">
    <DateToolbar date={summary.week} end={summary.end} now={now} step={7} onChange={setDate} />
    <section className="panel stack" aria-label="周复盘">
      <div className="section-heading"><div><h2>这一周的计划与实际</h2>
        <p className="muted">{summary.uncommitted ? '这周还没确认周初计划，目前显示草稿与实际。' : '实际按发生日期归周，补记会更新对应的一周。'}</p></div></div>
      <div className="metrics">
        <Metric label="周初计划" minutes={summary.initialPlannedMinutes} />
        <Metric label="当前计划" minutes={summary.plannedMinutes} />
        <Metric label="日历已排" minutes={summary.scheduledMinutes} />
        <Metric label="实际投入" minutes={summary.actualMinutes} tone="accent" />
      </div>
      <div className="rates">
        <div><span>周初目标达成</span><strong>{rate(summary.initialReached, summary.initialCount)}</strong></div>
        <div><span>当前目标达成</span><strong>{rate(summary.currentReached, summary.currentCount)}</strong></div>
        <div><span>当前计划外投入</span><strong>{minutesLabel(summary.unplannedActualMinutes)}</strong></div>
        <div><span>已结转 / 安排待处理</span><strong>{summary.carried} 项 / {summary.missed} 项</strong></div>
      </div>
      {summary.committedAt && summary.added > 0 && <p className="muted">{summary.added} 项现行目标是周中新增。</p>}
      {!summary.items.length && <Empty>这个星期还没有学习目标。</Empty>}
      <div className="report-items">{summary.items.map(r => {
        const unit = r.entry?.kind === 'task' ? r.entry.unitName : ''
        const describe = (minutes: number, units: string | null) => units ? `${displayQuantity(units)} ${unit} · ${minutesLabel(minutes)}` : minutesLabel(minutes)
        return <article className="goal-card" key={r.item.id}>
          <div className="card-title"><h3>{r.entry?.title}</h3><span className="tag">{WEEK_STATUS[r.item.status]}</span></div>
          <dl className="report-fields">
            <div><dt>周初目标</dt><dd>{r.item.baseline ? `${describe(r.item.baseline.minutes, r.item.baseline.targetUnits)} · ${r.original?.percent ?? 0}%` : '未纳入周初计划'}</dd></div>
            <div><dt>{r.item.status === 'active' ? '当前目标' : '最后计划'}</dt><dd>{describe(r.item.minutes, r.item.targetUnits)}{r.item.status === 'active' && ` · ${r.current.percent ?? 0}%`}</dd></div>
            <div><dt>实际</dt><dd>{minutesLabel(r.actualMinutes)}{unit && ` · 新增 ${r.actualUnits} ${unit}`}</dd></div>
          </dl>
        </article>
      })}</div>
    </section>
    <div className="day-columns">
      <section className="panel stack">
        <div className="section-heading"><h2>每周投入趋势</h2><div className="segmented" aria-label="统计范围">{[4, 12].map(n =>
          <button key={n} aria-pressed={span === n} onClick={() => setSpan(n)}>近 {n} 周</button>
        )}</div></div>
        <div className="chart-legend"><span>当前计划</span><span>实际投入</span></div>
        <ol className="trend" aria-label="各周计划与实际时间">{trend.map(w => <li key={w.week}>
          <span className="trend-label">{monthDay(w.week)}</span>
          <div className="trend-bars">
            <div className="bar-line"><div className="bar-track"><div style={{ width: `${w.plannedMinutes * 100 / maxMinutes}%` }} /></div><span>{w.currentCount ? minutesLabel(w.plannedMinutes) : '—'}</span></div>
            <div className="bar-line bar-actual"><div className="bar-track"><div style={{ width: `${w.actualMinutes * 100 / maxMinutes}%` }} /></div><span>{minutesLabel(w.actualMinutes)}</span></div>
          </div>
        </li>)}</ol>
      </section>
      <section className="panel stack">
        <h2>近 {span} 周学习分布</h2>
        {distribution.length === 0 && <Empty>这个范围内还没有可汇总的实际记录。</Empty>}
        {distribution.map(([label, value]) => <div className="breakdown" key={label}>
          <div className="list-row"><strong>{label}</strong><span>{minutesLabel(value)}</span></div>
          <progress value={value} max={total} aria-label={`${label}占总投入的比例`} />
        </div>)}
        <h2>长期任务进度</h2>
        {!data.tasks.length && <p className="muted">还没有长期任务。</p>}
        {data.tasks.map(t => {
          const progress = taskProgress(t, data.workLogs, through)
          return <div className="list-row" key={t.id}><strong>{t.title}</strong><span>{progress.completedUnits}{t.totalUnits && ` / ${displayQuantity(t.totalUnits)}`} {t.unitName}</span></div>
        })}
      </section>
    </div>
  </div>
}
