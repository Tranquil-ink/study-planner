import type { CategoryInput, Snapshot, TaskInput } from '../../domain/model'
export type Editor = { kind: 'category'; value: CategoryInput; base: number } | { kind: 'task'; value: TaskInput; base: number }
interface Props { editor: Editor; snapshot: Snapshot; disabled: boolean; onChange: (editor: Editor) => void; onSave: () => void; onCancel: () => void; onRebase: () => void }
export function TaskEditor({ editor, snapshot, disabled, onChange, onSave, onCancel, onRebase }: Props) {
  function changeCategory(patch: Partial<CategoryInput>) { if (editor.kind === 'category') onChange({ ...editor, value: { ...editor.value, ...patch } }) }
  function changeTask(patch: Partial<TaskInput>) { if (editor.kind === 'task') onChange({ ...editor, value: { ...editor.value, ...patch } }) }
  return <section className="panel" aria-label="编辑表单">
    <h2>{editor.kind === 'category' ? '分类' : '长期任务'}</h2>
    <p>输入暂存在当前页面，收到云端确认后才算保存。</p>
    <form onSubmit={event => { event.preventDefault(); onSave() }}>
      <fieldset disabled={disabled}>
        {editor.kind === 'category' ? <>
          <label>分类名称<input value={editor.value.name} maxLength={100} required onChange={e => changeCategory({ name: e.target.value })} /></label>
          <label>分类颜色<input type="color" value={editor.value.color} onChange={e => changeCategory({ color: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={editor.value.archived} onChange={e => changeCategory({ archived: e.target.checked })} />归档分类（保留原有任务）</label>
        </> : <>
          <label>任务名称<input value={editor.value.title} maxLength={200} required onChange={e => changeTask({ title: e.target.value })} /></label>
          <div><label htmlFor="task-category">分类</label><select id="task-category" value={editor.value.categoryId} required onChange={e => changeTask({ categoryId: e.target.value })}>
            <option value="">请选择分类</option>{snapshot.categories.map(c => <option value={c.id} key={c.id}>{c.name}{c.archived ? '（已归档）' : ''}</option>)}
          </select></div>
          <label>进度单位<input value={editor.value.unitName} maxLength={20} placeholder="节、页、题或自定义" required onChange={e => changeTask({ unitName: e.target.value })} /></label>
          <label>总量（可留空）<input inputMode="decimal" value={editor.value.totalUnits ?? ''} onChange={e => changeTask({ totalUnits: e.target.value === '' ? null : e.target.value })} /></label>
          <label>初始已完成量<input inputMode="decimal" value={editor.value.initialCompletedUnits} required onChange={e => changeTask({ initialCompletedUnits: e.target.value })} /></label>
          <label>初始位置文字<input value={editor.value.initialProgressLabel} maxLength={200} placeholder="例如 2.1.1" onChange={e => changeTask({ initialProgressLabel: e.target.value })} /></label>
          <div><label htmlFor="task-note">备注</label><textarea id="task-note" value={editor.value.note} maxLength={5000} onChange={e => changeTask({ note: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={editor.value.archived} onChange={e => changeTask({ archived: e.target.checked })} />归档任务</label>
          <p className="muted">累计完成量由初始量与实际记录相加得到。调整总量或初始量后仍须容纳全部实际进度；小数最多 6 位。</p>
        </>}
      </fieldset>
      {editor.base !== snapshot.revision && <div className="notice">
        <p>云端版本已变化。请对照最新列表核对输入，再明确选择重新应用；不会自动覆盖。</p>
        <button type="button" disabled={disabled} onClick={onRebase}>已核对，将此输入应用到最新版本</button>
      </div>}
      <div className="actions"><button disabled={disabled || editor.base !== snapshot.revision}>保存到云端</button><button type="button" disabled={disabled} onClick={onCancel}>取消编辑</button></div>
    </form>
  </section>
}
