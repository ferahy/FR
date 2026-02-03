import type { Subject, Teacher, Day } from '../shared/types'
import type { ClassSchedule } from '../shared/pdfUtils'
import { getSubjectAbbreviation, getTeacherAbbreviation, formatTimeSlot, formatClassName } from '../shared/pdfUtils'

type Props = {
  tables: Record<string, ClassSchedule>
  subjects: Subject[]
  teachers: Teacher[]
  classes: Array<{ key: string; grade: string; section: string }>
  school: { schoolName?: string; dailyLessons?: number; lessonDuration?: number; breakDuration?: number }
  slots: string[]
}

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

export default function ClassHandbookPrint({ tables, subjects, teachers, classes, school, slots }: Props) {
  return (
    <div className="print-container">
      {classes.map((classItem) => {
        const schedule = tables[classItem.key]
        if (!schedule) return null

        // Calculate subject summary
        const subjectCounts = new Map<string, number>()
        DAYS.forEach(day => {
          schedule[day]?.forEach(cell => {
            if (cell.subjectId) {
              subjectCounts.set(cell.subjectId, (subjectCounts.get(cell.subjectId) || 0) + 1)
            }
          })
        })

        return (
          <div key={classItem.key} className="print-page">
            {/* Official Header */}
            <div className="print-header">
              <div className="print-header-line">T.C.</div>
              <div className="print-header-line">FİNİKE KAYMAKAMLIĞI</div>
              <div className="print-header-line">{school.schoolName || 'Hasyurt Ortaokulu'}</div>
            </div>

            {/* Date */}
            <div className="print-date">
              {new Date().toLocaleDateString('tr-TR')}
            </div>

            {/* Class Info */}
            <div className="print-class-info">
              <div><strong>Sınıfın Adı :</strong> {formatClassName(classItem.key)}</div>
              <div><strong>Sınıf Öğretmeni :</strong></div>
            </div>

            {/* Official Message */}
            <div className="print-message">
              <p>2025 - 2026 Öğretim Yılında 12.12.2025 tarihinden itibaren uygulanacak programınız aşağıya çıkartılmıştır.</p>
              <p>Bilgilerinizi ve gereğini rica eder. Başarılar dilerim.</p>
            </div>

            <div className="print-signature">
              <div>Nurten HOYRAZLI</div>
              <div>Müdür</div>
            </div>

            {/* Timetable */}
            <table className="print-timetable">
              <thead>
                <tr>
                  <th rowSpan={2}></th>
                  <th>1</th>
                  <th>2</th>
                  <th>3</th>
                  <th>4</th>
                  <th>5</th>
                  <th>6</th>
                  <th>7</th>
                </tr>
                <tr>
                  {slots.map((_, i) => (
                    <th key={i}>{formatTimeSlot(i, school)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day) => (
                  <tr key={day}>
                    <td className="day-col"><strong>{day}</strong></td>
                    {slots.map((_, slotIndex) => {
                      const cell = schedule[day]?.[slotIndex]
                      if (!cell?.subjectId) {
                        return <td key={slotIndex} className="slot-cell"></td>
                      }

                      const subject = subjects.find(s => s.id === cell.subjectId)
                      const teacher = teachers.find(t => t.id === cell.teacherId)

                      return (
                        <td key={slotIndex} className="slot-cell">
                          <span className="print-subject">{getSubjectAbbreviation(subject?.name || '')}</span>
                          {teacher && (
                            <span className="print-teacher">{getTeacherAbbreviation(teacher.name)}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Subject List */}
            <table className="print-subject-list">
              <thead>
                <tr>
                  <th>Dersin Adı</th>
                  <th>HDS</th>
                  <th>Öğretmenin Adı</th>
                  <th>Derslik</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(subjectCounts.entries())
                  .sort((a, b) => {
                    const subA = subjects.find(s => s.id === a[0])
                    const subB = subjects.find(s => s.id === b[0])
                    return (subA?.name || '').localeCompare(subB?.name || '')
                  })
                  .map(([subjectId, count]) => {
                    const subject = subjects.find(s => s.id === subjectId)
                    // Find the teacher who teaches this subject most in this class
                    const teacherCounts = new Map<string, number>()
                    DAYS.forEach(day => {
                      schedule[day]?.forEach(cell => {
                        if (cell.subjectId === subjectId && cell.teacherId) {
                          teacherCounts.set(cell.teacherId, (teacherCounts.get(cell.teacherId) || 0) + 1)
                        }
                      })
                    })
                    const mainTeacherId = Array.from(teacherCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
                    const teacher = teachers.find(t => t.id === mainTeacherId)

                    return (
                      <tr key={subjectId}>
                        <td>{subject?.name || ''}</td>
                        <td>{count}</td>
                        <td>{teacher?.name || ''}</td>
                        <td></td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
