import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import Toasts, { pushToast } from '../components/Toast'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day, Teacher } from '../shared/types'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

type FormState = {
  name: string
  subjectIds: string[]
  minHours: string
  maxHours: string
  unavailable: Partial<Record<Day, string[]>>
  preferredGradesMode: 'all' | 'custom'
  preferredGrades: string[]
}

export default function Ogretmenler() {
  const { subjects } = useSubjects()
  const { teachers, add, update, remove } = useTeachers()
  const { dailyLessons } = useSchool()
  const gradesList = useGrades()
  const slots = useMemo(() => Array.from({ length: Math.max(1, dailyLessons || 1) }, (_, i) => `S${i + 1}`), [dailyLessons])

  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Teacher | null>(null)
  const [availEditing, setAvailEditing] = useState<Teacher | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return teachers.filter((t) => {
      const matchName = q ? t.name.toLowerCase().includes(q) : true
      const ids = getSubjectIds(t)
      const matchBranch = branchFilter === 'all' ? true : ids.includes(branchFilter)
      return matchName && matchBranch
    })
  }, [teachers, query, branchFilter])

  const openCreate = () => { setEditing(null); setShowModal(true) }
  const openEdit = (t: Teacher) => { setEditing(t); setShowModal(true) }

  const onSave = (data: FormState) => {
    const min = clamp0(parseInt(data.minHours || '0', 10))
    const max = clamp0(parseInt(data.maxHours || '0', 10))
    if (data.name.trim().length < 2) { pushToast({ kind: 'error', text: 'İsim en az 2 karakter' }); return }
    if (!data.subjectIds || data.subjectIds.length === 0) { pushToast({ kind: 'error', text: 'En az bir branş seçin' }); return }
    if (min > 0 && max > 0 && min > max) { pushToast({ kind: 'error', text: 'Min, Max değerinden büyük olamaz' }); return }
    const normalized: Omit<Teacher,'id'> = {
      name: data.name.trim(),
      subjectIds: Array.from(new Set(data.subjectIds)),
      minHours: min,
      maxHours: max,
      unavailable: normalizeUnavailable(data.unavailable),
      preferredGrades: data.preferredGradesMode === 'all' ? undefined : Array.from(new Set(data.preferredGrades || [])),
    }
    if (editing) { update(editing.id, normalized); pushToast({ kind: 'success', text: 'Öğretmen güncellendi' }) }
    else { add(normalized); pushToast({ kind: 'success', text: 'Öğretmen eklendi' }) }
    setShowModal(false)
  }

  const onDelete = () => {
    if (!confirmDelete) return
    remove(confirmDelete.id)
    pushToast({ kind: 'success', text: 'Öğretmen silindi' })
    setConfirmDelete(null)
  }

  const branchNames = (ids: string[]) => ids.map(id => subjects.find(s => s.id === id)?.name || id).join(', ')

  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // close on outside click / Esc
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (addBtnRef.current?.contains(t)) return
      setPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [pickerOpen])

  return (
    <>
      <Toasts />

      {/* Search & filter */}
      <div className="glass p-6" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <input className="input" placeholder="İsimde ara" value={query} onChange={(e)=> setQuery(e.target.value)} style={{ flex: '1 1 260px' }} />
          <select className="select" value={branchFilter} onChange={(e)=> setBranchFilter(e.target.value)}>
            <option value="all">Tüm branşlar</option>
            {subjects.map((s)=> <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-6">
          <div className="muted">Henüz öğretmen yok. “Öğretmen Ekle” ile başlayın.</div>
        </div>
      ) : (
        <div className="glass p-6 table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Branş(lar)</th>
                <th>Min/Max</th>
                <th>Tercih Sınıflar</th>
                <th>Uygunluk</th>
                <th>Aksiyonlar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{branchNames(getSubjectIds(t)) || '—'}</td>
                  <td>{t.minHours ?? 0} / {t.maxHours ?? 0}</td>
                  <td>{formatPref(t.preferredGrades, gradesList)}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={()=> setAvailEditing(t)} aria-label="Uygunluğu düzenle">Düzenle</button>
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn btn-outline" onClick={()=> openEdit(t)} aria-label="Düzenle">Düzenle</button>
                      <button className="btn btn-danger" onClick={()=> setConfirmDelete(t)} aria-label="Sil">Sil</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="cards">
            {filtered.map((t) => (
              <div key={t.id} className="card glass">
                <div className="card-head">
                  <div className="card-title">{t.name}</div>
                  <div className="row">
                    <button className="btn btn-outline btn-sm" onClick={()=> setAvailEditing(t)}>Uygunluk</button>
                    <button className="btn btn-outline btn-sm" onClick={()=> openEdit(t)}>Düzenle</button>
                    <button className="btn btn-danger btn-sm" onClick={()=> setConfirmDelete(t)}>Sil</button>
                  </div>
                </div>
                <div className="card-body">
                  <div className="meta">
                    <span className="pill">Branş(lar): {branchNames(getSubjectIds(t)) || '—'}</span>
                    <span className="pill">Min/Max: {t.minHours ?? 0}/{t.maxHours ?? 0}</span>
                    <span className="pill">Tercih: {formatPref(t.preferredGrades, gradesList)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', marginTop:12, marginBottom:40 }}>
        <button className="btn btn-primary" onClick={openCreate}>Öğretmen Ekle</button>
      </div>

      <TeacherModal
        open={showModal}
        onClose={()=> setShowModal(false)}
        onSave={onSave}
        initial={editing ?? undefined}
        subjects={subjects.map(s=> ({ id: s.id, name: s.name }))}
        grades={gradesList}
        nameRef={nameRef}
      />

      <AvailabilityDialog
        open={!!availEditing}
        onClose={()=> setAvailEditing(null)}
        teacher={availEditing ?? undefined}
        slots={slots}
        onSave={(unavailable)=> {
          if (availEditing) {
            const { id, ...rest } = availEditing
            update(id, { ...rest, unavailable })
            pushToast({ kind: 'success', text: 'Uygunluk güncellendi' })
          }
          setAvailEditing(null)
        }}
      />

      <Modal open={!!confirmDelete} onClose={()=> setConfirmDelete(null)} title="Silme Onayı">
        <p>“{confirmDelete?.name}” öğretmenini silmek istediğinize emin misiniz?</p>
        <div className="row" style={{ justifyContent:'flex-end', marginTop:12 }}>
          <button className="btn btn-outline" onClick={()=> setConfirmDelete(null)}>İptal</button>
          <button className="btn btn-danger" onClick={onDelete}>Sil</button>
        </div>
      </Modal>
    </>
  )
}

function TeacherModal({ open, onClose, onSave, initial, subjects, grades, nameRef }:{
  open: boolean
  onClose: () => void
  onSave: (data: FormState) => void
  initial?: Teacher
  subjects: { id: string; name: string }[]
  grades: { id: string; label: string }[]
  nameRef: React.RefObject<HTMLInputElement | null>
}) {
  const [state, setState] = useState<FormState>(() => ({
    name: initial?.name ?? '',
    subjectIds: getSubjectIds(initial),
    minHours: initial?.minHours ? String(initial.minHours) : '15',
    maxHours: initial?.maxHours ? String(initial.maxHours) : '30',
    unavailable: initial?.unavailable ?? {},
    preferredGradesMode: initial?.preferredGrades && initial.preferredGrades.length > 0 ? 'custom' : 'all',
    preferredGrades: initial?.preferredGrades ?? [],
  }))
  // Multi-branch via two clean selects (primary + optional secondary)
  const [errors, setErrors] = useState<Record<string,string>>({})
  const prevId = useRef<string | undefined>(initial?.id)
  if (prevId.current !== initial?.id) {
    prevId.current = initial?.id
    setState({
      name: initial?.name ?? '',
      subjectIds: getSubjectIds(initial),
      minHours: initial?.minHours ? String(initial.minHours) : '15',
      maxHours: initial?.maxHours ? String(initial.maxHours) : '30',
      unavailable: initial?.unavailable ?? {},
      preferredGradesMode: initial?.preferredGrades && initial.preferredGrades.length > 0 ? 'custom' : 'all',
      preferredGrades: initial?.preferredGrades ?? [],
    })
    setErrors({})
  }

  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (addBtnRef.current?.contains(t)) return
      setPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string,string> = {}
    if (!state.name || state.name.trim().length < 2) errs.name = 'İsim en az 2 karakter'
    if (!state.subjectIds || state.subjectIds.length === 0) errs.subjectIds = 'En az bir branş seçin'
    const min = clamp0(parseInt(state.minHours || '0', 10))
    const max = clamp0(parseInt(state.maxHours || '0', 10))
    if (min > 0 && max > 0 && min > max) errs.range = 'Min, Max değerinden büyük olamaz'
    setErrors(errs)
    if (Object.keys(errs).length) { pushToast({ kind: 'error', text: 'Lütfen hataları düzeltin' }); return }
    onSave(state)
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title={initial ? 'Öğretmeni Düzenle' : 'Öğretmen Ekle'} initialFocusRef={nameRef as React.RefObject<HTMLElement | null>}>
      <form onSubmit={submit} className="form-grid">
        <label className="field">
          <span className="field-label">İsim</span>
          <input ref={nameRef} className={`input ${errors.name ? 'field-error' : ''}`} value={state.name} onChange={(e)=> setState(s=> ({...s, name: e.target.value}))} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'err-name' : undefined} placeholder="örn. Ayşe Öğrt." />
          {errors.name && <span id="err-name" className="error-text">{errors.name}</span>}
        </label>

        <div className="field-row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ flex: '1 1 260px' }}>
            <span className="field-label">Birincil Branş</span>
            <select
              className={`select ${errors.subjectIds ? 'field-error' : ''}`}
              value={state.subjectIds[0] ?? ''}
              onChange={(e)=> {
                const v = e.target.value
                setState(prev => {
                  const rest = (prev.subjectIds || []).filter(id => id !== v)
                  const next = v ? [v, ...rest.filter(id => id !== v)] : rest
                  return { ...prev, subjectIds: next }
                })
              }}
              aria-invalid={!!errors.subjectIds}
            >
              <option value="">Seçin</option>
              {subjects.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.subjectIds && <span className="error-text">{errors.subjectIds}</span>}
          </label>
          <div className="branch-add-wrap">
            <button
              type="button"
              ref={addBtnRef}
              className="btn btn-primary btn-sm"
              onClick={() => setPickerOpen(prev => !prev)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
            >
              + Branş Ekle
            </button>
            {pickerOpen && (
              <div ref={popRef} className="popover-menu glass" role="listbox" aria-label="Branş ekle">
                <div className="menu">
                  {subjects.filter(s => !state.subjectIds.includes(s.id)).length === 0 ? (
                    <div className="menu-empty muted">Tüm branşlar seçildi</div>
                  ) : (
                    subjects
                      .filter(s => !state.subjectIds.includes(s.id))
                      .map(s => (
                        <button
                          key={s.id}
                          className="menu-item"
                          role="option"
                          onClick={() => {
                            setState(prev => ({ ...prev, subjectIds: [...prev.subjectIds, s.id] }))
                            setPickerOpen(false)
                          }}
                        >
                          {s.name}
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="branch-list">
          {state.subjectIds.slice(1).map((id) => (
            <div key={id} className="branch-tag">
              <span className="branch-name">{subjects.find(s => s.id === id)?.name || id}</span>
              <button
                className="branch-remove"
                aria-label="Branşı kaldır"
                title="Kaldır"
                onClick={() => setState(prev => ({ ...prev, subjectIds: prev.subjectIds.filter(x => x !== id) }))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"></circle>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="field">
          <span className="field-label">Tercih Sınıflar</span>
          <div className="segmented seg-xs" role="group" aria-label="Tercih Sınıflar modu" style={{ marginBottom: 8 }}>
            <button type="button" className={`seg ${state.preferredGradesMode === 'all' ? 'active free' : ''}`} aria-pressed={state.preferredGradesMode === 'all'} onClick={() => setState(prev => ({ ...prev, preferredGradesMode: 'all' }))}>Hepsi</button>
            <button type="button" className={`seg ${state.preferredGradesMode === 'custom' ? 'active free' : ''}`} aria-pressed={state.preferredGradesMode === 'custom'} onClick={() => setState(prev => ({ ...prev, preferredGradesMode: 'custom', preferredGrades: prev.preferredGrades.length ? prev.preferredGrades : grades.map(g=> g.id) }))}>Özel</button>
          </div>
          {state.preferredGradesMode === 'custom' && (
            <div className="check-grid">
              {grades.map(g => (
                <label key={g.id} className="check-item">
                  <input
                    type="checkbox"
                    checked={state.preferredGrades.includes(g.id)}
                    onChange={() => setState(prev => ({
                      ...prev,
                      preferredGrades: prev.preferredGrades.includes(g.id)
                        ? prev.preferredGrades.filter(x => x !== g.id)
                        : [...prev.preferredGrades, g.id]
                    }))}
                  />
                  <span>{g.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="field-row">
          <label className="field" style={{ flex:'1 1 200px' }}>
            <span className="field-label">Min saat</span>
            <input className={`input ${errors.range ? 'field-error' : ''}`} type="number" min={0} step={1} value={state.minHours} onChange={(e)=> setState(s=> ({...s, minHours: onlyDigits(e.target.value)}))} />
          </label>
          <label className="field" style={{ flex:'1 1 200px' }}>
            <span className="field-label">Max saat</span>
            <input className={`input ${errors.range ? 'field-error' : ''}`} type="number" min={0} step={1} value={state.maxHours} onChange={(e)=> setState(s=> ({...s, maxHours: onlyDigits(e.target.value)}))} />
            {errors.range && <span className="error-text">{errors.range}</span>}
          </label>
        </div>

        <div className="row" style={{ justifyContent:'flex-end', marginTop:12 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>İptal</button>
          <button type="submit" className="btn btn-primary">Kaydet</button>
        </div>
      </form>
    </Modal>
    </>
  )
}

function AvailabilityDialog({ open, onClose, teacher, onSave, slots }:{
  open: boolean
  onClose: () => void
  teacher?: Teacher
  onSave: (unavailable: Partial<Record<Day, string[]>>) => void
  slots: string[]
}) {
  const [map, setMap] = useState<Partial<Record<Day, string[]>>>(teacher?.unavailable ?? {})
  const title = teacher ? `Uygunluk — ${teacher.name}` : 'Uygunluk'
  const toggle = (day: Day, slot: string) => {
    setMap(prev => {
      const cur = new Set(prev[day] ?? [])
      if (cur.has(slot)) cur.delete(slot); else cur.add(slot)
      return { ...prev, [day]: Array.from(cur) }
    })
  }
  const dayToggle = (day: Day, off: boolean) => {
    setMap(prev => ({ ...prev, [day]: off ? [...slots] : [] }))
  }
  const clearAll = () => setMap({})

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="avail">
        <div className="avail-toolbar row" style={{ justifyContent:'space-between' }}>
          <div className="muted">Hücreye tıkla: Engelle/İzin ver</div>
          <div className="row">
            <button className="btn btn-outline btn-sm" onClick={clearAll}>Tümünü Temizle</button>
          </div>
        </div>
        <div className="avail-grid" style={{ gridTemplateColumns: `110px repeat(${slots.length}, 1fr)` }}>
          <div className="head"></div>
          {slots.map(s=> <div key={s} className="head">{s}</div>)}
          {DAYS.map((d)=> (
            <>
              <div key={d+':h'} className="row-head">
                <div className="row-title">{d}</div>
                <div className="row-actions"></div>
              </div>
              {slots.map((s)=> {
                const blocked = (map[d] ?? []).includes(s)
                return (
                  <button key={d+':'+s} className={`cell ${blocked ? 'blocked' : 'free'}`} aria-pressed={blocked} onClick={()=> toggle(d, s)}>
                    {blocked ? '⛔' : '✓'}
                  </button>
                )
              })}
              {(() => {
                const allBlocked = (map[d]?.length ?? 0) >= slots.length
                return (
                  <div key={d+':controls'} className="day-controls" style={{ gridColumn: `2 / span ${slots.length}` }}>
                    <div className="segmented seg-xs" role="group" aria-label={`${d} günü`}>
                      <button type="button" className={`seg ${!allBlocked ? 'active free' : ''}`} aria-pressed={!allBlocked} onClick={()=> dayToggle(d, false)}>Açık</button>
                      <button type="button" className={`seg ${allBlocked ? 'active blocked' : ''}`} aria-pressed={allBlocked} onClick={()=> dayToggle(d, true)}>Kapalı</button>
                    </div>
                  </div>
                )
              })()}
            </>
          ))}
        </div>
        <div className="row" style={{ justifyContent:'flex-end', marginTop:12 }}>
          <button className="btn btn-outline" onClick={onClose}>İptal</button>
          <button className="btn btn-primary" onClick={()=> onSave(normalizeUnavailable(map))}>Kaydet</button>
        </div>
      </div>
    </Modal>
  )
}

function clamp0(n: number){ return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0 }
function onlyDigits(v: string){ return v.replace(/[^0-9]/g,'') }
function normalizeUnavailable(map: Partial<Record<Day, string[]>>){
  const out: Partial<Record<Day, string[]>> = {}
  for (const d of DAYS){
    const arr = Array.from(new Set(map[d] ?? [])).filter(Boolean)
    if (arr.length) out[d] = arr
  }
  return out
}

function getSubjectIds(t?: Teacher): string[] {
  if (!t) return []
  if (t.subjectIds && t.subjectIds.length) return t.subjectIds
  if (t.subjectId) return [t.subjectId]
  return []
}

// toggleId removed (no longer used)

function formatPref(pref: string[] | undefined, gradesList: { id: string; label: string }[]): string {
  if (!pref || pref.length === 0) return 'Hepsi'
  const map = new Map(gradesList.map(g => [g.id, g.label]))
  return pref.map(id => map.get(id) || id).join(', ')
}
