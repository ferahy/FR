import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day, Teacher } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'
import { generateClassHandbookHTML, generateClassSheetHTML } from '../shared/htmlPdfGenerator'
import { getSubjectAbbreviation, getTeacherAbbreviation } from '../shared/pdfUtils'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

type Cell = { subjectId?: string; teacherId?: string }
type ClassKey = string // e.g. "5-A"

const REQUIRED_HOURS: Record<string, Record<string, number>> = {
  '5': {
    'Türkçe': 6,
    'Matematik': 5,
    'Fen Bilimleri': 4,
    'Fen': 4,
    'Sosyal Bilgiler': 3,
    'Sosyal': 3,
    'İngilizce': 3,
    'Yabancı Dil (İngilizce)': 3,
    'Din': 2,
    'Din Kültürü': 2,
    'Görsel Sanatlar': 1,
    'Müzik': 1,
    'Beden': 2,
    'Beden Eğitimi': 2,
    'Bilişim': 2,
    'Rehberlik': 1,
    'Seçmeli': 5,
  },
  '6': {
    'Türkçe': 6,
    'Matematik': 5,
    'Fen Bilimleri': 4,
    'Fen': 4,
    'Sosyal Bilgiler': 3,
    'Sosyal': 3,
    'İngilizce': 3,
    'Yabancı Dil (İngilizce)': 3,
    'Din': 2,
    'Din Kültürü': 2,
    'Görsel Sanatlar': 1,
    'Müzik': 1,
    'Beden': 2,
    'Beden Eğitimi': 2,
    'Bilişim': 2,
    'Rehberlik': 1,
    'Seçmeli': 5,
  },
  '7': {
    'Türkçe': 5,
    'Matematik': 5,
    'Fen Bilimleri': 4,
    'Fen': 4,
    'Sosyal Bilgiler': 3,
    'Sosyal': 3,
    'İngilizce': 4,
    'Yabancı Dil (İngilizce)': 4,
    'Din': 2,
    'Din Kültürü': 2,
    'Görsel Sanatlar': 1,
    'Müzik': 1,
    'Beden': 2,
    'Beden Eğitimi': 2,
    'Teknoloji ve Tasarım': 2,
    'Rehberlik': 1,
    'Seçmeli': 5,
  },
}

export default function DersProgramlari() {
  const school = useSchool()
  const gradeOptions = useGrades()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const classes = useMemo(() => buildClasses(school), [school])

  const [tables, setTables] = useLocalStorage<Record<ClassKey, Record<Day, Cell[]>>>('timetables', {})
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [showSheet, setShowSheet] = useState(false)
  const [requirementsGrade, setRequirementsGrade] = useState<string | null>(null)

  const handlePrintHandbooks = () => {
    // Generate HTML for all classes and open in new window
    const allHTML = classes
      .filter(c => tables[c.key]) // Only classes with schedules
      .map(c => generateClassHandbookHTML(
        c.key,
        tables[c.key],
        subjects,
        teachers,
        school.schoolName || 'Hasyurt Ortaokulu',
        school.principalName
      ))
      .join('<div style="page-break-after: always;"></div>')

    if (!allHTML) {
      alert('Ders programı bulunamadı. Önce programları oluşturun.')
      return
    }

    const newWindow = window.open('', '_blank')
    if (!newWindow) {
      alert('Pop-up engelleyici aktif. Lütfen bu site için pop-up\'lara izin verin.')
      return
    }

    newWindow.document.write(allHTML)
    newWindow.document.close()

    // Wait for content to load then print
    newWindow.onload = () => {
      setTimeout(() => {
        newWindow.print()
      }, 500)
    }
  }

  const handlePrintSheet = () => {
    // Generate HTML for all classes and open in new window
    const html = generateClassSheetHTML(
      tables,
      subjects,
      teachers,
      classes,
      school.schoolName || 'Hasyurt Ortaokulu',
      slots
    )

    if (!html) {
      alert('Ders programı bulunamadı. Önce programları oluşturun.')
      return
    }

    const newWindow = window.open('', '_blank')
    if (!newWindow) {
      alert('Pop-up engelleyici aktif. Lütfen bu site için pop-up\'lara izin verin.')
      return
    }

    newWindow.document.write(html)
    newWindow.document.close()

    // Wait for content to load then print
    newWindow.onload = () => {
      setTimeout(() => {
        newWindow.print()
      }, 500)
    }
  }

  const generate = () => {
    const result: Record<ClassKey, Record<Day, Cell[]>> = {}
    const teacherLoad = new Map<string, number>()
    const teacherOccupied = new Map<string, Set<string>>() // Track teacher availability: teacherId -> Set of "day-slot" strings

    for (const c of classes) {
      const gradeId = c.grade
      const table: Record<Day, Cell[]> = Object.fromEntries(DAYS.map(d => [d, Array.from({ length: slots.length }, () => ({}) as Cell)])) as any
      const placedDays: Record<string, Set<Day>> = {}
      const classSubjectTeacher: Record<string, string> = {} // Track teacher per subject for this class

      // Build subject demand map
      const subjectDemand: Record<string, number> = {}
      for (const s of subjects) {
        const count = s.weeklyHoursByGrade[gradeId] ?? 0
        if (count > 0) subjectDemand[s.id] = count
      }

      // PHASE 1: Place block subjects STRICTLY as blocks (same day, contiguous)
      for (const [subjId, count] of Object.entries(subjectDemand)) {
        const subject = subjects.find(s => s.id === subjId)
        if (!subject) continue
        if (!shouldBlockSubject(subject, gradeId)) continue

        const blocksNeeded = Math.floor(count / 2)
        const singleNeeded = count % 2

        let blocksPlaced = 0
        // Try to place all blocks for this subject
        for (let di = 0; di < DAYS.length && blocksPlaced < blocksNeeded; di++) {
          const day = DAYS[di]
          let perDayCount = 0

          for (let si = 0; si < slots.length - 1 && blocksPlaced < blocksNeeded; si++) {
            // Check if both slots are free
            if (table[day][si]?.subjectId || table[day][si + 1]?.subjectId) continue

            // Check avoid slots
            const slot1Avoided = subject.rule?.avoidSlots?.includes(`S${si + 1}`)
            const slot2Avoided = subject.rule?.avoidSlots?.includes(`S${si + 2}`)
            if (slot1Avoided || slot2Avoided) continue

            // Check perDayMax
            const perDayMax = subject.rule?.perDayMax ?? 0
            if (perDayMax > 0 && perDayCount + 2 > perDayMax) continue

            // Find teacher available for both slots (use assigned teacher if exists)
            let teacherId: string | undefined
            if (classSubjectTeacher[subjId]) {
              // Use the already-assigned teacher for this subject
              teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, requiredTeacherId: classSubjectTeacher[subjId], occupied: teacherOccupied })
              if (!teacherId) continue
              const teacherId2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, { commit: false, requiredTeacherId: classSubjectTeacher[subjId], occupied: teacherOccupied })
              if (teacherId !== teacherId2) continue
            } else {
              // Pick any available teacher for both slots
              const teacherId1 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, occupied: teacherOccupied })
              if (!teacherId1) continue
              const teacherId2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, { commit: false, occupied: teacherOccupied })
              if (teacherId1 !== teacherId2) continue
              teacherId = teacherId1
              // Record the teacher assignment for this class-subject pair
              classSubjectTeacher[subjId] = teacherId
            }

            // Place block!
            table[day][si] = { subjectId: subjId, teacherId }
            table[day][si + 1] = { subjectId: subjId, teacherId }
            teacherLoad.set(teacherId, (teacherLoad.get(teacherId) ?? 0) + 2)
            // Mark teacher as occupied for both slots
            if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
            teacherOccupied.get(teacherId)!.add(`${day}-${si}`)
            teacherOccupied.get(teacherId)!.add(`${day}-${si + 1}`)
            if (!placedDays[subjId]) placedDays[subjId] = new Set<Day>()
            placedDays[subjId].add(day)

            blocksPlaced++
            perDayCount += 2
            subjectDemand[subjId] -= 2
            si++ // Skip next slot
          }
        }

        // Place single remaining lesson if odd count
        if (singleNeeded === 1 && subjectDemand[subjId] > 0) {
          let placed = false
          for (let di = 0; di < DAYS.length && !placed; di++) {
            const day = DAYS[di]
            for (let si = 0; si < slots.length && !placed; si++) {
              if (table[day][si]?.subjectId) continue

              const slotAvoided = subject.rule?.avoidSlots?.includes(`S${si + 1}`)
              if (slotAvoided) continue

              // Use assigned teacher if exists, otherwise pick and record
              let teacherId: string | undefined
              if (classSubjectTeacher[subjId]) {
                teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, requiredTeacherId: classSubjectTeacher[subjId], occupied: teacherOccupied })
              } else {
                teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, occupied: teacherOccupied })
                if (teacherId) {
                  classSubjectTeacher[subjId] = teacherId
                }
              }
              if (!teacherId) continue

              table[day][si] = { subjectId: subjId, teacherId }
              teacherLoad.set(teacherId, (teacherLoad.get(teacherId) ?? 0) + 1)
              // Mark teacher as occupied
              if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
              teacherOccupied.get(teacherId)!.add(`${day}-${si}`)
              if (!placedDays[subjId]) placedDays[subjId] = new Set<Day>()
              placedDays[subjId].add(day)
              subjectDemand[subjId]--
              placed = true
            }
          }
        }
      }

      // PHASE 2: Place regular (non-block) subjects
      const pool: string[] = []
      for (const [subjId, count] of Object.entries(subjectDemand)) {
        if (count <= 0) continue
        const subject = subjects.find(s => s.id === subjId)
        if (!subject) continue
        const blockSubject = shouldBlockSubject(subject, gradeId)
        if (blockSubject) continue // Blok dersler bu fazda dağılmasın
        for (let i = 0; i < count; i++) {
          pool.push(subjId)
        }
      }
      shuffle(pool)

      // Place regular subjects slot by slot
      for (let di = 0; di < DAYS.length; di++) {
        const day = DAYS[di]
        let perDayCount: Record<string, number> = {}

        for (let si = 0; si < slots.length; si++) {
          if (table[day][si]?.subjectId) continue // Skip filled slots

          let pickedIndex = -1
          let pickedTeacher: string | undefined
          for (let i = 0; i < pool.length; i++) {
            const subjId = pool[i]
            if (!subjId) continue

            const subject = subjects.find(s => s.id === subjId)
            const rule = subject?.rule

            // Check avoid slots
            if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue

            // Check perDayMax
            const perDayMax = rule?.perDayMax ?? 0
            if (perDayMax > 0 && (perDayCount[subjId] ?? 0) >= perDayMax) continue

            // Check maxConsecutive
            const maxConsec = rule?.maxConsecutive ?? 0
            if (maxConsec > 0) {
              const prev = table[day][si - 1]?.subjectId
              const prev2 = table[day][si - 2]?.subjectId
              const prev3 = table[day][si - 3]?.subjectId
              const consec = [prev, prev2, prev3].reduce((acc, v) => (v === subjId ? acc + 1 : acc), 0)
              if (consec >= maxConsec) continue
            }

            // Check minDays
            const minDays = rule?.minDays ?? 0
            if (minDays > 0) {
              const placed = placedDays[subjId] ?? new Set<Day>()
              const futureDays = DAYS.length - di - 1
              if (placed.has(day) && placed.size < minDays && futureDays < (minDays - placed.size)) {
                continue
              }
            }

            // Use assigned teacher if exists, otherwise pick and record
            let teacherId: string | undefined
            if (classSubjectTeacher[subjId]) {
              teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, requiredTeacherId: classSubjectTeacher[subjId], occupied: teacherOccupied })
            } else {
              teacherId = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, { commit: false, occupied: teacherOccupied })
              if (teacherId) {
                classSubjectTeacher[subjId] = teacherId
              }
            }
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
          // Mark teacher as occupied
          if (!teacherOccupied.has(pickedTeacher)) teacherOccupied.set(pickedTeacher, new Set())
          teacherOccupied.get(pickedTeacher)!.add(`${day}-${si}`)
          if (!placedDays[subjId]) placedDays[subjId] = new Set<Day>()
          placedDays[subjId].add(day)
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

  const classDeficits = useMemo(() => {
    if (!Object.keys(tables ?? {}).length) return []
    return classes.map(c => {
      const def = calculateDeficits(c, tables[c.key], subjects)
      return { classKey: c.key, deficits: def }
    }).filter(item => item.deficits.length > 0)
  }, [classes, subjects, tables])

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
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => setShowSheet(true)} disabled={!Object.keys(tables ?? {}).length}>Çarşaf Görünüm</button>
          <button className="btn btn-outline" onClick={handlePrintHandbooks} disabled={!Object.keys(tables ?? {}).length}>📄 Sınıf El PDF</button>
          <button className="btn btn-outline" onClick={handlePrintSheet} disabled={!Object.keys(tables ?? {}).length}>📊 Sınıf Çarşaf PDF</button>
          <button className="btn btn-primary" onClick={generate}>Programları Oluştur</button>
        </div>
      </div>

      <div className="timetable-sections">
        {grouped.map(([gradeId, list]) => (
          <div key={gradeId} className="grade-section">
            <div className="grid-timetables">
              {list.map((c) => (
                <div key={c.key} className="timetable glass">
                  <div className="timetable-head">
                    <div className="title">{c.grade}. Sınıf — {c.section}</div>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      {REQUIRED_HOURS[c.grade] && (
                        <button className="btn btn-outline btn-sm" type="button" onClick={() => setRequirementsGrade(c.grade)}>
                          Zorunlu Dersler
                        </button>
                      )}
                      {tables[c.key] && <div className="tt-status" aria-label="Oluşturuldu">Oluşturuldu</div>}
                    </div>
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
                                      <span className="s-name">{getSubjectAbbreviation(subj?.name || '')}</span>
                                      <span className="s-teacher">{teacher ? getTeacherAbbreviation(teacher.name) : '—'}</span>
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

      {classDeficits.length > 0 && (
        <div className="muted" style={{ marginTop: 16, fontSize: 12, lineHeight: 1.4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Eksik Dersler</div>
          {classDeficits.map(item => (
            <div key={item.classKey} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{item.classKey}:</span>{' '}
              {item.deficits.map(d => `${d.name} (${d.missing})`).join(', ')}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!requirementsGrade} onClose={() => setRequirementsGrade(null)} title={`${requirementsGrade ?? ''}. Sınıf Zorunlu Ders Saatleri`}>
        {requirementsGrade && REQUIRED_HOURS[requirementsGrade] ? (
          <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 1.4 }}>
            {Object.entries(REQUIRED_HOURS[requirementsGrade]).map(([name, hours]) => (
              <li key={name}>{name}: {hours} saat</li>
            ))}
          </ul>
        ) : (
          <div className="muted">Bu sınıf için zorunlu ders bilgisi tanımlı değil.</div>
        )}
      </Modal>

      {showSheet && (
        <div className="sheet-overlay">
          <div className="sheet-backdrop" onClick={() => setShowSheet(false)} />
          <div className="sheet-panel glass">
            <div className="sheet-head">
              <div>
                <div className="title" style={{ margin: 0 }}>{school.schoolName || 'Hasyurt Ortaokulu'} - SINIFLARIN HAFTALIK DERS PROGRAMI</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => window.print()}>Yazdır / PDF</button>
                <button className="btn btn-danger btn-sm" onClick={() => setShowSheet(false)}>Kapat</button>
              </div>
            </div>
            <div className="sheet-body">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sheet-class-head">Sınıf</th>
                    {DAYS.map((d) => (
                      <th key={d} colSpan={slots.length} className="sheet-day-head">{d}</th>
                    ))}
                  </tr>
                  <tr>
                    {DAYS.map((d) =>
                      slots.map((s) => <th key={d + s} className="sheet-slot-head">{s.replace('S', '')}</th>)
                    )}
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.key}>
                      <td className="sheet-class">{c.grade}. Sınıf {c.section}</td>
                      {DAYS.map((d) =>
                        slots.map((_, si) => {
                          const cell = tables[c.key]?.[d]?.[si]
                          if (!cell?.subjectId) {
                            return <td key={c.key + d + si} className="sheet-empty">—</td>
                          }
                          const subj = subjects.find((s) => s.id === cell.subjectId)
                          const teacher = teachers.find((t) => t.id === cell.teacherId)
                          return (
                            <td key={c.key + d + si} className="sheet-slot">
                              <div className="sheet-pill" title={`${subj?.name || ''} ${teacher?.name ? '— ' + teacher.name : ''}`}>
                                <div className="sheet-text">
                                  <div className="sheet-subj">{getSubjectAbbreviation(subj?.name || '')}</div>
                                  {teacher?.name && <div className="sheet-teacher">{getTeacherAbbreviation(teacher.name)}</div>}
                                </div>
                              </div>
                            </td>
                          )
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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

function shouldBlockSubject(subject: ReturnType<typeof useSubjects>['subjects'][number], gradeId: string): boolean {
  const hours = subject.weeklyHoursByGrade[gradeId] ?? 0
  // Varsayılan: haftalık 2 saatlik dersler ve blok tercihi açık olanlar aynı gün blok yerleştirilsin
  const prefersBlock = subject.rule?.preferBlockScheduling ?? true
  return prefersBlock && hours === 2
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '')
}

const SUBJECT_ALIASES: Record<string, string> = {
  fenbilimleri: 'fen',
  fen: 'fen',
  ingilizce: 'ingilizce',
  yabancidilingilizce: 'ingilizce',
  din: 'dinkulturu',
  dinkulturu: 'dinkulturu',
  sosyal: 'sosyal',
  sosyalbilgiler: 'sosyal',
  beden: 'bedenegitimi',
  bedeneğitimi: 'bedenegitimi',
  bedenegitimi: 'bedenegitimi',
}

function findSubjectIdByName(subjects: ReturnType<typeof useSubjects>['subjects'], targetName: string): string | undefined {
  const raw = normalizeName(targetName)
  const target = SUBJECT_ALIASES[raw] ?? raw
  const match = subjects.find(s => {
    const norm = normalizeName(s.name)
    const normCanon = SUBJECT_ALIASES[norm] ?? norm
    return normCanon === target
  })
  return match?.id
}

function calculateDeficits(
  c: { key: string; grade: string; section: string },
  schedule: Record<Day, Cell[]> | undefined,
  subjects: ReturnType<typeof useSubjects>['subjects']
): { name: string; missing: number }[] {
  const required = REQUIRED_HOURS[c.grade]
  if (!required) return []

  const counts: Record<string, number> = {}
  if (schedule) {
    DAYS.forEach(day => {
      schedule[day]?.forEach(cell => {
        if (!cell?.subjectId) return
        counts[cell.subjectId] = (counts[cell.subjectId] ?? 0) + 1
      })
    })
  }

  const deficits: { name: string; missing: number }[] = []
  for (const [name, hours] of Object.entries(required)) {
    const subjId = findSubjectIdByName(subjects, name)
    const current = subjId ? counts[subjId] ?? 0 : 0
    const missing = hours - current
    if (missing > 0) deficits.push({ name, missing })
  }
  return deficits
}

function pickTeacher(teachers: Teacher[], load: Map<string, number>, subjectId: string, gradeId: string, day: Day, slotIndex: number, opts?: { commit?: boolean; requiredTeacherId?: string; occupied?: Map<string, Set<string>> }): string | undefined {
  const commit = opts?.commit ?? true
  const requiredTeacherId = opts?.requiredTeacherId
  const occupied = opts?.occupied

  const slotKey = `${day}-${slotIndex}`

  const choices = teachers.filter(t => {
    // If a specific teacher is required, only consider that teacher
    if (requiredTeacherId && t.id !== requiredTeacherId) return false

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
    // Check if teacher is already teaching another class at this time
    if (occupied && occupied.get(t.id)?.has(slotKey)) return false
    return true
  })
  if (choices.length === 0) return undefined
  const pick = choices[Math.floor(Math.random() * choices.length)]
  if (commit) {
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1)
    // Mark teacher as occupied at this time slot
    if (occupied) {
      if (!occupied.has(pick.id)) occupied.set(pick.id, new Set())
      occupied.get(pick.id)!.add(slotKey)
    }
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
