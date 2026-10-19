import { useEffect, useRef, useState } from 'react'
import { parseBackup, type Backup } from '../../data/backup'
import { messageOf } from '../../data/errors'
import type { Snapshot } from '../../domain/model'
import type { Repository } from '../../data/repository'
interface Preview { backup: Backup; base: number; migrated: boolean; sourceVersion: number; categories: number; tasks: number; schedules: number }
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
      setPreview({ ...parsed, base: current.revision, categories: current.categories.length, tasks: current.tasks.length, schedules: current.schedules.length })
    } catch (e) { if (alive.current) { setError(messageOf(e)); onError(e) } } finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel">
    <h2>完整备份与恢复</h2>
    <p>导出从云端获取全部分类、任务（含归档）、日程与时间快照和设置。文件含个人数据，请妥善保存。</p>
    <button disabled={disabled || busy} onClick={() => { void exportFile() }}>从云端导出完整 JSON</button>
    <p>本页上次成功生成文件：{lastExport ? new Date(lastExport).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未生成'}</p>
    <p className="muted">浏览器不能确认文件是否最终存入下载目录。此时间仅在当前页面保留。</p>
    <label>选择备份 / 本地数据迁移文件<input type="file" accept=".json,application/json" disabled={disabled || busy} onChange={e => { void preflight(e.target.files?.[0]); e.target.value = '' }} /></label>
    <p className="muted">旧数据须先在原浏览器、原网址导出。仅支持说明中约定的旧 JSON 格式，不会读取其他网址的 IndexedDB。</p>
    {busy && <p role="status">正在读取并校验…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <div className="notice">
      <h3>{preview.migrated ? `旧格式迁移预览（v${preview.sourceVersion} → v2）` : '备份恢复预览（v2）'}</h3>
      <p>文件导出于 {preview.backup.exportedAt}；包含分类 {preview.backup.data.categories.length} 个、任务 {preview.backup.data.tasks.length} 个、日程 {preview.backup.data.schedules.length} 个、设置 1 份。</p>
      <p>预检时云端有分类 {preview.categories} 个、任务 {preview.tasks} 个、日程 {preview.schedules} 个。恢复会完整替换当前账号的数据，建议先导出。</p>
      {preview.migrated && <p>旧备份没有日程，迁移后日程为 0 项。完整替换将移除当前已有日程，请先备份。</p>}
      <label className="check"><input type="checkbox" disabled={disabled} checked={checked} onChange={e => setChecked(e.target.checked)} />我确认替换当前账号全部业务数据与设置</label>
      {preview.base !== snapshot.revision && <p role="alert">云端版本已改变，请重新选择文件并预检。</p>}
      <button disabled={disabled || busy || !checked || preview.base !== snapshot.revision} onClick={() => restore(preview.backup, preview.base)}>确认恢复到云端</button>
      <button disabled={disabled} onClick={() => { setPreview(null); setChecked(false) }}>取消预览</button>
    </div>}
  </section>
}
