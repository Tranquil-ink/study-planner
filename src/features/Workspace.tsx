import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FeaturePlaceholder } from '../components/FeaturePlaceholder'
import { dataError, DataError, messageOf } from '../data/errors'
import type { Repository } from '../data/repository'
import type { Backup } from '../data/backup'
import { SnapshotGuard } from '../data/session-store'
import { validateCommand, type Command, type Operation, type Snapshot } from '../domain/model'
import type { Page } from '../navigation'
import { TaskList } from './tasks/TaskList'
import { TaskEditor, type Editor } from './tasks/TaskEditor'
import { Calendar, type ScheduleEditor } from './calendar/Calendar'
import { BackupPanel } from './settings/BackupPanel'
export function Workspace({ repository, page, authorized, expire, logout, login, email }: {
  repository: Repository; page: Page; authorized: boolean; expire: () => void; logout: () => Promise<void>; login: ReactNode; email: string
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditor | null>(null)
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
      setSnapshot(next); setFetchedAt(new Date().toISOString()); setError('')
      return next
    } catch (e) { if (ticket === guard.current.ticket()) handleError(e); return null }
    finally { if (ticket === guard.current.ticket()) setLoading(false) }
  }, [repository, handleError])
  useEffect(() => {
    const activeGuard = guard.current
    const timer = authorized ? setTimeout(() => { void refresh() }, 0) : undefined
    return () => { clearTimeout(timer); activeGuard.invalidate() }
  }, [authorized, refresh])
  useEffect(() => {
    if (!editor && !scheduleEditor && !pending) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editor, scheduleEditor, pending])
  async function submit(operation: Operation, retry = false) {
    if (submitLock.current || !authorized) return
    submitLock.current = true; setBusy(true); setPending(operation); setStatus('保存中…'); setError('')
    const ticket = guard.current.ticket()
    try {
      const confirmed = retry ? await repository.confirm(operation.requestId) : null
      const receipt = confirmed ?? await repository.submit(operation)
      if (ticket !== guard.current.ticket() || !authorizedRef.current) {
        setStatus('保存结果待确认，请重新登录后确认原请求。'); return
      }
      setPending(null);
      if (operation.command.type === 'saveSchedule' || operation.command.type === 'removeSchedule') setScheduleEditor(null)
      else if (operation.command.type === 'saveCategory' || operation.command.type === 'saveTask') setEditor(null)
      setRequiredRevision(receipt.revision)
      setStatus('已保存到云端。'); await refresh()
    } catch (e) {
      const failure = dataError(e, !retry)
      // Confirmation read failures also retain the exact original operation.
      const unresolved = failure.kind === 'unknown' || failure.kind === 'auth' || (retry && failure.kind !== 'validation' && failure.kind !== 'conflict')
      if (!unresolved) setPending(null)
      setStatus(unresolved ? '保存结果待确认；原请求与输入仍保留。' : '保存失败，尚未提交此修改。')
      handleError(failure)
    } finally { submitLock.current = false; setBusy(false) }
  }
  function start(command: Command, base: number) {
    if (pending || busy) return
    try { const value = validateCommand(command); void submit({ requestId: crypto.randomUUID(), expectedRevision: base, command: value }) }
    catch { setError('输入校验失败，请检查必填项、日期与基础时段、任务关联和进度范围。') }
  }
  async function userRefresh() {
    if ((editor || scheduleEditor) && !window.confirm('将保留当前输入，并获取最新云端数据。旧表单不会自动采用新版本；请核对后明确重新应用。继续获取？')) return null
    return refresh()
  }
  if (!authorized) return <>{login}<p className="notice">会话失效时已停止业务请求。当前页输入保留在内存；同账号登录后可继续核对。离开或刷新会丢失未提交输入。</p></>
  const disabled = busy || !!pending || loading || !snapshot || snapshot.revision < requiredRevision
  return <>
    <section className="cloud-bar" aria-label="云端状态">
      <p>当前账号：{email}</p>
      <div className="actions"><button disabled={loading || busy} onClick={() => { void userRefresh() }}>{loading ? '正在获取…' : '获取最新数据'}</button>
        <button disabled={busy} onClick={() => {
          if ((editor || scheduleEditor || pending) && !window.confirm('退出将清除当前页输入和请求信息。若保存结果待确认，请先确认原请求。仍要退出？')) return
          void logout().catch(handleError)
        }}>退出登录</button></div>
      <p>最近成功获取：{fetchedAt ? new Date(fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未成功获取'}</p>
      <p role="status">{status}{loading && ' 正在读取云端…'}</p>
      {error && <p role="alert">{error}{snapshot && ' 当前列表可能过期。'}</p>}
      {pending && !busy && <div className="notice"><p>请求编号：{pending.requestId}。确认前输入已锁定。</p><button onClick={() => { void submit(pending, true) }}>确认并重试原请求</button></div>}
      {snapshot && snapshot.revision < requiredRevision && <p role="alert">保存已确认，但尚未取得保存后的完整数据，请获取最新数据。</p>}
    </section>
    <header className="page-header"><p className="eyebrow">我的学习空间</p><h1>{page.label}</h1><p>{page.description}</p></header>
    {!snapshot ? <p>尚未获得云端数据；请获取最新数据。读取失败不代表没有任务。</p> : <>
      <div hidden={page.id !== 'tasks'}>
        {editor && <TaskEditor editor={editor} snapshot={snapshot} disabled={disabled} onChange={setEditor} onSave={() => start(editor.kind === 'category' ? { type: 'saveCategory', value: editor.value } : { type: 'saveTask', value: editor.value }, editor.base)} onCancel={() => { if (window.confirm('放弃此表单的未保存输入？')) setEditor(null) }} onRebase={() => {
          if (window.confirm('已对照最新列表核对全部字段？继续后将以当前输入更新最新版本。')) setEditor({ ...editor, base: snapshot.revision })
        }} />}
        <TaskList snapshot={snapshot} disabled={disabled || !!editor || !!scheduleEditor} edit={setEditor} />
      </div>
      <div hidden={page.id !== 'settings'}><BackupPanel repository={repository} snapshot={snapshot} disabled={disabled || !!editor || !!scheduleEditor} refresh={refresh} restore={(backup: Backup, base) => start({ type: 'restore', value: backup.data }, base)} onError={handleError} /></div>
      <div hidden={page.id !== 'calendar'}><Calendar snapshot={snapshot} editor={scheduleEditor} disabled={disabled || !!editor} edit={setScheduleEditor} save={() => {
        if (scheduleEditor) start({ type: 'saveSchedule', value: scheduleEditor.value }, scheduleEditor.base)
      }} remove={() => {
        if (scheduleEditor && window.confirm('确认移除此日程？此操作不会删除关联的长期任务。')) start({ type: 'removeSchedule', value: { id: scheduleEditor.value.id } }, scheduleEditor.base)
      }} cancel={() => { if (window.confirm('放弃日程表单的未保存输入？')) setScheduleEditor(null) }} /></div>
      {scheduleEditor && page.id !== 'calendar' && <p className="notice">日历中有未保存表单，切回日历可继续编辑。</p>}
      {page.id !== 'calendar' && page.id !== 'tasks' && page.id !== 'settings' && <FeaturePlaceholder page={page} />}
      {editor && page.id !== 'tasks' && <p className="notice">任务池中有未保存表单，切回任务池可继续编辑。</p>}
    </>}
  </>
}
