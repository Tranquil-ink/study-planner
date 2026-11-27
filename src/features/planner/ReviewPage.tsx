import { useState } from 'react'
import { hoursLabel, minutesLabel, monthDay } from '../../domain/calendar'
import { displayQuantity, subjectKey, type Dataset } from '../../domain/model'
import { averageGoalRates, recentWeeks, studyBreakdown, WEEK_STATUS, weekSummary } from '../../domain/planning'
import { taskProgress } from '../../domain/work-logs'
import { DateToolbar, Empty, GoalProgress, Metric, ProgressBar, type PageToolbar } from './controls'

function rate(done: number, total: number) {
  return total ? `${done} / ${total}（${Math.round(done * 100 / total)}%）` : '—'
}

export function ReviewPage({ data, date, now, setDate, toolbar }: {
  data: Dataset; date: string; now: string; setDate: (date: string) => void; toolbar: PageToolbar
}) {
  const [span, setSpan] = useState(4)
  const summary = weekSummary(data, date, now)
  const trend = recentWeeks(data, date, span, now)
  const maxMinutes = Math.max(1, ...trend.map(w => Math.max(w.plannedMinutes, w.actualMinutes)))
  const distribution = studyBreakdown(data, trend[0]?.week ?? summary.week, summary.through)
  const total = distribution.reduce((sum, category) => sum + category.minutes, 0)
  const pie = distribution.map((category, index) => {
    const start = distribution.slice(0, index).reduce((sum, c) => sum + c.minutes, 0)
    return `${category.color} ${start * 100 / total}% ${(start + category.minutes) * 100 / total}%`
  })
  const averages = averageGoalRates(trend)
  return <>
    {toolbar(<DateToolbar date={summary.week} end={summary.end} now={now} step={7} onChange={setDate} />)}
    <div className="stack review-page">
      <section className="panel stack" aria-label="周复盘">
        <h2>这一周的计划与实际</h2>
        <div className="metrics metrics-three">
          <Metric label="周初计划" minutes={summary.initialPlannedMinutes} />
          <Metric label="当前计划" minutes={summary.plannedMinutes} />
          <Metric label="实际投入" minutes={summary.actualMinutes} tone="accent" />
        </div>
        <div className="rates">
          <div><span>周初目标达成</span><strong>{rate(summary.initialReached, summary.initialCount)}</strong></div>
          <div><span>当前目标达成</span><strong>{rate(summary.currentReached, summary.currentCount)}</strong></div>
          <div><span>计划外投入</span><strong>{minutesLabel(summary.unplannedActualMinutes)}</strong></div>
        </div>
        {summary.committedAt && summary.added > 0 && <p className="muted">{summary.added} 项现行目标是周中新增。</p>}
        {!summary.items.length && <Empty>这个星期还没有学习目标。</Empty>}
        <div className="report-items">{summary.items.map(row => {
          const { item, entry, original, actualMinutes, actualUnits } = row
          const unit = entry?.kind === 'task' ? entry.unitName : ''
          const describe = (minutes: number, units: string | null) => units
            ? `${displayQuantity(units)} ${unit} · ${hoursLabel(minutes)}` : hoursLabel(minutes)
          return <article className="goal-card" key={subjectKey(item)}>
            <div className="card-title"><h3>{entry?.title}</h3>
              {item.status !== 'active' && <span className="tag">{WEEK_STATUS[item.status]}</span>}</div>
            <dl className="report-fields">
              <div><dt>周初目标</dt><dd>{item.baseline ? <>
                {describe(item.baseline.minutes, item.baseline.targetUnits)}{entry?.kind !== 'recurring' && ` · ${original?.percent ?? 0}%`}
              </> : '未确认'}</dd></div>
              <div><dt>{item.status === 'active' ? '当前目标' : '最后计划'}</dt><dd>{describe(item.minutes, item.targetUnits)}</dd></div>
              <div><dt>实际</dt><dd>{hoursLabel(actualMinutes)}{unit && ` · 新增 ${actualUnits} ${unit}`}</dd></div>
            </dl>
            <GoalProgress row={row} />
          </article>
        })}</div>
      </section>
      <section className="panel stack">
        <div className="section-heading"><h2>投入趋势</h2><div className="segmented" aria-label="统计范围">{[4, 12].map(n =>
          <button key={n} aria-pressed={span === n} onClick={() => setSpan(n)}>近 {n} 周</button>
        )}</div></div>
        <div className="chart-legend"><span><i className="chart-swatch" />计划时长</span>
          {distribution.map(category => <span key={category.id}><i className="chart-swatch" style={{ background: category.color }} />{category.name}</span>)}
        </div>
        <ol className="trend" aria-label="各周计划和分类实际投入">{trend.map(w => {
          const breakdown = new Map(studyBreakdown(data, w.week, w.through).map(category => [category.id, category.minutes]))
          const details = distribution.flatMap(category => {
            const minutes = breakdown.get(category.id)
            return minutes ? [`${category.name} ${minutesLabel(minutes)}`] : []
          })
          return <li key={w.week}>
            <span className="trend-label">{monthDay(w.week)}</span>
            <div className="trend-bars">
              <div className="bar-line"><div className="bar-track" aria-hidden="true"><div className="bar-planned"
                style={{ width: `${w.plannedMinutes * 100 / maxMinutes}%` }} /></div><span>计划 {hoursLabel(w.plannedMinutes)}</span></div>
              <div className="bar-line"><div className="bar-track bar-stack" role="img" aria-label={details.join('，') || '无实际投入'}>
                {distribution.map(category => {
                  const minutes = breakdown.get(category.id)
                  return minutes ? <div key={category.id} title={`${category.name} ${minutesLabel(minutes)}`}
                    style={{ background: category.color, width: `${minutes * 100 / maxMinutes}%` }} /> : null
                })}
              </div><span>实际 {hoursLabel(w.actualMinutes)}</span></div>
            </div>
          </li>
        })}</ol>
      </section>
      <div className="day-columns review-columns">
        <section className="panel stack" aria-label="学习分布">
          <h2>近 {span} 周学习分布</h2>
          {distribution.length === 0 ? <Empty>这个范围内还没有可汇总的实际记录。</Empty> :
            <div className="study-pie-layout">
              <div className="study-pie" role="img" aria-label={`按分类分布，共 ${minutesLabel(total)}`}
                style={{ background: `conic-gradient(${pie.join(', ')})` }} />
              <ul className="study-pie-legend">
                {distribution.map(category => <li key={category.id}>
                  <strong><i className="chart-swatch" style={{ background: category.color }} />{category.name}</strong>
                  <span>{hoursLabel(category.minutes)} · {Math.round(category.minutes * 100 / total)}%</span>
                </li>)}
              </ul>
            </div>}
        </section>
        <section className="panel stack" aria-label="长期任务平均完成率">
          <h2>长期任务平均完成率</h2>
          <p className="muted">近 {span} 周内，按设有进度目标的周取平均。</p>
          {!averages.length && <Empty>这个范围内没有长期任务的周进度目标。</Empty>}
          {averages.map(({ task, count, ratio }) => <ProgressBar key={task.id} label={task.title} ratio={ratio}
            detail={`${Math.round(ratio * 100)}% · ${count} 周`} />)}
        </section>
      </div>
      {data.tasks.length > 0 && <section className="panel stack">
        <h2>长期任务累计进度</h2>
        {data.tasks.map(task => {
          const progress = taskProgress(task, data.workLogs, summary.through)
          return <div className="list-row" key={task.id}><strong>{task.title}</strong>
            <span>{progress.completedUnits}{task.totalUnits !== null && ` / ${displayQuantity(task.totalUnits)}`} {task.unitName}</span>
          </div>
        })}
      </section>}
    </div>
  </>
}
