import { useEffect, useRef, useState } from 'react'
import { parseBackup, type Backup } from '../../data/backup'
import { messageOf } from '../../data/errors'
import type { Snapshot } from '../../domain/model'
import type { Repository } from '../../data/repository'
interface Preview { backup: Backup; base: number }
export function BackupPanel({ repository, snapshot, disabled, refresh, restore, onError }: {
  repository: Repository; snapshot: Snapshot; disabled: boolean;
  refresh: () => Promise<Snapshot | null>; restore: (backup: Backup, base: number) => void; onError: (error: unknown) => void
}) {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastExport, setLastExport] = useState('')
  async function exportFile() {
    setBusy(true); setError('')
    try {
      const backup = await repository.exportBackup()
      if (!alive.current) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `study-planner-${backup.exportedAt.slice(0,10)}.json`
      document.body.append(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setLastExport(backup.exportedAt)
    } catch (e) { if (alive.current) { setError(messageOf(e)); onError(e) } } finally { if (alive.current) setBusy(false) }
  }
  async function preflight(file?: File) {
    setPreview(null); setChecked(false); setError('')
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MiB')
      const parsed = parseBackup(await file.text())
      if (!alive.current) return
      const current = await refresh()
      if (!alive.current) return
      if (!current) throw new Error('无法读取当前云端数据，尚未完成预检')
      setPreview({ backup: parsed, base: current.revision })
    } catch (e) { if (alive.current) { setError(messageOf(e)); onError(e) } } finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel stack">
    <h2>完整备份与恢复</h2>
    <p>备份包含分类、项目、任务、周计划、安排、实际记录和容量设置。</p>
    <button disabled={disabled || busy} onClick={() => { void exportFile() }}>从云端导出完整 JSON</button>
    <p>本页上次成功生成文件：{lastExport ? new Date(lastExport).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未生成'}</p>
    <p className="muted">浏览器不能确认文件是否最终存入下载目录。此时间仅在当前页面保留。</p>
    <label>选择 v5 备份文件<input type="file" accept=".json,application/json" disabled={disabled || busy} onChange={e => { void preflight(e.target.files?.[0]); e.target.value = '' }} /></label>
    {busy && <p role="status">正在读取并校验…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <div className="notice stack">
      <h3>备份恢复预览</h3>
      <p>文件包含 {preview.backup.data.tasks.length} 项长期任务、{preview.backup.data.todos.length} 项待办、{preview.backup.data.weekItems.length} 个周目标、{preview.backup.data.schedules.length} 个安排和 {preview.backup.data.workLogs.length} 条实际记录。</p>
      <p>恢复会完整替换当前账号的数据。建议先导出现有数据。</p>
      <label className="check"><input type="checkbox" disabled={disabled} checked={checked} onChange={e => setChecked(e.target.checked)} />我确认替换当前账号全部业务数据与设置</label>
      {preview.base !== snapshot.revision && <p role="alert">云端版本已改变，请重新选择文件并预检。</p>}
      <button disabled={disabled || busy || !checked || preview.base !== snapshot.revision} onClick={() => restore(preview.backup, preview.base)}>确认恢复到云端</button>
      <button disabled={disabled} onClick={() => { setPreview(null); setChecked(false) }}>取消预览</button>
    </div>}
  </section>
}
