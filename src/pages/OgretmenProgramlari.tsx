import { useMemo, useState } from 'react'
import { useSchool } from '../shared/useSchool'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day, Teacher } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'
import { calculateTeacherSchedules, formatClassName, formatTimeSlot, getSubjectAbbreviation } from '../shared/pdfUtils'
import { generateTeacherHandbookHTML, generateTeacherSheetHTML } from '../shared/htmlPdfGenerator'
import LockIcon from '../components/LockIcon'

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

type Cell = { subjectId?: string; teacherId?: string }

function UtilizationBar({ pct, available, actual }: { pct: number; available: number; actual: number }) {
  const color = pct >= 0.95 ? '#ef4444' : pct >= 0.80 ? '#f97316' : pct >= 0.60 ? '#eab308' : '#22c55e'
  const label = pct >= 0.95 ? 'Kritik' : pct >= 0.80 ? 'Yoğun' : pct >= 0.60 ? 'Orta' : 'Rahat'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {/* Mini bar */}
      <div style={{ width: 52, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.07)', flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'monospace', flexShrink: 0 }}>
        {Math.round(pct * 100)}%
      </span>
      <span style={{ fontSize: 10, color: '#475569', flexShrink: 0 }}>
        {actual}/{available}s · {label}
      </span>
    </div>
  )
}

export default function OgretmenProgramlari() {
  const school = useSchool()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const slotTimes = useMemo(() => slots.map((_, i) => formatTimeSlot(i, school)), [slots, school])

  const [tables] = useLocalStorage<Record<string, Record<Day, Cell[]>>>('timetables', {})
  const [lockedTeachers, setLockedTeachers] = useLocalStorage<string[]>('lockedTeachers', [])

  const isLocked = (id: string) => lockedTeachers.includes(id)
  const toggleLock = (id: string) => setLockedTeachers(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const clearAllLocks = () => setLockedTeachers([])

  const teacherSchedules = useMemo(
    () => calculateTeacherSchedules(tables, teachers, subjects, slots),
    [tables, teachers, subjects, slots]
  )

  const hasTables = Object.keys(tables).length > 0
  const lockedCount = lockedTeachers.filter(id => teachers.some(t => t.id === id)).length

  // Öğretmen başına yoğunluk hesapla: fiili saat / müsait saat
  const computeUtilization = (teacher: Teacher, totalHours: number) => {
    const totalSlots = DAYS.length * slots.length
    const unavailableCount = DAYS.reduce((sum, d) => sum + (teacher.unavailable?.[d]?.length ?? 0), 0)
    const available = Math.max(1, totalSlots - unavailableCount)
    const pct = totalHours / available
    return { available, actual: totalHours, pct }
  }

  // Öğretmenleri yoğunluğa göre sırala (en yüksek → en düşük) — varsayılan sıra
  const sortedTeachers = useMemo(() => {
    if (!hasTables) return teachers
    return [...teachers].sort((a, b) => {
      const aHours = Object.values(teacherSchedules[a.id] ?? {}).reduce(
        (s, day) => s + (day ?? []).filter(c => c?.classKey).length, 0)
      const bHours = Object.values(teacherSchedules[b.id] ?? {}).reduce(
        (s, day) => s + (day ?? []).filter(c => c?.classKey).length, 0)
      const aU = aHours / Math.max(1, DAYS.length * slots.length - DAYS.reduce((s, d) => s + (a.unavailable?.[d]?.length ?? 0), 0))
      const bU = bHours / Math.max(1, DAYS.length * slots.length - DAYS.reduce((s, d) => s + (b.unavailable?.[d]?.length ?? 0), 0))
      return bU - aU
    })
  }, [teachers, teacherSchedules, hasTables, slots])

  // Öğretmen isimleri uzun ve listesi kalabalık olabildiğinden, sıralamayı
  // sürükle-bırak + arama + hızlı toplu sıralama (Yoğunluk/A-Z/Z-A) ile
  // yönetilen ayrı bir panelde tutuyoruz — tarayıcıda kalıcı.
  const azTeachers = useMemo(
    () => [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [teachers]
  )
  const [teacherOrder, setTeacherOrder] = useLocalStorage<string[]>('opTeacherOrder', [])
  const orderedTeachers = useMemo(() => {
    if (!teacherOrder.length) return sortedTeachers
    const byId = new Map(teachers.map(t => [t.id, t]))
    const ordered = teacherOrder.map(id => byId.get(id)).filter((t): t is Teacher => !!t)
    const seen = new Set(ordered.map(t => t.id))
    const rest = sortedTeachers.filter(t => !seen.has(t.id))
    return [...ordered, ...rest]
  }, [teachers, teacherOrder, sortedTeachers])

  const [showTeacherReorder, setShowTeacherReorder] = useState(false)
  const [teacherSearch, setTeacherSearch] = useState('')
  const [dragTeacherId, setDragTeacherId] = useState<string | null>(null)
  const [dragOverTeacherId, setDragOverTeacherId] = useState<string | null>(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null)

  const filteredOrderedTeachers = useMemo(() => {
    if (!teacherSearch.trim()) return orderedTeachers
    const q = teacherSearch.toLocaleLowerCase('tr-TR')
    return orderedTeachers.filter(t => t.name.toLocaleLowerCase('tr-TR').includes(q))
  }, [orderedTeachers, teacherSearch])

  const applyTeacherSort = (mode: 'utilization' | 'az' | 'za') => {
    const list = mode === 'utilization' ? sortedTeachers : mode === 'az' ? azTeachers : [...azTeachers].reverse()
    setTeacherOrder(list.map(t => t.id))
  }
  const moveTeacher = (id: string, dir: -1 | 1) => {
    const base = orderedTeachers.map(t => t.id)
    const idx = base.indexOf(id)
    if (idx === -1) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= base.length) return
    const next = [...base]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    setTeacherOrder(next)
  }
  const moveTeacherToEdge = (id: string, edge: 'start' | 'end') => {
    const base = orderedTeachers.map(t => t.id)
    const idx = base.indexOf(id)
    if (idx === -1) return
    const next = [...base]
    next.splice(idx, 1)
    if (edge === 'start') next.unshift(id)
    else next.push(id)
    setTeacherOrder(next)
  }
  const reorderTeachers = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const base = orderedTeachers.map(t => t.id)
    const from = base.indexOf(sourceId)
    const to = base.indexOf(targetId)
    if (from === -1 || to === -1) return
    const next = [...base]
    next.splice(from, 1)
    next.splice(to, 0, sourceId)
    setTeacherOrder(next)
  }
  const resetTeacherOrder = () => { setTeacherOrder([]); setSelectedTeacherId(null) }

  const handlePrintHandbooks = () => {
    const allHTML = orderedTeachers
      .filter(t => teacherSchedules[t.id])
      .map(t => generateTeacherHandbookHTML(t, teacherSchedules[t.id], subjects,
        school.schoolName || 'Hasyurt Ortaokulu', school.principalName, slotTimes))
      .join('<div style="page-break-after: always;"></div>')
    if (!allHTML) { alert('Ders programı bulunamadı.'); return }
    const w = window.open('', '_blank')
    if (!w) { alert('Pop-up engelleyici aktif.'); return }
    w.document.title = school.schoolName || 'Öğretmen EL'
    w.document.write(allHTML)
    w.document.close()
    requestAnimationFrame(() => setTimeout(() => w.print(), 200))
  }

  const handlePrintSheet = () => {
    const html = generateTeacherSheetHTML(teacherSchedules, orderedTeachers, subjects, school.schoolName || 'Hasyurt Ortaokulu', slots)
    if (!html) { alert('Ders programı bulunamadı.'); return }
    const w = window.open('', '_blank')
    if (!w) { alert('Pop-up engelleyici aktif.'); return }
    w.document.title = school.schoolName || 'Öğretmen Çarşaf'
    w.document.write(html)
    w.document.close()
    w.onload = () => setTimeout(() => w.print(), 500)
  }

  return (
    <>
      <div className="topbar glass p-6" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div className="brand">
          <div className="title">Öğretmen Programları</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-outline btn-sm class-order-toggle${showTeacherReorder ? ' active' : ''}`}
            type="button"
            onClick={() => setShowTeacherReorder(v => !v)}
            title="Öğretmenlerin gösterim sırasını değiştir"
          >
            ⠿ Öğretmenleri Sırala
          </button>
          {lockedCount > 0 && (
            <button
              onClick={clearAllLocks}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1.5px solid rgba(239,68,68,0.4)',
                background: 'rgba(239,68,68,0.1)',
                color: '#fca5a5', fontSize: 13, fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
              title="Tüm öğretmen kilitlerini kaldır"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
              </svg>
              Tüm Kilitleri Kaldır ({lockedCount})
            </button>
          )}
          <button className="btn btn-outline" onClick={handlePrintHandbooks} disabled={!hasTables}>📄 Öğretmen El PDF</button>
          <button className="btn btn-outline" onClick={handlePrintSheet} disabled={!hasTables}>📊 Öğretmen Çarşaf PDF</button>
        </div>
      </div>

      {showTeacherReorder && (
        <div className="glass class-order-panel" style={{ margin: '0 0 16px' }}>
          <div className="class-order-head">
            <div>
              <span className="class-order-title">Öğretmen Sırası</span>
              <span className="class-order-hint">
                {selectedTeacherId
                  ? `${teachers.find(t => t.id === selectedTeacherId)?.name ?? ''} seçili — aşağıdan taşı`
                  : 'ara, sürükle veya bir öğretmene dokunup taşı'}
              </span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button" className="btn btn-outline btn-sm"
                disabled={!selectedTeacherId} onClick={() => selectedTeacherId && moveTeacherToEdge(selectedTeacherId, 'start')}
              >⇤ Başa Al</button>
              <button
                type="button" className="btn btn-outline btn-sm"
                disabled={!selectedTeacherId} onClick={() => selectedTeacherId && moveTeacherToEdge(selectedTeacherId, 'end')}
              >Sona Al ⇥</button>
              {teacherOrder.length > 0 && (
                <button type="button" className="class-order-reset" onClick={resetTeacherOrder}>
                  Varsayılana Dön
                </button>
              )}
            </div>
          </div>

          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="teacher-order-search"
              placeholder="🔍 Öğretmen ara..."
              value={teacherSearch}
              onChange={(e) => setTeacherSearch(e.target.value)}
            />
            <div className="segmented seg-xs" role="group" aria-label="Hızlı sıralama">
              <button type="button" className="seg" onClick={() => applyTeacherSort('utilization')} title="Yoğunluğa göre sırala">Yoğunluk</button>
              <button type="button" className="seg" onClick={() => applyTeacherSort('az')} title="İsme göre A-Z sırala">A–Z</button>
              <button type="button" className="seg" onClick={() => applyTeacherSort('za')} title="İsme göre Z-A sırala">Z–A</button>
            </div>
          </div>

          <div className="teacher-order-list">
            {filteredOrderedTeachers.length === 0 && (
              <div className="teacher-order-empty">"{teacherSearch}" ile eşleşen öğretmen yok</div>
            )}
            {filteredOrderedTeachers.map((t) => {
              const globalIdx = orderedTeachers.findIndex(x => x.id === t.id)
              return (
                <div
                  key={t.id}
                  className={`teacher-order-row${dragTeacherId === t.id ? ' dragging' : ''}${dragOverTeacherId === t.id && dragTeacherId !== t.id ? ' drag-over' : ''}${selectedTeacherId === t.id ? ' selected' : ''}`}
                  draggable
                  onClick={() => setSelectedTeacherId(k => k === t.id ? null : t.id)}
                  onDragStart={() => setDragTeacherId(t.id)}
                  onDragEnd={() => { setDragTeacherId(null); setDragOverTeacherId(null) }}
                  onDragOver={(e) => { e.preventDefault(); if (dragTeacherId && dragTeacherId !== t.id) setDragOverTeacherId(t.id) }}
                  onDragLeave={() => setDragOverTeacherId((k) => (k === t.id ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragTeacherId) reorderTeachers(dragTeacherId, t.id)
                    setDragTeacherId(null)
                    setDragOverTeacherId(null)
                  }}
                >
                  <span className="teacher-order-handle">⠿</span>
                  <span className="teacher-order-pos">{globalIdx + 1}</span>
                  <span className="teacher-order-name" title={t.name}>{t.name}</span>
                  <span className="teacher-order-arrows">
                    <button
                      type="button" className="class-order-arrow"
                      onClick={(e) => { e.stopPropagation(); moveTeacher(t.id, -1) }} disabled={globalIdx === 0} title="Yukarı taşı"
                    >▲</button>
                    <button
                      type="button" className="class-order-arrow"
                      onClick={(e) => { e.stopPropagation(); moveTeacher(t.id, 1) }} disabled={globalIdx === orderedTeachers.length - 1} title="Aşağı taşı"
                    >▼</button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Kilitleme bilgi bandı */}
      {lockedCount > 0 && (
        <div style={{
          margin: '12px 0',
          padding: '12px 18px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,191,36,0.07))',
          border: '1px solid rgba(245,158,11,0.35)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, color: '#f59e0b', fontSize: 14 }}>
              {lockedCount} öğretmen programı kilitli
            </div>
            <div style={{ fontSize: 12, color: '#d97706', marginTop: 2 }}>
              Yeni program oluşturulurken bu öğretmenlerin sınıf-ders atamaları korunur; saatler optimize için hafif kayabilir.
            </div>
          </div>
        </div>
      )}

      {/* Yoğunluk rehberi */}
      {hasTables && (
        <div style={{
          margin: '0 0 12px', padding: '10px 16px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, flexShrink: 0 }}>YOĞUNLUK:</span>
          {[
            { color: '#22c55e', label: 'Rahat < 60%' },
            { color: '#eab308', label: 'Orta 60-80%' },
            { color: '#f97316', label: 'Yoğun 80-95%' },
            { color: '#ef4444', label: 'Kritik ≥ 95%' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
            </div>
          ))}
          <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
            Önce kritik olanları kilitleyin → programları yeniden oluşturun
          </span>
        </div>
      )}

      {!hasTables ? (
        <div className="glass p-6" style={{ marginBottom: 16 }}>
          <div className="muted">
            Henüz oluşturulmuş bir ders programı yok. Önce "Ders Programları" sayfasından programları oluşturun.
          </div>
        </div>
      ) : (
        <div className="timetable-sections">
          {orderedTeachers.map((teacher) => {
            const schedule = teacherSchedules[teacher.id]
            if (!schedule) return null

            const locked = isLocked(teacher.id)

            let totalHours = 0
            DAYS.forEach(day => {
              schedule[day]?.forEach(cell => { if (cell.classKey) totalHours++ })
            })

            const util = computeUtilization(teacher, totalHours)

            return (
              <div key={teacher.id} className="grade-section">
                <div className="grid-timetables">
                  <div
                    className="timetable glass"
                    style={locked ? {
                      borderColor: 'rgba(245,158,11,0.4)',
                      boxShadow: '0 0 0 1px rgba(245,158,11,0.25), 0 8px 32px rgba(0,0,0,0.18)',
                    } : undefined}
                  >
                    <div className="timetable-head">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="title" style={{ margin: 0 }}>{teacher.name}</div>
                          {locked && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                              textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99,
                              background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
                              border: '1px solid rgba(245,158,11,0.4)', flexShrink: 0,
                            }}>Kilitli</span>
                          )}
                        </div>
                        <UtilizationBar pct={util.pct} available={util.available} actual={util.actual} />
                      </div>
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        <button
                          onClick={() => toggleLock(teacher.id)}
                          title={locked
                            ? 'Kilidi aç — program yeniden oluşturulabilir'
                            : 'Programı kilitle — yeni oluşturmada bu program korunur'}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 13px', borderRadius: 8, outline: 'none',
                            border: locked ? '1.5px solid rgba(245,158,11,0.7)' : '1.5px solid rgba(255,255,255,0.1)',
                            background: locked
                              ? 'linear-gradient(135deg, rgba(245,158,11,0.22), rgba(251,191,36,0.1))'
                              : 'rgba(255,255,255,0.04)',
                            color: locked ? '#f59e0b' : 'rgba(255,255,255,0.38)',
                            cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            transition: 'all 0.18s ease',
                            animation: locked ? 'lockPop 0.3s ease' : undefined,
                          }}
                        >
                          <LockIcon locked={locked} />
                          {locked ? 'Kilitli' : 'Kilitle'}
                        </button>
                        <div className="tt-status" aria-label="Toplam Ders">
                          {totalHours} Saat
                        </div>
                      </div>
                    </div>

                    <div className="timetable-body">
                      <table className="tt">
                        <thead>
                          <tr>
                            <th>Gün</th>
                            {slots.map((s) => <th key={s}>{s}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {DAYS.map((d) => (
                            <tr key={d}>
                              <td className="day">{d}</td>
                              {slots.map((_, si) => {
                                const cell = schedule[d]?.[si]
                                if (!cell?.classKey) {
                                  return (
                                    <td key={teacher.id + d + si} className="slot">
                                      <span className="muted">—</span>
                                    </td>
                                  )
                                }
                                const subject = subjects.find(s => s.id === cell.subjectId)
                                const abbr = getSubjectAbbreviation(cell.subjectName, subject?.abbreviation || cell.subjectAbbreviation)
                                return (
                                  <td key={teacher.id + d + si} className="slot">
                                    <div className="slot-pill" title={`${cell.className} — ${cell.subjectName}`}>
                                      <span className="dot" style={{ background: subject?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{formatClassName(cell.classKey)}</span>
                                      <span className="s-teacher">{abbr}</span>
                                    </div>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Mobile accordion */}
                      <div className="tt-accordion">
                        {DAYS.map((d) => (
                          <details key={d} className="tt-acc-day">
                            <summary className="tt-acc-summary">{d}</summary>
                            <div className="tt-acc-slots">
                              {slots.map((_, si) => {
                                const cell = schedule[d]?.[si]
                                const subject = subjects.find(s => s.id === cell?.subjectId)
                                const abbr = cell ? getSubjectAbbreviation(cell.subjectName, subject?.abbreviation || cell.subjectAbbreviation) : ''
                                return (
                                  <div key={teacher.id + d + 'a' + si} className="acc-slot">
                                    <div className="acc-slot-left">S{si + 1}</div>
                                    {cell?.classKey ? (
                                      <div className="acc-slot-main">
                                        <span className="dot" style={{ background: subject?.color ?? '#93c5fd' }} />
                                        <span className="s-name">{formatClassName(cell.classKey)}</span>
                                        <span className="s-teacher">{abbr}</span>
                                      </div>
                                    ) : (
                                      <div className="acc-slot-empty muted">—</div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
