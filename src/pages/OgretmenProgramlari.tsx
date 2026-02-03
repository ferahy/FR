import { useMemo, useState } from 'react'
import { useSchool } from '../shared/useSchool'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'
import { calculateTeacherSchedules, formatClassName, formatTimeSlot } from '../shared/pdfUtils'
import { generateTeacherHandbookHTML } from '../shared/htmlPdfGenerator'
import TeacherHandbookPrint from '../components/TeacherHandbookPrint'
import TeacherSheetPrint from '../components/TeacherSheetPrint'

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

type Cell = { subjectId?: string; teacherId?: string }

export default function OgretmenProgramlari() {
  const school = useSchool()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const slotTimes = useMemo(() => slots.map((_, i) => formatTimeSlot(i, school)), [slots, school])

  const [tables] = useLocalStorage<Record<string, Record<Day, Cell[]>>>('timetables', {})
  const [printMode, setPrintMode] = useState<'handbook' | 'sheet' | null>(null)

  // Calculate teacher schedules
  const teacherSchedules = useMemo(
    () => calculateTeacherSchedules(tables, teachers, subjects, slots),
    [tables, teachers, subjects, slots]
  )

  const hasTables = Object.keys(tables).length > 0

  const handlePrintHandbooks = () => {
    const allHTML = teachers
      .filter(t => teacherSchedules[t.id])
      .map(t => generateTeacherHandbookHTML(
        t,
        teacherSchedules[t.id],
        subjects,
        school.schoolName || 'Okul',
        school.principalName,
        slotTimes
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

    requestAnimationFrame(() => {
      setTimeout(() => {
        newWindow.print()
      }, 200)
    })
  }

  const handlePrintSheet = () => {
    setPrintMode('sheet')
    // Wait longer for React to render
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print()
        setTimeout(() => setPrintMode(null), 100)
      }, 100)
    })
  }

  return (
    <>
      <div className="topbar glass p-6" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div className="brand">
          <div className="title">Öğretmen Programları</div>
          <div className="subtitle">Öğretmen bazlı ders programları</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={handlePrintHandbooks} disabled={!hasTables}>📄 Öğretmen El PDF</button>
          <button className="btn btn-outline" onClick={handlePrintSheet} disabled={!hasTables}>📊 Öğretmen Çarşaf PDF</button>
        </div>
      </div>

      {!hasTables ? (
        <div className="glass p-6" style={{ marginBottom: 16 }}>
          <div className="muted">
            Henüz oluşturulmuş bir ders programı yok. Önce "Ders Programları" sayfasından programları oluşturun.
          </div>
        </div>
      ) : (
        <div className="timetable-sections">
          {teachers.map((teacher) => {
            const schedule = teacherSchedules[teacher.id]
            if (!schedule) return null

            // Calculate total hours
            let totalHours = 0
            DAYS.forEach(day => {
              schedule[day]?.forEach(cell => {
                if (cell.classKey) totalHours++
              })
            })

            return (
              <div key={teacher.id} className="grade-section">
                <div className="grid-timetables">
                  <div className="timetable glass">
                    <div className="timetable-head">
                      <div className="title">{teacher.name}</div>
                      <div className="tt-status" aria-label="Toplam Ders">
                        {totalHours} Saat
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
                                const cell = schedule[d]?.[si]
                                if (!cell?.classKey) {
                                  return (
                                    <td key={teacher.id + d + si} className="slot">
                                      <span className="muted">—</span>
                                    </td>
                                  )
                                }

                                const subject = subjects.find(s => s.id === cell.subjectId)

                                return (
                                  <td key={teacher.id + d + si} className="slot">
                                    <div
                                      className="slot-pill"
                                      title={`${cell.className} — ${cell.subjectName}`}
                                    >
                                      <span className="dot" style={{ background: subject?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{formatClassName(cell.classKey)}</span>
                                      <span className="s-teacher">{cell.subjectName}</span>
                                    </div>
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
                                const cell = schedule[d]?.[si]
                                const subject = subjects.find(s => s.id === cell?.subjectId)

                                return (
                                  <div key={teacher.id + d + 'a' + si} className="acc-slot">
                                    <div className="acc-slot-left">S{si + 1}</div>
                                    {cell?.classKey ? (
                                      <div className="acc-slot-main">
                                        <span className="dot" style={{ background: subject?.color ?? '#93c5fd' }} />
                                        <span className="s-name">{formatClassName(cell.classKey)}</span>
                                        <span className="s-teacher">{cell.subjectName}</span>
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

      {/* Print Components (always rendered, controlled by CSS) */}
      <div
        data-print-mode="handbook"
        className="print-wrapper"
        style={{ display: printMode === 'handbook' ? 'block' : 'none' }}
      >
        {printMode === 'handbook' && (
          <TeacherHandbookPrint
            tables={tables}
            subjects={subjects}
            teachers={teachers}
            school={school}
            slots={slots}
          />
        )}
      </div>
      <div
        data-print-mode="sheet"
        className="print-wrapper"
        style={{ display: printMode === 'sheet' ? 'block' : 'none' }}
      >
        {printMode === 'sheet' && (
          <TeacherSheetPrint
            tables={tables}
            subjects={subjects}
            teachers={teachers}
            school={school}
            slots={slots}
          />
        )}
      </div>
    </>
  )
}
