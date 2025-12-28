import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import Toasts, { pushToast } from '../components/Toast'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import type { Subject } from '../shared/types'
import { useSchool } from '../shared/useSchool'

const SUBJECT_COLORS = [
  '#93c5fd', '#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#fb7185', '#f472b6', '#60a5fa', '#38bdf8'
]

type FormState = {
  name: string
  weeklyHoursByGrade: Record<string, string>
  enabledByGrade: Record<string, boolean>
  perDayMax: string
  maxConsecutive: string
  minDays: string
  color: string
}

export default function Dersler() {
  const grades = useGrades()
  const { subjects, add, update, remove } = useSubjects()
  const { dailyLessons } = useSchool()

  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Subject | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Subject | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return subjects.filter((s) => {
      const matchName = q ? s.name.toLowerCase().includes(q) : true
      const matchGrade = gradeFilter === 'all' ? true : (s.weeklyHoursByGrade[gradeFilter] ?? 0) > 0
      return matchName && matchGrade
    })
  }, [subjects, query, gradeFilter])

  const openCreate = () => {
    setEditing(null)
    setShowModal(true)
  }
  const openEdit = (s: Subject) => {
    setEditing(s)
    setShowModal(true)
  }

  const onSave = (data: FormState) => {
    const normalized: Omit<Subject, 'id'> = {
      name: data.name.trim(),
      weeklyHoursByGrade: Object.fromEntries(
        Object.entries(data.weeklyHoursByGrade).map(([k, v]) => [k, data.enabledByGrade[k] ? Math.max(1, toInt(v)) : 0])
      ),
      rule: {
        perDayMax: data.perDayMax ? Math.max(0, toInt(data.perDayMax)) : 0,
        maxConsecutive: data.maxConsecutive ? Math.max(0, toInt(data.maxConsecutive)) : 0,
        minDays: data.minDays ? Math.max(0, toInt(data.minDays)) : 0,
      },
      color: data.color,
    }
    if (editing) {
      update(editing.id, normalized)
      pushToast({ kind: 'success', text: 'Ders güncellendi' })
    } else {
      add(normalized)
      pushToast({ kind: 'success', text: 'Ders eklendi' })
    }
    setShowModal(false)
  }

  const onDelete = () => {
    if (!confirmDelete) return
    remove(confirmDelete.id)
    pushToast({ kind: 'success', text: 'Ders silindi' })
    setConfirmDelete(null)
  }

  return (
    <>
      <Toasts />
      {/* Search and filter bar stays at top */}

      <div className="glass p-6" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <input
            className="input"
            placeholder="Ders adında ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Ders adında ara"
            style={{ flex: '1 1 260px' }}
          />
          <select
            className="select"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            aria-label="Sınıf filtresi"
          >
            <option value="all">Tüm sınıflar</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-6">
          <div className="muted">Henüz ders yok. “Ders Ekle” ile başlayın.</div>
        </div>
      ) : (
        <div className="glass p-6 table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ders Adı</th>
                {grades.map((g) => (
                  <th key={g.id}>{g.label}</th>
                ))}
                <th>Günlük Üst Sınır</th>
                <th>Üst üste</th>
                <th>En az gün</th>
                <th>Aksiyonlar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="color-dot" style={{ background: s.color ?? '#93c5fd' }} aria-hidden /> {s.name}
                  </td>
                  {grades.map((g) => (
                    <td key={g.id}>{s.weeklyHoursByGrade[g.id] ?? 0}</td>
                  ))}
                  <td>{s.rule?.perDayMax && s.rule.perDayMax > 0 ? s.rule.perDayMax : 'Sınırsız'}</td>
                  <td>{s.rule?.maxConsecutive && s.rule.maxConsecutive > 0 ? s.rule.maxConsecutive : '-'}</td>
                  <td>{s.rule?.minDays && s.rule.minDays > 0 ? `${s.rule.minDays} gün` : '-'}</td>
                  <td>
                    <div className="row">
                      <button className="btn btn-outline" aria-label="Düzenle" onClick={() => openEdit(s)}>Düzenle</button>
                      <button className="btn btn-danger" aria-label="Sil" onClick={() => setConfirmDelete(s)}>Sil</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="cards">
            {filtered.map((s) => {
              const anyHours = grades.some((g) => (s.weeklyHoursByGrade[g.id] ?? 0) > 0)
              return (
                <div key={s.id} className="card glass">
                  <div className="card-head">
                    <div className="card-title">
                      <span className="color-dot" style={{ background: s.color ?? '#93c5fd' }} aria-hidden /> {s.name}
                    </div>
                    <div className="row">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)} aria-label="Düzenle">Düzenle</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(s)} aria-label="Sil">Sil</button>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="hours">
                      {anyHours ? (
                        grades.map((g) => {
                          const h = s.weeklyHoursByGrade[g.id] ?? 0
                          if (h <= 0) return null
                          return (
                            <div key={g.id} className="chip" title={`${g.label}: ${h} saat`} aria-label={`${g.label}: ${h} saat`}>
                              {g.label}: {h} saat
                            </div>
                          )
                        })
                      ) : (
                        <span className="muted">Bu derste saat tanımlı değil.</span>
                      )}
                    </div>
                    <div className="meta">
                      <span className="pill">Günlük Üst: {s.rule?.perDayMax && s.rule.perDayMax > 0 ? s.rule.perDayMax : 'Sınırsız'}</span>
                      <span className="pill">Üst üste: {s.rule?.maxConsecutive && s.rule.maxConsecutive > 0 ? s.rule.maxConsecutive : '-'}</span>
                      <span className="pill">En az gün: {s.rule?.minDays && s.rule.minDays > 0 ? `${s.rule.minDays}` : '-'}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bottom-centered add button under the list */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12, marginBottom: 40 }}>
        <button className="btn btn-primary" onClick={openCreate}>Ders Ekle</button>
      </div>

      <SubjectModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSave={onSave}
        initial={editing ?? undefined}
        key={editing?.id ?? 'new'}
        grades={grades.map((g) => g.id)}
        colors={SUBJECT_COLORS}
        dailyLessons={dailyLessons}
        nameRef={nameRef}
      />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Silme Onayı">
        <p>“{confirmDelete?.name}” dersini silmek istediğinize emin misiniz?</p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-outline" onClick={() => setConfirmDelete(null)}>İptal</button>
          <button className="btn btn-danger" onClick={onDelete}>Sil</button>
        </div>
      </Modal>
    </>
  )
}

function toInt(v: string): number {
  const n = parseInt(v || '0', 10)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function clampStr(v: string, min: number, max: number): string {
  const n = parseInt(v || String(min), 10)
  if (!Number.isFinite(n)) return String(min)
  return String(Math.max(min, Math.min(max, Math.floor(n))))
}

function SubjectModal({
  open,
  onClose,
  onSave,
  initial,
  grades,
  nameRef,
  colors,
  dailyLessons,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: FormState) => void
  initial?: Subject
  grades: string[]
  nameRef: React.RefObject<HTMLInputElement | null>
  colors: string[]
  dailyLessons: number
}) {
  const buildState = (init?: Subject): FormState => ({
    name: init?.name ?? '',
    weeklyHoursByGrade: Object.fromEntries(grades.map((g) => [g, String(init?.weeklyHoursByGrade[g] ?? 0)])),
    enabledByGrade: Object.fromEntries(grades.map((g) => [g, (init?.weeklyHoursByGrade[g] ?? 0) > 0])),
    perDayMax: init?.rule?.perDayMax ? String(init.rule.perDayMax) : '0',
    maxConsecutive: init?.rule?.maxConsecutive ? String(init.rule.maxConsecutive) : '0',
    minDays: init?.rule?.minDays ? String(init.rule.minDays) : '0',
    color: init?.color ?? '#93c5fd',
  })

  const [state, setState] = useState<FormState>(() => buildState(initial))

  const [errors, setErrors] = useState<Record<string, string>>({})

  const perDayMaxLimit = Math.max(1, dailyLessons || 1)
  const maxConsecutiveLimit = Math.max(2, dailyLessons || 2)
  const minDaysLimit = 5

  const sanitizeDigits = (value: string) => value.replace(/[^0-9]/g, '')

  const setPerDayValue = (updater: (current: number) => number) => {
    setState((s) => {
      const base = s.perDayMax === '0' ? 1 : parseInt(s.perDayMax, 10)
      const current = Number.isFinite(base) && base > 0 ? base : 1
      const next = Math.max(1, Math.min(perDayMaxLimit, updater(current)))
      return { ...s, perDayMax: String(next) }
    })
  }

  const setMaxConsecutiveValue = (updater: (current: number) => number) => {
    setState((s) => {
      const base = s.maxConsecutive === '0' ? 2 : parseInt(s.maxConsecutive, 10)
      const current = Number.isFinite(base) && base > 0 ? base : 2
      const next = Math.max(2, Math.min(maxConsecutiveLimit, updater(current)))
      return { ...s, maxConsecutive: String(next) }
    })
  }

  const setMinDaysValue = (updater: (current: number) => number) => {
    setState((s) => {
      const base = s.minDays === '0' ? 1 : parseInt(s.minDays, 10)
      const current = Number.isFinite(base) && base > 0 ? base : 1
      const next = Math.max(1, Math.min(minDaysLimit, updater(current)))
      return { ...s, minDays: String(next) }
    })
  }

  const stepPerDay = (delta: number) => setPerDayValue((value) => value + delta)
  const stepMaxConsecutive = (delta: number) => setMaxConsecutiveValue((value) => value + delta)
  const stepMinDays = (delta: number) => setMinDaysValue((value) => value + delta)

  const handlePerDayInput = (raw: string) => {
    const digits = sanitizeDigits(raw)
    setState((s) => ({
      ...s,
      perDayMax: digits ? clampStr(digits, 1, perDayMaxLimit) : '1',
    }))
  }

  const handleMaxConsecutiveInput = (raw: string) => {
    const digits = sanitizeDigits(raw)
    setState((s) => ({
      ...s,
      maxConsecutive: digits ? clampStr(digits, 2, maxConsecutiveLimit) : '2',
    }))
  }

  const handleMinDaysInput = (raw: string) => {
    const digits = sanitizeDigits(raw)
    setState((s) => ({
      ...s,
      minDays: digits ? clampStr(digits, 1, minDaysLimit) : '1',
    }))
  }

  const isPerDayLimited = state.perDayMax !== '0'
  const isMaxConsecutiveLimited = state.maxConsecutive !== '0'
  const isMinDaysLimited = state.minDays !== '0'

  // Reset when opening with different initial
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

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!state.name || state.name.trim().length < 2) errs.name = 'Ad en az 2 karakter olmalı'
    for (const g of grades) {
      const v = state.weeklyHoursByGrade[g] ?? ''
      if (state.enabledByGrade[g]) {
        if (!/^\d+$/.test(v) || parseInt(v, 10) < 1) errs[`wh_${g}`] = 'En az 1 saat'
      }
    }
    if (state.perDayMax !== '' && (!/^\d+$/.test(state.perDayMax) || parseInt(state.perDayMax, 10) < 0)) {
      errs.perDayMax = '0 veya daha büyük bir sayı'
    }
    if (state.maxConsecutive !== '' && (!/^\d+$/.test(state.maxConsecutive) || parseInt(state.maxConsecutive, 10) < 0)) {
      errs.maxConsecutive = '0 veya daha büyük bir sayı'
    }
    if (state.minDays !== '' && (!/^\d+$/.test(state.minDays) || parseInt(state.minDays, 10) < 0)) {
      errs.minDays = '0 veya daha büyük bir sayı'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) {
      pushToast({ kind: 'error', text: 'Lütfen hatalı alanları düzeltin' })
      return
    }
    onSave(state)
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Dersi Düzenle' : 'Ders Ekle'} initialFocusRef={nameRef as React.RefObject<HTMLElement | null>}>
      <form onSubmit={submit} className="form-grid" noValidate>
        <label className="field">
          <span className="field-label">Ders Adı</span>
          <input
            ref={nameRef}
            className={`input ${errors.name ? 'field-error' : ''}`}
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'err-name' : undefined}
            placeholder="örn. Matematik"
          />
          {errors.name && <span id="err-name" className="error-text">{errors.name}</span>}
        </label>

        <div className="field">
          <span className="field-label">Renk</span>
          <div className="color-palette">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${state.color === c ? 'selected' : ''}`}
                style={{ background: c }}
                aria-label={`Renk ${c}`}
                onClick={() => setState((s) => ({ ...s, color: c }))}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Haftalık Saatler</span>
          <div className="hours-grid">
            {grades.map((g) => (
              <label key={g} className="hours-item">
                <span className="muted">{g}. Sınıf</span>
                <div className="segmented" role="group" aria-label={`${g}. sınıf durumu`}>
                  <button
                    type="button"
                    className={`seg ${!state.enabledByGrade[g] ? 'active blocked' : ''}`}
                    aria-pressed={!state.enabledByGrade[g]}
                    onClick={() => setState((s) => ({ ...s, enabledByGrade: { ...s.enabledByGrade, [g]: false } }))}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Yok
                  </button>
                  <button
                    type="button"
                    className={`seg ${state.enabledByGrade[g] ? 'active free' : ''}`}
                    aria-pressed={state.enabledByGrade[g]}
                    onClick={() => setState((s) => ({
                      ...s,
                      enabledByGrade: { ...s.enabledByGrade, [g]: true },
                      weeklyHoursByGrade: { ...s.weeklyHoursByGrade, [g]: String(Math.max(1, parseInt(s.weeklyHoursByGrade[g] || '1', 10) || 1)) }
                    }))}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Var
                  </button>
                </div>
                {state.enabledByGrade[g] && (
                  <>
                    <label className="field-label">Ders Saati Sayısı</label>
                    <div className="number-stepper">
                      <button type="button" aria-label="Azalt" onClick={() => setState((s) => ({
                        ...s,
                        weeklyHoursByGrade: { ...s.weeklyHoursByGrade, [g]: String(Math.max(1, (parseInt(s.weeklyHoursByGrade[g] || '1', 10) || 1) - 1)) }
                      }))}>−</button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className={`input ${errors[`wh_${g}`] ? 'field-error' : ''}`}
                        value={state.weeklyHoursByGrade[g]}
                        onChange={(e) => setState((s) => ({
                          ...s,
                          weeklyHoursByGrade: { ...s.weeklyHoursByGrade, [g]: e.target.value.replace(/[^0-9]/g, '') }
                        }))}
                        aria-invalid={!!errors[`wh_${g}`]}
                        aria-describedby={errors[`wh_${g}`] ? `err-wh-${g}` : undefined}
                      />
                      <button type="button" aria-label="Arttır" onClick={() => setState((s) => ({
                        ...s,
                        weeklyHoursByGrade: { ...s.weeklyHoursByGrade, [g]: String(Math.max(1, (parseInt(s.weeklyHoursByGrade[g] || '1', 10) || 1) + 1)) }
                      }))}>+</button>
                    </div>
                    {errors[`wh_${g}`] && <span id={`err-wh-${g}`} className="error-text">{errors[`wh_${g}`]}</span>}
                  </>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="field-row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <span className="field-label">Günlük üst sınır</span>
            <div className="help-text" style={{ marginTop: 4 }}><strong>Bilgi:</strong> Açıkken bu dersten gün içinde en fazla kaç saat olabileceğini belirler. Kapalıysa sınırsız.</div>
            <div className="segmented" role="group" aria-label="Günlük üst sınır modu">
              <button type="button" className={"seg " + (!isPerDayLimited ? 'active blocked' : '')} aria-pressed={!isPerDayLimited} onClick={() => setState((s) => ({ ...s, perDayMax: '0' }))}>Kapalı</button>
              <button type="button" className={"seg " + (isPerDayLimited ? 'active free' : '')} aria-pressed={isPerDayLimited} onClick={() => { if (!isPerDayLimited) setPerDayValue((value) => value) }}>Açık</button>
            </div>
            {isPerDayLimited && (
              <>
                <div className="number-stepper">
                  <button type="button" aria-label="Azalt" onClick={() => stepPerDay(-1)}>-</button>
                  <input
                    className={"input" + (errors.perDayMax ? ' field-error' : '')}
                    inputMode="numeric"
                    placeholder="Sınırsız için Kapalı seçin"
                    value={state.perDayMax}
                    onChange={(e) => handlePerDayInput(e.target.value)}
                    onBlur={() => setPerDayValue((value) => value)}
                    aria-invalid={!!errors.perDayMax}
                    aria-describedby={errors.perDayMax ? 'err-pdm' : undefined}
                  />
                  <button type="button" aria-label="Arttır" onClick={() => stepPerDay(1)}>+</button>
                </div>
                {errors.perDayMax && <span id="err-pdm" className="error-text">{errors.perDayMax}</span>}
              </>
            )}
          </div>

          {/* Senkron alanı kaldırıldı */}
        </div>

        <div className="field-row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <span className="field-label">Üst üste ders limiti</span>
            <div className="help-text" style={{ marginTop: 4 }}><strong>Bilgi:</strong> Açıkken bu dersten art arda en fazla kaç saat olabilir.</div>
            <div className="segmented" role="group" aria-label="Üst üste ders limiti modu">
              <button type="button" className={"seg " + (!isMaxConsecutiveLimited ? 'active blocked' : '')} aria-pressed={!isMaxConsecutiveLimited} onClick={() => setState((s) => ({ ...s, maxConsecutive: '0' }))}>Kapalı</button>
              <button type="button" className={"seg " + (isMaxConsecutiveLimited ? 'active free' : '')} aria-pressed={isMaxConsecutiveLimited} onClick={() => { if (!isMaxConsecutiveLimited) setMaxConsecutiveValue((value) => value) }}>Açık</button>
            </div>
            {isMaxConsecutiveLimited && (
              <>
                <label className="field-label">Üst üste en fazla</label>
                <div className="number-stepper">
                  <button type="button" aria-label="Azalt" onClick={() => stepMaxConsecutive(-1)}>-</button>
                  <input
                    className={"input" + (errors.maxConsecutive ? ' field-error' : '')}
                    inputMode="numeric"
                    value={state.maxConsecutive}
                    onChange={(e) => handleMaxConsecutiveInput(e.target.value)}
                    onBlur={() => setMaxConsecutiveValue((value) => value)}
                    aria-invalid={!!errors.maxConsecutive}
                    aria-describedby={errors.maxConsecutive ? 'err-mc' : undefined}
                  />
                  <button type="button" aria-label="Arttır" onClick={() => stepMaxConsecutive(1)}>+</button>
                </div>
                {errors.maxConsecutive && <span id="err-mc" className="error-text">{errors.maxConsecutive}</span>}
              </>
            )}
          </div>
        </div>

        <div className="field-row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <span className="field-label">Haftada en az gün</span>
            <div className="help-text" style={{ marginTop: 4 }}><strong>Bilgi:</strong> Açıkken haftalık saatler en az bu kadar farklı güne dağılır.</div>
            <div className="segmented" role="group" aria-label="Haftada en az gün modu">
              <button type="button" className={"seg " + (!isMinDaysLimited ? 'active blocked' : '')} aria-pressed={!isMinDaysLimited} onClick={() => setState((s) => ({ ...s, minDays: '0' }))}>Kapalı</button>
              <button type="button" className={"seg " + (isMinDaysLimited ? 'active free' : '')} aria-pressed={isMinDaysLimited} onClick={() => { if (!isMinDaysLimited) setMinDaysValue((value) => value) }}>Açık</button>
            </div>
            {isMinDaysLimited && (
              <>
                <label className="field-label">En az kaç güne yayılmalı</label>
                <div className="number-stepper">
                  <button type="button" aria-label="Azalt" onClick={() => stepMinDays(-1)}>-</button>
                  <input
                    className={"input" + (errors.minDays ? ' field-error' : '')}
                    inputMode="numeric"
                    value={state.minDays}
                    onChange={(e) => handleMinDaysInput(e.target.value)}
                    onBlur={() => setMinDaysValue((value) => value)}
                    aria-invalid={!!errors.minDays}
                    aria-describedby={errors.minDays ? 'err-md' : undefined}
                  />
                  <button type="button" aria-label="Arttır" onClick={() => stepMinDays(1)}>+</button>
                </div>
                {errors.minDays && <span id="err-md" className="error-text">{errors.minDays}</span>}
              </>
            )}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>İptal</button>
          <button type="submit" className="btn btn-primary">Kaydet</button>
        </div>
      </form>
    </Modal>
  )
}
