import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { dataError, DataError, messageOf } from '../data/errors'
import type { Repository } from '../data/repository'
import { SnapshotGuard } from '../data/session-store'
import { today } from '../domain/calendar'
import { subjectKey, validateCommand, type Command, type Operation, type Snapshot } from '../domain/model'
import { entrySubject } from '../domain/planning'
import type { Page } from '../navigation'
import { editWeekItem, type PlannerActions } from './planner/actions'
import { CalendarPage, DayPage } from './planner/DaysPage'
import { PlannerEditor, type Editor } from './planner/PlannerEditor'
import { PoolPage } from './planner/PoolPage'
import { ReviewPage } from './planner/ReviewPage'
import { WeekPage } from './planner/WeekPage'
import { BackupPanel } from './settings/BackupPanel'

function useBusinessToday() {
  const [now, setNow] = useState(today)
  useEffect(() => {
    const update = () => setNow(today())
    const timer = setInterval(update, 60000)
    window.addEventListener('focus', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  return now
}

export function Workspace({ repository, page, authorized, expire, logout, login, email }: {
  repository: Repository; page: Page; authorized: boolean; expire: () => void; logout: () => Promise<void>; login: ReactNode; email: string
}) {
  const now = useBusinessToday()
  const [date, setDate] = useState(now)
  const [calendarStart] = useState<'week' | 'day'>(() => window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pending, setPending] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState('')
  const [requiredRevision, setRequiredRevision] = useState(0)
  const guard = useRef(new SnapshotGuard())
  const submitLock = useRef(false)
  const authorizedRef = useRef(authorized)
  useEffect(() => { authorizedRef.current = authorized }, [authorized])

  const handleError = useCallback((e: unknown) => {
    setError(messageOf(e))
    if (e instanceof DataError && e.kind === 'auth') expire()
  }, [expire])
  const refresh = useCallback(async (): Promise<Snapshot | null> => {
    if (!authorizedRef.current) return null
    const ticket = guard.current.ticket()
    setLoading(true)
    try {
      const next = await repository.snapshot()
      if (!authorizedRef.current || !guard.current.accept(ticket, next)) return null
      setSnapshot(next)
      setFetchedAt(new Date().toISOString())
      setError('')
      return next
    } catch (e) {
      if (ticket === guard.current.ticket()) handleError(e)
      return null
    } finally {
      if (ticket === guard.current.ticket()) setLoading(false)
    }
  }, [repository, handleError])
  useEffect(() => {
    const activeGuard = guard.current
    const timer = authorized ? setTimeout(() => { void refresh() }, 0) : undefined
    return () => { clearTimeout(timer); activeGuard.invalidate() }
  }, [authorized, refresh])
  useEffect(() => {
    if (!editor && !pending) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editor, pending])

  async function submit(operation: Operation, retry = false) {
    if (submitLock.current || !authorized) return
    submitLock.current = true
    setBusy(true); setPending(operation); setStatus('保存中…'); setError('')
    const ticket = guard.current.ticket()
    try {
      const confirmed = retry ? await repository.confirm(operation.requestId) : null
      const receipt = confirmed ?? await repository.submit(operation)
      if (ticket !== guard.current.ticket() || !authorizedRef.current) {
        setStatus('保存结果待确认。重新登录后可以确认原请求。')
        return
      }
      setPending(null); setEditor(null); setRequiredRevision(receipt.revision)
      setStatus('已保存到云端。')
      await refresh()
    } catch (e) {
      const failure = dataError(e, !retry)
      const unresolved = failure.kind === 'unknown' || failure.kind === 'auth' || (retry && failure.kind !== 'validation' && failure.kind !== 'conflict')
      if (!unresolved) setPending(null)
      setStatus(unresolved ? '保存结果待确认。原请求与输入仍保留。' : '保存失败。')
      handleError(failure)
      if (failure.kind === 'conflict') {
        await refresh()
        handleError(failure)
      }
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  const disabled = busy || !!pending || loading || !snapshot || snapshot.revision < requiredRevision
  function start(command: Command, base: number) {
    if (disabled) return
    try {
      const value = validateCommand(command)
      void submit({ requestId: crypto.randomUUID(), expectedRevision: base, command: value })
    } catch (error) {
      const issue = (error as { issues?: { message: string }[] }).issues?.[0]
      setError(issue ? `请检查输入。 ${issue.message}` : '输入未通过校验。')
    }
  }

  if (!authorized) return <>{login}<p className="notice">登录失效。用同一账号重新登录后可以核对未保存的输入。</p></>
  const edit: PlannerActions['edit'] = (command, options) => {
    if (disabled || !snapshot || editor) return
    setStatus(''); setError('')
    setEditor({ ...options, base: snapshot.revision, command })
  }
  const actions: PlannerActions = {
    disabled: disabled || !!editor,
    edit,
    run(command, confirmation) {
      if (snapshot && !disabled && !editor && (!confirmation || window.confirm(confirmation))) start(command, snapshot.revision)
    },
    plan(week, entry) {
      if (!snapshot || disabled || editor) return
      const subject = entry ? entrySubject(entry) : { taskId: null, todoId: null }
      const existing = entry && snapshot.weekItems.find(i => i.weekStart === week && subjectKey(i) === subjectKey(subject))
      if (existing) {
        edit(editWeekItem(existing), { existing: true, title: existing.status === 'active' ? '编辑目标' : '设定目标' })
        return
      }
      edit({ type: 'saveWeekItem', value: { id: crypto.randomUUID(), weekStart: week, ...subject,
        minutes: entry?.kind === 'todo' ? entry.estimatedMinutes ?? 0 : 0, targetUnits: null } },
      { title: '设定目标', lockedSubject: !!entry })
    },
    schedule(date, period) {
      edit({ type: 'saveSchedule', value: { id: crypto.randomUUID(), date, period, taskId: null, todoId: null,
        title: '', plannedMinutes: 0, plannedUnits: null, plannedRangeText: '', note: '' } }, { title: '新增安排' })
    },
    complete(schedule) {
      if (!snapshot) return
      const previous = snapshot.workLogs.filter(l => l.scheduleBlockId === schedule.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdOrder - a.createdOrder)[0]
      edit({ type: 'completeSchedule', value: { id: schedule.id, logId: previous?.id ?? crypto.randomUUID(),
        date: previous && previous.date <= now ? previous.date : schedule.date > now ? now : schedule.date,
        actualMinutes: previous?.actualMinutes ?? schedule.plannedMinutes, reachedUnits: null,
        progressLabel: previous?.progressLabel ?? '', note: previous?.note ?? '' } }, { title: '记录完成情况' })
    },
    record(date) {
      edit({ type: 'saveWorkLog', value: {
        id: crypto.randomUUID(), date, taskId: null, todoId: null, scheduleBlockId: null, titleSnapshot: '',
        actualMinutes: 0, progressDelta: null, progressLabel: '', note: '',
      } }, { title: '补记实际' })
    },
  }
  const retry = pending && !busy && <button type="button" onClick={() => { void submit(pending, true) }}>确认并重试原请求</button>
  const cancelEditor = () => {
    if (!busy && !pending && (!editor?.dirty || window.confirm('放弃这个表单的输入？'))) { setEditor(null); setError(''); setStatus('') }
  }
  const removeEditor = editor?.existing && (editor.command.type === 'saveSchedule' || editor.command.type === 'saveWorkLog')
    ? () => {
      const schedule = editor.command.type === 'saveSchedule'
      if ((editor.command.type === 'saveSchedule' || editor.command.type === 'saveWorkLog')
        && window.confirm(schedule ? '删除这个安排？关联的实际记录会保留。' : '删除这条实际记录？投入和进度会重新汇总。')) {
        start({ type: schedule ? 'removeSchedule' : 'removeWorkLog', value: { id: editor.command.value.id } }, editor.base)
      }
    } : undefined
  return <>
    <header className="page-header">
      <div><h1>{page.label}</h1><p>{page.description}</p></div>
      <details className="account-menu">
        <summary>账号</summary>
        <div className="account-panel"><strong>{email}</strong>
          <p className="muted">最近获取 {fetchedAt ? new Date(fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未成功'}</p>
          <button disabled={busy || loading} onClick={() => { void refresh() }}>获取最新数据</button>
          <button disabled={busy} className="button-text" onClick={() => {
            if (pending && !window.confirm('退出会清除当前请求信息。仍要退出？')) return
            void logout().catch(handleError)
          }}>退出登录</button>
        </div>
      </details>
    </header>
    <div className="workspace-status" aria-label="云端状态">
      <span role="status">{loading ? '正在读取云端…' : status}</span>
      {!editor && error && <p className="notice notice-warning" role="alert">{error}</p>}
      {snapshot && snapshot.revision < requiredRevision && <p className="notice" role="alert">保存已确认，请获取最新数据后继续。</p>}
      {!editor && retry}
    </div>
    {snapshot ? <>
      {page.id === 'today' && <DayPage data={snapshot} date={now} now={now} actions={actions} />}
      {page.id === 'tasks' && <PoolPage data={snapshot} now={now} actions={actions} />}
      {page.id === 'planning' && <WeekPage data={snapshot} date={date} now={now} setDate={setDate} actions={actions} />}
      {page.id === 'calendar' && <CalendarPage data={snapshot} date={date} now={now} setDate={setDate} actions={actions} initialMode={calendarStart} />}
      {page.id === 'review' && <ReviewPage data={snapshot} date={date} now={now} setDate={setDate} />}
      {page.id === 'settings' && <BackupPanel repository={repository} snapshot={snapshot} disabled={actions.disabled} refresh={refresh}
        restore={(backup, base) => start({ type: 'restore', value: backup.data }, base)} onError={handleError} />}
      {editor && <PlannerEditor editor={editor} data={snapshot} now={now} disabled={disabled} error={error} status={status} retry={retry}
        onChange={setEditor} onSubmit={() => start(editor.command, editor.base)} onCancel={cancelEditor}
        onRebase={() => { setEditor({ ...editor, base: snapshot.revision }); setError(''); setStatus('') }} onRemove={removeEditor} />}
    </> : !loading && <section className="panel stack"><p>尚未获取云端数据。</p><button onClick={() => { void refresh() }}>重新获取</button></section>}
  </>
}
