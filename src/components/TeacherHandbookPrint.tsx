import type { Subject, Teacher, Day } from '../shared/types'
import type { ClassSchedule } from '../shared/pdfUtils'
import { getSubjectAbbreviation, formatTimeSlot, calculateTeacherSchedules } from '../shared/pdfUtils'

type Props = {
  tables: Record<string, ClassSchedule>
  subjects: Subject[]
  teachers: Teacher[]
  school: { schoolName?: string; principalName?: string; dailyLessons?: number; lessonDuration?: number; breakDuration?: number }
  slots: string[]
}

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

export default function TeacherHandbookPrint({ tables, subjects, teachers, school, slots }: Props) {
  const teacherSchedules = calculateTeacherSchedules(tables, teachers, subjects, slots)
  const effectiveDate = new Date().toLocaleDateString('tr-TR')

  return (
    <div className="print-container">
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
          <div key={teacher.id} className="print-page">
            {/* Official Header */}
            <div className="print-header">
              <div className="print-header-line">T.C.</div>
              <div className="print-header-line">FİNİKE KAYMAKAMLIĞI</div>
              <div className="print-header-line">{school.schoolName || 'Hasyurt Ortaokulu'}</div>
            </div>

            {/* Date */}
            <div className="print-date">
              {effectiveDate}
            </div>

            {/* Teacher Info */}
            <div className="print-class-info">
              <div><strong>Öğretmenin Adı :</strong> {teacher.name.toUpperCase()}</div>
              <div><strong>Konu :</strong> Haftalık Ders Programı</div>
            </div>

            {/* Official Message + Signature block */}
            <div className="print-letter-block">
              <div className="print-message">
                <p>2025 - 2026 Öğretim Yılında {effectiveDate} tarihinden itibaren uygulanacak programınız aşağıya çıkartılmıştır.</p>
                <p>Bilgilerinizi ve gereğini rica eder. Başarılar dilerim.</p>
              </div>
              <div className="print-signature">
                <div>{school.principalName || 'Nurten HOYRAZLI'}</div>
                <div>Müdür</div>
              </div>
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
                      if (!cell?.classKey) {
                        return <td key={slotIndex} className="slot-cell"></td>
                      }

                      return (
                        <td key={slotIndex} className="slot-cell">
                          <span className="print-subject">{cell.className}</span>
                          <span className="print-teacher">{getSubjectAbbreviation(cell.subjectName)}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary */}
            <div style={{ marginTop: '20px', fontSize: '10pt', borderTop: '2px solid #000', paddingTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>MAAŞ : {totalHours}</strong> ÜCRET :0 TOPLAM :{totalHours}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>ASLINI ALDIM</div>
                <div>Tarih</div>
                <div>...../...../2025</div>
              </div>
            </div>

            <div style={{ marginTop: '15px', fontSize: '10pt' }}>
              <div><strong>Sınıf Reh.Öğretmenliği :</strong></div>
              <div><strong>Eğitsel Kolu :</strong></div>
              <div><strong>Nöbet Günü ve Yeri :</strong></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
