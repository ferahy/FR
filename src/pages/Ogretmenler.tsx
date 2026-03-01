import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import Toasts, { pushToast } from '../components/Toast'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Assignments, Day, Subject, Teacher } from '../shared/types'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useAssignments } from '../shared/useAssignments'
import { saveToCloud } from '../shared/cloudSync'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

// ─── Utilization helpers ──────────────────────────────────────────────────────

type UtilData = { required: number; available: number; pct: number }

function computeUtilization(
  t: Teacher,
  subjects: Subject[],
  gradesList: { id: string; label: string }[],
  dailyLessons: number,
  sectionCount: Record<string, number>,
  assignments: Assignments
): UtilData {
  const totalSlots = DAYS.length * Math.max(1, dailyLessons)
  const unavailCount = DAYS.reduce((sum, d) => sum + (t.unavailable?.[d]?.length ?? 0), 0)
  const available = Math.max(0, totalSlots - unavailCount)

  // Assignment-based: classKey|subjectId entries where value === teacher id
  const myAssignments = Object.entries(assignments).filter(([, tid]) => tid === t.id)

  let required = 0
  if (myAssignments.length > 0) {
    // Use actual assignments: each entry = one specific class-section + subject
    for (const [key] of myAssignments) {
      const pipeIdx = key.indexOf('|')
      if (pipeIdx < 0) continue
      const classKey = key.slice(0, pipeIdx)
      const subjectId = key.slice(pipeIdx + 1)
      const dashIdx = classKey.lastIndexOf('-')
      const grade = dashIdx >= 0 ? classKey.slice(0, dashIdx) : classKey
      const subj = subjects.find(s => s.id === subjectId)
      if (!subj) continue
      required += subj.weeklyHoursByGrade?.[grade] ?? 0
    }
  } else {
    // Fallback: estimate from preferred grades × section count
    const allGradeIds = gradesList.map(g => g.id)
    for (const sid of getSubjectIds(t)) {
      const subj = subjects.find(s => s.id === sid)
      if (!subj) continue
      const coveredGrades =
        t.preferredGradesBySubject?.[sid]?.length
          ? t.preferredGradesBySubject[sid]
          : t.preferredGrades?.length
          ? t.preferredGrades
          : allGradeIds
      for (const gid of coveredGrades) {
        required += (subj.weeklyHoursByGrade?.[gid] ?? 0) * (sectionCount[gid] ?? 1)
      }
    }
  }

  const pct = available > 0 ? Math.min(999, Math.round((required / available) * 100)) : 0
  return { required, available, pct }
}

function utilColor(pct: number): { bar: string; text: string; bg: string; label: string } {
  if (pct >= 95) return { bar: '#ef4444', text: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Aşırı Yüklü' }
  if (pct >= 80) return { bar: '#f97316', text: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'Yüksek' }
  if (pct >= 60) return { bar: '#eab308', text: '#ca8a04', bg: 'rgba(234,179,8,0.10)', label: 'Orta' }
  if (pct >= 30) return { bar: '#22c55e', text: '#16a34a', bg: 'rgba(34,197,94,0.10)', label: 'Normal' }
  return { bar: '#6b7280', text: '#9ca3af', bg: 'rgba(107,114,128,0.08)', label: 'Düşük' }
}

function UtilizationBadge({ pct, required, available }: UtilData) {
  const c = utilColor(pct)
  const barW = Math.min(100, pct)
  return (
    <div
      title={`Zorunlu: ${required} ders / Müsait: ${available} slot`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 110,
        maxWidth: 160,
        padding: '4px 8px 5px',
        borderRadius: 8,
        background: c.bg,
        border: `1px solid ${c.bar}30`,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: c.text, lineHeight: 1 }}>
          %{pct}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: c.text,
          background: `${c.bar}20`,
          borderRadius: 4,
          padding: '1px 5px',
          lineHeight: 1.5,
        }}>
          {c.label}
        </span>
      </div>
      {/* bar */}
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${barW}%`,
          borderRadius: 2,
          background: c.bar,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', lineHeight: 1 }}>
        {required}d / {available}sl
      </div>
    </div>
  )
}

type FormState = {
  name: string
  subjectIds: string[]
  minHours: string
  maxHours: string
  unavailable: Partial<Record<Day, string[]>>
  preferredBySubject: Record<string, { mode: 'all' | 'custom'; grades: string[] }>
}

export default function Ogretmenler() {
  const { subjects } = useSubjects()
  const { teachers, add, update, remove, resetAllAvailability } = useTeachers()
  const { assignments } = useAssignments()
  const { dailyLessons, grades: gradeConfigs } = useSchool()
  const gradesList = useGrades()
  const slots = useMemo(() => Array.from({ length: Math.max(1, dailyLessons || 1) }, (_, i) => `S${i + 1}`), [dailyLessons])
  const sectionCount = useMemo(() => {
    const map: Record<string, number> = {}
    for (const g of gradeConfigs) map[g.grade] = g.sections.length || 1
    return map
  }, [gradeConfigs])

  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Teacher | null>(null)
  const [availEditing, setAvailEditing] = useState<Teacher | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return teachers
      .filter((t) => {
        const matchName = q ? t.name.toLowerCase().includes(q) : true
        const ids = getSubjectIds(t)
        const matchBranch = branchFilter === 'all' ? true : ids.includes(branchFilter)
        return matchName && matchBranch
      })
      .map(t => ({ t, util: computeUtilization(t, subjects, gradesList, dailyLessons, sectionCount, assignments) }))
      .sort((a, b) => b.util.pct - a.util.pct)
  }, [teachers, query, branchFilter, subjects, gradesList, dailyLessons, sectionCount, assignments])

  const openCreate = () => { setEditing(null); setShowModal(true) }
  const openEdit = (t: Teacher) => { setEditing(t); setShowModal(true) }

  const onSave = (data: FormState) => {
    const min = clamp0(parseInt(data.minHours || '0', 10))
    const max = clamp0(parseInt(data.maxHours || '0', 10))
    if (data.name.trim().length < 2) { pushToast({ kind: 'error', text: 'İsim en az 2 karakter' }); return }
    if (!data.subjectIds || data.subjectIds.length === 0) { pushToast({ kind: 'error', text: 'En az bir branş seçin' }); return }
    if (min > 0 && max > 0 && min > max) { pushToast({ kind: 'error', text: 'Min, Max değerinden büyük olamaz' }); return }
    const preferredGradesBySubject: Record<string, string[]> = {}
    data.subjectIds.forEach(id => {
      const pref = data.preferredBySubject[id]
      if (pref?.mode === 'custom' && pref.grades.length) {
        preferredGradesBySubject[id] = Array.from(new Set(pref.grades))
      }
    })
    const primaryPref = data.subjectIds.length ? preferredGradesBySubject[data.subjectIds[0]] : undefined
    const normalized: Omit<Teacher,'id'> = {
      name: data.name.trim(),
      subjectIds: Array.from(new Set(data.subjectIds)),
      minHours: min,
      maxHours: max,
      unavailable: normalizeUnavailable(data.unavailable),
      preferredGrades: primaryPref,
      preferredGradesBySubject: Object.keys(preferredGradesBySubject).length ? preferredGradesBySubject : undefined,
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
          <button className="btn btn-danger" onClick={resetAllAvailability}>Uygunlukları Sıfırla</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-6">
          <div className="muted">Henüz öğretmen yok. &quot;Öğretmen Ekle&quot; ile başlayın.</div>
        </div>
      ) : (
        <div className="glass p-6 table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Yoğunluk</th>
                <th>Branş(lar)</th>
                <th>Min/Max</th>
                <th>Tercih Sınıflar</th>
                <th>Uygunluk</th>
                <th>Aksiyonlar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ t, util }) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td><UtilizationBadge {...util} /></td>
                  <td>{branchNames(getSubjectIds(t)) || '—'}</td>
                  <td>{t.minHours ?? 0} / {t.maxHours ?? 0}</td>
                  <td>{formatPrefBySubject(t, subjects, gradesList)}</td>
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
            {filtered.map(({ t, util }) => (
              <div key={t.id} className="card glass">
                <div className="card-head">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="card-title">{t.name}</div>
                    <UtilizationBadge {...util} />
                  </div>
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
                    <span className="pill">Tercih: {formatPrefBySubject(t, subjects, gradesList)}</span>
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
        key={editing?.id ?? 'new'}
        subjects={subjects.map(s=> ({ id: s.id, name: s.name }))}
        grades={gradesList}
        nameRef={nameRef}
      />

      <AvailabilityDialog
        open={!!availEditing}
        onClose={()=> setAvailEditing(null)}
        teacher={availEditing ?? undefined}
        slots={slots}
        onSave={async (unavailable)=> {
          if (availEditing) {
            const { id, ...rest } = availEditing
            update(id, { ...rest, unavailable })
            const res = await saveToCloud()
            pushToast({ kind: res.ok ? 'success' : 'error', text: res.ok ? 'Uygunluk güncellendi' : `Buluta kaydedilemedi: ${res.error}` })
          }
          setAvailEditing(null)
        }}
      />

      <Modal open={!!confirmDelete} onClose={()=> setConfirmDelete(null)} title="Silme Onayı">
        <p>"{confirmDelete?.name}" öğretmenini silmek istediğinize emin misiniz?</p>
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
  const buildState = (init?: Teacher): FormState => {
    const subjectIds = getSubjectIds(init)
    const preferredBySubject: FormState['preferredBySubject'] = {}
    subjectIds.forEach((id, idx) => {
      const customGrades = init?.preferredGradesBySubject?.[id]
      // fallback: legacy preferredGrades applied to primary subject only
      const legacy = !customGrades && idx === 0 ? init?.preferredGrades : undefined
      const gradesVal = customGrades ?? legacy ?? []
      preferredBySubject[id] = {
        mode: gradesVal.length > 0 ? 'custom' : 'all',
        grades: gradesVal,
      }
    })

    return {
      name: init?.name ?? '',
      subjectIds,
      minHours: init?.minHours ? String(init.minHours) : '15',
      maxHours: init?.maxHours ? String(init.maxHours) : '30',
      unavailable: init?.unavailable ?? {},
      preferredBySubject,
    }
  }

  const [state, setState] = useState<FormState>(() => buildState(initial))
  // Multi-branch via two clean selects (primary + optional secondary)
  const [errors, setErrors] = useState<Record<string,string>>({})
  const prevId = useRef<string | undefined>(initial?.id)
  if (prevId.current !== initial?.id) {
    prevId.current = initial?.id
    setState(buildState(initial))
    setErrors({})
  }
  useEffect(() => {
    if (open && !initial) {
      prevId.current = undefined
      setState(buildState(undefined))
      setErrors({})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
                  let next = [...(prev.subjectIds || [])]
                  if (v) {
                    next = [v, ...next.filter(id => id !== v)]
                  } else {
                    next = next.filter((_, idx) => idx !== 0)
                  }
                  const pref = { ...prev.preferredBySubject }
                  Object.keys(pref).forEach(id => { if (!next.includes(id)) delete pref[id] })
                  next.forEach(id => { if (!pref[id]) pref[id] = { mode: 'all', grades: [] } })
                  return { ...prev, subjectIds: next, preferredBySubject: pref }
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
                            setState(prev => {
                              const next = [...prev.subjectIds, s.id]
                              const pref = { ...prev.preferredBySubject }
                              if (!pref[s.id]) pref[s.id] = { mode: 'all', grades: [] }
                              return { ...prev, subjectIds: next, preferredBySubject: pref }
                            })
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
                onClick={() => setState(prev => {
                  const nextIds = prev.subjectIds.filter(x => x !== id)
                  const pref = { ...prev.preferredBySubject }
                  delete pref[id]
                  return { ...prev, subjectIds: nextIds, preferredBySubject: pref }
                })}
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
          <span className="field-label">Tercih Sınıflar (branşa göre)</span>
          {state.subjectIds.length === 0 ? (
            <div className="muted" style={{ fontStyle: 'italic' }}>Branş ekledikçe tercih sınıflarını seçebilirsiniz.</div>
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              {state.subjectIds.map((id) => {
                const subjName = subjects.find(s => s.id === id)?.name || id
                const pref = state.preferredBySubject[id] ?? { mode: 'all', grades: [] }
                return (
                  <div
                    key={id}
                    className="glass"
                    style={{
                      padding: 8,
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.02)',
                      boxShadow: '0 6px 16px rgba(0,0,0,0.18)',
                    }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{subjName}</div>
                      <div className="segmented seg-xs" role="group" aria-label={`${subjName} tercih modu`}>
                        <button type="button" className={`seg ${pref.mode === 'all' ? 'active free' : ''}`} aria-pressed={pref.mode === 'all'} onClick={() => setState(prev => ({
                          ...prev,
                          preferredBySubject: { ...prev.preferredBySubject, [id]: { mode: 'all', grades: [] } }
                        }))}>Hepsi</button>
                        <button type="button" className={`seg ${pref.mode === 'custom' ? 'active free' : ''}`} aria-pressed={pref.mode === 'custom'} onClick={() => setState(prev => ({
                          ...prev,
                          preferredBySubject: {
                            ...prev.preferredBySubject,
                            [id]: { mode: 'custom', grades: pref.grades.length ? pref.grades : grades.map(g => g.id) }
                          }
                        }))}>Özel</button>
                      </div>
                    </div>
                    {pref.mode === 'custom' && (
                      <div className="check-grid">
                        {grades.map(g => (
                          <label key={g.id} className="check-item">
                            <input
                              type="checkbox"
                              checked={pref.grades.includes(g.id)}
                              onChange={() => setState(prev => {
                                const cur = prev.preferredBySubject[id]?.grades ?? []
                                const nextGrades = cur.includes(g.id) ? cur.filter(x => x !== g.id) : [...cur, g.id]
                                return {
                                  ...prev,
                                  preferredBySubject: {
                                    ...prev.preferredBySubject,
                                    [id]: { mode: 'custom', grades: nextGrades }
                                  }
                                }
                              })}
                            />
                            <span>{g.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
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
  const [map, setMap] = useState<Partial<Record<Day, string[]>>>({})

  // Update state when teacher changes or dialog opens
  useEffect(() => {
    if (open && teacher) {
      setMap(teacher.unavailable ?? {})
    }
  }, [open, teacher])

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

function formatPrefBySubject(
  t: Teacher,
  subjects: { id: string; name: string }[],
  gradesList: { id: string; label: string }[]
): string {
  if (t.preferredGradesBySubject && Object.keys(t.preferredGradesBySubject).length) {
    const parts = Object.entries(t.preferredGradesBySubject)
      .filter(([, grades]) => grades && grades.length)
      .map(([sid, grades]) => {
        const name = subjects.find(s => s.id === sid)?.name || sid
        return `${name}: ${formatPref(grades, gradesList)}`
      })
    if (parts.length) return parts.join(' • ')
  }
  return formatPref(t.preferredGrades, gradesList)
}
