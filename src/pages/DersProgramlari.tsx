import { useMemo, useState } from 'react'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day, Teacher } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

type Cell = { subjectId?: string; teacherId?: string }
type ClassKey = string // e.g. "5-A"

export default function DersProgramlari() {
  const school = useSchool()
  const gradeOptions = useGrades()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const classes = useMemo(() => buildClasses(school), [school])

  const [tables, setTables] = useLocalStorage<Record<ClassKey, Record<Day, Cell[]>>>('timetables', {})
  const [gradeFilter, setGradeFilter] = useState<string>('all')

  const generate = () => {
    const result: Record<ClassKey, Record<Day, Cell[]>> = {}
    const teacherLoad = new Map<string, number>()

    for (const c of classes) {
      const gradeId = c.grade
      const demand = buildDemand(subjects, gradeId)
      const table: Record<Day, Cell[]> = Object.fromEntries(DAYS.map(d => [d, Array.from({ length: slots.length }, () => ({}) as Cell)])) as any

      // Fill day by day, slot by slot with randomized demand
      const pool = shuffle(demand)
      for (const day of DAYS) {
        let perDayCount: Record<string, number> = {}
        for (let si = 0; si < slots.length; si++) {
          // pick next subject that still has remaining and respects perDayMax, consecutive limits and has an available teacher
          let pickedIndex = -1
          let pickedTeacher: string | undefined
          for (let i = 0; i < pool.length; i++) {
            const subjId = pool[i]
            if (!subjId) continue
            const rule = subjects.find(s => s.id === subjId)?.rule
            const perDayMax = rule?.perDayMax ?? 0
            if (perDayMax > 0 && (perDayCount[subjId] ?? 0) >= perDayMax) continue
            // avoid long consecutive
            const maxConsec = rule?.maxConsecutive ?? 0
            if (maxConsec > 0) {
              const prev = table[day][si - 1]?.subjectId
              const prev2 = table[day][si - 2]?.subjectId
              const prev3 = table[day][si - 3]?.subjectId
              const consec = [prev, prev2, prev3].reduce((acc, v) => (v === subjId ? acc + 1 : acc), 0)
              if (consec >= maxConsec) continue
            }
            const teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false })
            if (!teacherId) continue
            pickedIndex = i
            pickedTeacher = teacherId
            break
          }
          if (pickedIndex === -1 || !pickedTeacher) continue
          const subjId = pool.splice(pickedIndex, 1)[0]

          table[day][si] = { subjectId: subjId, teacherId: pickedTeacher }
          perDayCount[subjId] = (perDayCount[subjId] ?? 0) + 1
          teacherLoad.set(pickedTeacher, (teacherLoad.get(pickedTeacher) ?? 0) + 1)
        }
      }
      result[c.key] = table
    }
    setTables(result)
  }

  const classesToShow = useMemo(() => classes.filter(c => gradeFilter === 'all' ? true : c.grade === gradeFilter), [classes, gradeFilter])
  const grouped = useMemo(() => {
    const map = new Map<string, typeof classes>()
    for (const c of classesToShow) {
      if (!map.has(c.grade)) map.set(c.grade, [])
      map.get(c.grade)!.push(c)
    }
    return Array.from(map.entries()).sort((a,b) => Number(a[0]) - Number(b[0]))
  }, [classesToShow])

  return (
    <>
      <div className="topbar glass p-6" style={{ justifyContent: 'space-between', gap: 12 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">Sınıf Filtresi</span>
          <select className="select" value={gradeFilter} onChange={(e)=> setGradeFilter(e.target.value)}>
            <option value="all">Hepsi</option>
            {gradeOptions.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={generate}>Programları Oluştur</button>
      </div>

      <div className="timetable-sections">
        {grouped.map(([gradeId, list]) => (
          <div key={gradeId} className="grade-section">
            <div className="grid-timetables">
              {list.map((c) => (
                <div key={c.key} className="timetable glass">
                  <div className="timetable-head">
                    <div className="title">{c.grade}. Sınıf — {c.section}</div>
                    {tables[c.key] && <div className="tt-status" aria-label="Oluşturuldu">Oluşturuldu</div>}
                  </div>
                  <div className="timetable-body">
                    <table className="tt">
                      <thead>
                        <tr>
                          <th>Gün</th>
                          {slots.map((s) => (
                            <th key={s}>{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map((d) => (
                          <tr key={d}>
                            <td className="day">{d}</td>
                            {slots.map((_, si) => {
                              const cell = tables[c.key]?.[d]?.[si]
                              const subj = subjects.find(s => s.id === cell?.subjectId)
                              const teacher = teachers.find(t => t.id === cell?.teacherId)
                              return (
                                <td key={c.key + d + si} className="slot">
                                  {cell?.subjectId ? (
                                    <div className="slot-pill" title={`${subj?.name} — ${teacher ? teacher.name : 'Atanmadı'}`}>
                                      <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{subj?.name}</span>
                                      <span className="s-teacher">{teacher ? teacher.name : '—'}</span>
                                    </div>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile-friendly accordion per day */}
                    <div className="tt-accordion">
                      {DAYS.map((d) => (
                        <details key={d} className="tt-acc-day">
                          <summary className="tt-acc-summary">{d}</summary>
                          <div className="tt-acc-slots">
                            {slots.map((_, si) => {
                              const cell = tables[c.key]?.[d]?.[si]
                              const subj = subjects.find(s => s.id === cell?.subjectId)
                              const teacher = teachers.find(t => t.id === cell?.teacherId)
                              return (
                                <div key={c.key + d + 'a' + si} className="acc-slot">
                                  <div className="acc-slot-left">S{si + 1}</div>
                                  {cell?.subjectId ? (
                                    <div className="acc-slot-main">
                                      <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{subj?.name}</span>
                                      <span className="s-teacher">{teacher ? teacher.name : '—'}</span>
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function buildClasses(school: ReturnType<typeof useSchool>): { key: ClassKey; grade: string; section: string }[] {
  const out: { key: ClassKey; grade: string; section: string }[] = []
  for (const g of school.grades) {
    for (const s of g.sections) out.push({ key: `${g.grade}-${s}`, grade: g.grade, section: s })
  }
  return out
}

function buildDemand(subjects: ReturnType<typeof useSubjects>['subjects'], gradeId: string): string[] {
  const arr: string[] = []
  for (const s of subjects) {
    const n = s.weeklyHoursByGrade[gradeId] ?? 0
    for (let i = 0; i < n; i++) arr.push(s.id)
  }
  return arr
}

function pickTeacher(teachers: Teacher[], load: Map<string, number>, subjectId: string, gradeId: string, day: Day, slotIndex: number, opts?: { commit?: boolean }): string | undefined {
  const commit = opts?.commit ?? true
  const choices = teachers.filter(t => {
    const subs = getTeacherSubjectIds(t)
    if (!subs.includes(subjectId)) return false
    // preferred grades check
    if (t.preferredGrades && t.preferredGrades.length > 0 && !t.preferredGrades.includes(gradeId)) return false
    // availability
    const blocked = t.unavailable?.[day]?.includes(`S${slotIndex + 1}`)
    if (blocked) return false
    // max hours
    const cur = load.get(t.id) ?? 0
    if (t.maxHours && cur >= t.maxHours) return false
    return true
  })
  if (choices.length === 0) return undefined
  const pick = choices[Math.floor(Math.random() * choices.length)]
  if (commit) {
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1)
  }
  return pick.id
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// shortName removed (show full name under subject)

function getTeacherSubjectIds(t: Teacher): string[] {
  if (t.subjectIds && t.subjectIds.length) return t.subjectIds
  if (t.subjectId) return [t.subjectId]
  return []
}
