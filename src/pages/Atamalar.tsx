import { useEffect, useMemo, useState } from 'react'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import { useAssignments } from '../shared/useAssignments'
import type { Teacher } from '../shared/types'

export default function Atamalar() {
  const school = useSchool()
  const gradeOptions = useGrades()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()
  const { assignments, assign, getAssignment, resetAll } = useAssignments()

  const [gradeFilter, setGradeFilter] = useState<string>('all')

  // Sınıf listesi oluştur
  const classes = useMemo(() => {
    const out: { key: string; grade: string; section: string }[] = []
    for (const g of school.grades) {
      for (const s of g.sections) {
        out.push({ key: `${g.grade}-${s}`, grade: g.grade, section: s })
      }
    }
    return out
  }, [school.grades])

  // Filtrelenmiş sınıflar
  const filteredClasses = useMemo(() => {
    if (gradeFilter === 'all') return classes
    return classes.filter(c => c.grade === gradeFilter)
  }, [classes, gradeFilter])

  // Sınıf seviyesine göre grupla
  const groupedClasses = useMemo(() => {
    const map = new Map<string, typeof classes>()
    for (const c of filteredClasses) {
      if (!map.has(c.grade)) map.set(c.grade, [])
      map.get(c.grade)!.push(c)
    }
    return Array.from(map.entries()).sort((a, b) => {
      const numA = parseInt(a[0]) || 99
      const numB = parseInt(b[0]) || 99
      return numA - numB
    })
  }, [filteredClasses])

  const getSubjectsForGrade = (gradeId: string) => {
    return subjects.filter(s => (s.weeklyHoursByGrade[gradeId] ?? 0) > 0)
  }

  const getEligibleTeachers = (subjectId: string, gradeId: string): Teacher[] => {
    return teachers.filter(t => {
      const subs = getTeacherSubjectIds(t)
      if (!subs.includes(subjectId)) return false
      const hasSubjectPref = t.preferredGradesBySubject &&
        Object.prototype.hasOwnProperty.call(t.preferredGradesBySubject, subjectId)
      if (hasSubjectPref) {
        const subjPref = t.preferredGradesBySubject?.[subjectId] ?? []
        if (subjPref.length > 0 && !subjPref.includes(gradeId)) return false
      } else {
        const prefGrades = t.preferredGrades ?? []
        if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
      }
      return true
    })
  }

  // Tek seçenekli dersleri otomatik ata
  useEffect(() => {
    for (const c of classes) {
      const gradeSubjects = getSubjectsForGrade(c.grade)
      for (const s of gradeSubjects) {
        if (getAssignment(c.key, s.id)) continue
        const eligible = getEligibleTeachers(s.id, c.grade)
        if (eligible.length === 1) {
          assign(c.key, s.id, eligible[0].id)
        }
      }
    }
  }, [classes, subjects, teachers])

  // Genel istatistikler
  const stats = useMemo(() => {
    let total = 0
    let assigned = 0
    let needsChoice = 0

    for (const c of classes) {
      const gradeSubjects = getSubjectsForGrade(c.grade)
      for (const s of gradeSubjects) {
        const eligible = getEligibleTeachers(s.id, c.grade)
        if (eligible.length <= 1) continue
        total++
        if (getAssignment(c.key, s.id)) {
          assigned++
        } else {
          needsChoice++
        }
      }
    }
    return { total, assigned, needsChoice }
  }, [classes, subjects, teachers, assignments])

  const handleReset = () => {
    if (window.confirm('Tüm öğretmen atamaları silinecek. Emin misiniz?')) {
      resetAll()
    }
  }

  const progressPercent = stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 100

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Header */}
      <div className="glass" style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>
              Öğretmen Atamaları
            </h2>
            {stats.total > 0 && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 200,
                  height: 6,
                  background: 'rgba(51, 65, 85, 0.8)',
                  borderRadius: 3,
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progressPercent}%`,
                    background: stats.needsChoice === 0 ? '#22c55e' : '#f59e0b',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: stats.needsChoice === 0 ? '#4ade80' : '#fbbf24'
                }}>
                  {stats.needsChoice === 0 ? 'Tamamlandı' : `${stats.needsChoice} seçim bekliyor`}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="select"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              style={{ minWidth: 120 }}
            >
              <option value="all">Tüm Sınıflar</option>
              {gradeOptions.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={handleReset}>
              Sıfırla
            </button>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {classes.length === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 16, color: '#94a3b8' }}>
            Henüz sınıf tanımlanmamış. Önce "Okul" sayfasından sınıfları ekleyin.
          </div>
        </div>
      )}

      {/* Grade Tables */}
      {groupedClasses.map(([gradeId, classList]) => {
        const gradeSubjects = getSubjectsForGrade(gradeId)
        if (gradeSubjects.length === 0) return null

        return (
          <div key={gradeId} className="glass" style={{ padding: '16px 20px', marginBottom: 12 }}>
            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#e2e8f0',
              marginBottom: 12,
              paddingBottom: 10,
              borderBottom: '1px solid rgba(148, 163, 184, 0.1)'
            }}>
              {gradeId}. Sınıf
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{
                      width: 60,
                      textAlign: 'left',
                      padding: '10px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '1px solid rgba(148, 163, 184, 0.08)'
                    }}>
                      Şube
                    </th>
                    {gradeSubjects.map(s => (
                      <th key={s.id} style={{
                        minWidth: 130,
                        textAlign: 'left',
                        padding: '10px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#94a3b8',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.08)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 3,
                            height: 14,
                            borderRadius: 2,
                            background: s.color ?? '#6366f1'
                          }} />
                          {s.name}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {classList.map(c => (
                    <tr key={c.key}>
                      <td style={{
                        padding: '8px 12px',
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#cbd5e1'
                      }}>
                        {c.section}
                      </td>
                      {gradeSubjects.map(s => {
                        const currentTeacherId = getAssignment(c.key, s.id)
                        const eligible = getEligibleTeachers(s.id, c.grade)

                        // Hiç öğretmen yok
                        if (eligible.length === 0) {
                          return (
                            <td key={s.id} style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 12, color: '#ef4444' }}>
                                Öğretmen yok
                              </span>
                            </td>
                          )
                        }

                        // Tek seçenek - sadece isim göster
                        if (eligible.length === 1) {
                          return (
                            <td key={s.id} style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 13, color: '#64748b' }}>
                                {eligible[0].name}
                              </span>
                            </td>
                          )
                        }

                        // Çoklu seçenek - dropdown
                        const hasAssignment = !!currentTeacherId
                        return (
                          <td key={s.id} style={{ padding: '6px 10px' }}>
                            <select
                              className="select"
                              value={currentTeacherId ?? ''}
                              onChange={(e) => assign(c.key, s.id, e.target.value || null)}
                              style={{
                                width: '100%',
                                fontSize: 13,
                                padding: '7px 10px',
                                borderRadius: 6,
                                background: hasAssignment
                                  ? 'rgba(34, 197, 94, 0.12)'
                                  : 'rgba(249, 115, 22, 0.12)',
                                border: hasAssignment
                                  ? '1.5px solid rgba(34, 197, 94, 0.4)'
                                  : '1.5px solid rgba(249, 115, 22, 0.5)',
                                color: hasAssignment ? '#86efac' : '#fb923c',
                                fontWeight: 500,
                                cursor: 'pointer'
                              }}
                            >
                              <option value="">Seçiniz</option>
                              {eligible.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getTeacherSubjectIds(t: Teacher): string[] {
  if (t.subjectIds && t.subjectIds.length) return t.subjectIds
  if (t.subjectId) return [t.subjectId]
  return []
}
