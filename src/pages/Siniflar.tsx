import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import Stepper from '../components/Stepper'
import { useSchool } from '../shared/useSchool'
import { useSubjects } from '../shared/useSubjects'
import { getClassHours, type Day } from '../shared/types'

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

type ClassItem = { key: string; grade: string; section: string }

function PlannedBadge({ planned, total }: { planned: number; total: number }) {
  const color = planned > total ? '#f87171' : planned === total ? '#4ade80' : '#94a3b8'
  return (
    <span className="pill" style={{ fontSize: 12, color }}>
      {planned > total && '⚠️ '}Planlanan: {planned} / {total} saat
    </span>
  )
}

export default function Siniflar() {
  const school = useSchool()
  const { subjects, update } = useSubjects()

  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [openClass, setOpenClass] = useState<ClassItem | null>(null)
  const [equalizeGrade, setEqualizeGrade] = useState<string | null>(null)
  const [draftHours, setDraftHours] = useState<Record<string, number>>({})

  const totalWeekly = (school.dailyLessons || 0) * DAYS.length

  const classes = useMemo(() => {
    const out: ClassItem[] = []
    for (const g of school.grades) {
      for (const s of g.sections) {
        out.push({ key: `${g.grade}-${s}`, grade: g.grade, section: s })
      }
    }
    return out
  }, [school.grades])

  const filteredClasses = useMemo(() => {
    if (gradeFilter === 'all') return classes
    return classes.filter((c) => c.grade === gradeFilter)
  }, [classes, gradeFilter])

  const groupedClasses = useMemo(() => {
    const map = new Map<string, ClassItem[]>()
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

  // Bir sınıf seviyesinin müfredat havuzu: sınıf ortalaması VEYA en az bir
  // şubenin kendine özel sapması saat>0 olan dersler. Sadece grade
  // varsayılanına bakmak, yalnızca tek bir şubeye (örn. Dersler'den 5/C'ye)
  // eklenmiş bir dersi listeden düşürür.
  const getSubjectsForGrade = (gradeId: string) => {
    const classKeys = classes.filter((c) => c.grade === gradeId).map((c) => c.key)
    return subjects.filter((s) =>
      (s.weeklyHoursByGrade[gradeId] ?? 0) > 0 ||
      classKeys.some((ck) => getClassHours(s, ck, gradeId) > 0)
    )
  }

  // Belirli bir şubenin (5/A gibi) fiilen aldığı ders saatleri toplamı —
  // şubeye özel sapma varsa onu, yoksa sınıf seviyesi varsayılanını kullanır.
  const plannedHoursForClass = (c: ClassItem) => {
    return subjects.reduce((sum, s) => sum + getClassHours(s, c.key, c.grade), 0)
  }

  const setHoursForClass = (subjectId: string, classKey: string, nextHours: number) => {
    const subject = subjects.find((s) => s.id === subjectId)
    if (!subject) return
    const clamped = Math.max(0, nextHours)
    const { id, ...rest } = subject
    update(id, {
      ...rest,
      weeklyHoursByClass: { ...(subject.weeklyHoursByClass ?? {}), [classKey]: clamped },
    })
  }

  const openSubjects = openClass ? getSubjectsForGrade(openClass.grade) : []
  const openPlanned = openClass ? plannedHoursForClass(openClass) : 0

  const openEqualize = (gradeId: string) => {
    const draft: Record<string, number> = {}
    for (const s of subjects) draft[s.id] = s.weeklyHoursByGrade[gradeId] ?? 0
    setDraftHours(draft)
    setEqualizeGrade(gradeId)
  }

  const draftTotal = useMemo(
    () => Object.values(draftHours).reduce((sum, h) => sum + (h || 0), 0),
    [draftHours]
  )

  const confirmEqualize = () => {
    if (!equalizeGrade) return
    const sectionKeys = classes.filter((c) => c.grade === equalizeGrade).map((c) => c.key)
    for (const s of subjects) {
      const nextHours = draftHours[s.id] ?? 0
      const currentHours = s.weeklyHoursByGrade[equalizeGrade] ?? 0
      const hasOverrides = sectionKeys.some((ck) => s.weeklyHoursByClass?.[ck] !== undefined)
      if (nextHours === currentHours && !hasOverrides) continue

      const nextWeeklyHoursByClass = { ...(s.weeklyHoursByClass ?? {}) }
      for (const ck of sectionKeys) delete nextWeeklyHoursByClass[ck]

      const { id, ...rest } = s
      update(id, {
        ...rest,
        weeklyHoursByGrade: { ...s.weeklyHoursByGrade, [equalizeGrade]: nextHours },
        weeklyHoursByClass: nextWeeklyHoursByClass,
      })
    }
    setEqualizeGrade(null)
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <div className="glass" style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Sınıflar</h2>
            <div className="muted" style={{ marginTop: 6 }}>
              Her sınıf ve şubenin haftalık toplam ders saati otomatik hesaplanır. 5 okul günü × günlük ders sayısı.
            </div>
          </div>
          <select
            className="select"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            style={{ minWidth: 140 }}
          >
            <option value="all">Tüm Sınıflar</option>
            {school.grades.map((g) => (
              <option key={g.grade} value={g.grade}>{g.grade}. Sınıf</option>
            ))}
          </select>
        </div>
      </div>

      {classes.length === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 16, color: '#94a3b8' }}>
            Henüz sınıf tanımlanmamış. Önce "Okul" sayfasından sınıfları ekleyin.
          </div>
        </div>
      )}

      {groupedClasses.map(([gradeId, classList]) => (
        <div key={gradeId} className="glass" style={{ padding: '16px 20px', marginBottom: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
            marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(148, 163, 184, 0.1)'
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{gradeId}. Sınıf</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => openEqualize(gradeId)}>
              Tüm Şubeleri Eşitle
            </button>
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {classList.map((c) => {
              const planned = plannedHoursForClass(c)
              return (
                <div key={c.key} className="chip" style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8,
                  padding: '12px 14px', borderRadius: 14, cursor: 'default'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{c.grade}/{c.section}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{totalWeekly} saat</span>
                  </div>
                  <PlannedBadge planned={planned} total={totalWeekly} />
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setOpenClass(c)}
                  >
                    Sınıfta Okutulan Dersler
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Tek bir şubenin derslerini görüntüle / düzenle */}
      <Modal
        open={!!openClass}
        onClose={() => setOpenClass(null)}
        title={openClass ? `Sınıfta Okutulan Dersler — ${openClass.grade}/${openClass.section}` : 'Sınıfta Okutulan Dersler'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Saatleri buradan değiştirdiğinde sadece bu şube etkilenir. Tüm şubelere aynı anda aynı değeri vermek için sınıf başlığındaki "Tüm Şubeleri Eşitle" butonunu kullan.
          </div>

          {openSubjects.length === 0 ? (
            <div className="muted">Bu sınıf için henüz ders tanımlanmamış.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {openSubjects.map((s) => {
                  const hours = getClassHours(s, openClass!.key, openClass!.grade)
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.06)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="color-dot" style={{ background: s.color ?? '#93c5fd' }} aria-hidden />
                        <span style={{ fontSize: 14, color: '#e2e8f0' }}>{s.name}</span>
                      </div>
                      <Stepper
                        value={hours}
                        label={s.name}
                        onChange={(next) => setHoursForClass(s.id, openClass!.key, next)}
                      />
                    </div>
                  )
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', paddingTop: 10,
                borderTop: '1px solid rgba(148, 163, 184, 0.1)', fontSize: 13, fontWeight: 700
              }}>
                <span style={{ color: '#cbd5e1' }}>Toplam Planlanan</span>
                <span style={{ color: openPlanned > totalWeekly ? '#f87171' : openPlanned === totalWeekly ? '#4ade80' : '#94a3b8' }}>
                  {openPlanned > totalWeekly && '⚠️ '}{openPlanned} / {totalWeekly} saat
                </span>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Tüm şubeleri tek bir şablona eşitle */}
      <Modal
        open={!!equalizeGrade}
        onClose={() => setEqualizeGrade(null)}
        title={equalizeGrade ? `${equalizeGrade}. Sınıf — Tüm Şubeleri Eşitle` : 'Tüm Şubeleri Eşitle'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Burada belirlediğin ders saatleri, onayladığında bu sınıf seviyesindeki <strong>tüm şubelere</strong> aynen uygulanır ve şubelere özel farklılıklar sıfırlanır.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {subjects.map((s) => {
              const value = draftHours[s.id] ?? 0
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="color-dot" style={{ background: s.color ?? '#93c5fd' }} aria-hidden />
                    <span style={{ fontSize: 14, color: '#e2e8f0' }}>{s.name}</span>
                  </div>
                  <Stepper
                    value={value}
                    label={s.name}
                    onChange={(next) => setDraftHours((d) => ({ ...d, [s.id]: next }))}
                  />
                </div>
              )
            })}
            {subjects.length === 0 && (
              <div className="muted">Henüz ders tanımlanmamış. Önce "Dersler" sayfasından ders ekleyin.</div>
            )}
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', paddingTop: 10,
            borderTop: '1px solid rgba(148, 163, 184, 0.1)', fontSize: 13, fontWeight: 700
          }}>
            <span style={{ color: '#cbd5e1' }}>Toplam</span>
            <span style={{ color: draftTotal > totalWeekly ? '#f87171' : draftTotal === totalWeekly ? '#4ade80' : '#94a3b8' }}>
              {draftTotal > totalWeekly && '⚠️ '}{draftTotal} / {totalWeekly} saat
            </span>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-outline" onClick={() => setEqualizeGrade(null)}>İptal</button>
            <button type="button" className="btn btn-primary" onClick={confirmEqualize}>Onayla ve Eşitle</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
