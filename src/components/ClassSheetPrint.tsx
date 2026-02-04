import type { Subject, Teacher, Day } from '../shared/types'
import { getSubjectAbbreviation, getTeacherAbbreviation } from '../shared/pdfUtils'

type Cell = { subjectId?: string; teacherId?: string }

type Props = {
  tables: Record<string, Record<Day, Cell[]>>
  subjects: Subject[]
  teachers: Teacher[]
  classes: Array<{ key: string; grade: string; section: string }>
  school: { schoolName?: string }
  slots: string[]
}

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

export default function ClassSheetPrint({ tables, subjects, teachers, classes, school, slots }: Props) {
  return (
    <div className="print-container print-landscape-page">
      <div className="print-page">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '14pt', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {school.schoolName || 'Hasyurt Ortaokulu'} - SINIFLARIN HAFTALIK DERS PROGRAMI
          </h1>
        </div>

        {/* Çarşaf Table */}
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '7pt',
          tableLayout: 'fixed'
        }}>
          <thead>
            {/* First row: Days */}
            <tr>
              <th rowSpan={2} style={{
                border: '1px solid black',
                padding: '4px',
                background: '#f0f0f0',
                fontWeight: 'bold',
                textAlign: 'center',
                width: '60px'
              }}>
                Sınıf
              </th>
              {DAYS.map((day) => (
                <th
                  key={day}
                  colSpan={slots.length}
                  style={{
                    border: '1px solid black',
                    padding: '4px',
                    background: '#f0f0f0',
                    fontWeight: 'bold',
                    textAlign: 'center'
                  }}
                >
                  {day}
                </th>
              ))}
            </tr>
            {/* Second row: Slot numbers */}
            <tr>
              {DAYS.map((day) =>
                slots.map((_, slotIndex) => (
                  <th
                    key={`${day}-${slotIndex}`}
                    style={{
                      border: '1px solid black',
                      padding: '2px',
                      background: '#f0f0f0',
                      fontWeight: 'bold',
                      textAlign: 'center',
                      fontSize: '6pt'
                    }}
                  >
                    {slotIndex + 1}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {classes.map((classItem) => {
              const schedule = tables[classItem.key]
              if (!schedule) return null

              return (
                <tr key={classItem.key}>
                  <td style={{
                    border: '1px solid black',
                    padding: '4px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    background: '#f8f8f8',
                    fontSize: '8pt'
                  }}>
                    {classItem.grade}/{classItem.section}
                  </td>
                  {DAYS.map((day) =>
                    slots.map((_, slotIndex) => {
                      const cell = schedule[day]?.[slotIndex]
                      if (!cell?.subjectId) {
                        return (
                          <td
                            key={`${classItem.key}-${day}-${slotIndex}`}
                            style={{
                              border: '1px solid black',
                              padding: '2px',
                              textAlign: 'center',
                              fontSize: '6pt'
                            }}
                          >

                          </td>
                        )
                      }

                      const subject = subjects.find(s => s.id === cell.subjectId)
                      const teacher = teachers.find(t => t.id === cell.teacherId)

                      return (
                        <td
                          key={`${classItem.key}-${day}-${slotIndex}`}
                          style={{
                            border: '1px solid black',
                            padding: '2px',
                            textAlign: 'center',
                            lineHeight: '1.1',
                            verticalAlign: 'middle'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '7pt' }}>
                              {getSubjectAbbreviation(subject?.name || '')}
                            </span>
                            {teacher && (
                              <span style={{ fontSize: '6pt', opacity: 0.8 }}>
                                {getTeacherAbbreviation(teacher.name)}
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
