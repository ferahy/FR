import { useMemo } from 'react'
import { useLocalStorage } from '../shared/useLocalStorage'

type GradeConfig = {
  grade: string
  sections: string[]
}

type SchoolConfig = {
  dailyLessons: number
  grades: GradeConfig[]
}

const DEFAULT_CONFIG: SchoolConfig = {
  dailyLessons: 7,
  grades: [
    { grade: '5', sections: ['A', 'B'] },
    { grade: '6', sections: ['A', 'B'] },
    { grade: '7', sections: ['A', 'B'] },
    { grade: '8', sections: ['A', 'B'] },
  ],
}

export default function Okul() {
  const [config, setConfig] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)

  const totalSections = useMemo(
    () => config.grades.reduce((acc, g) => acc + g.sections.length, 0),
    [config.grades]
  )

  const updateDailyLessons = (val: number) => {
    setConfig((c) => ({ ...c, dailyLessons: Math.max(1, Math.min(12, val)) }))
  }

  const addNextGrade = () => {
    setConfig((c) => {
      const ng = nextGrade(c.grades)
      if (c.grades.some((g) => g.grade === ng)) return c
      return { ...c, grades: [...c.grades, { grade: ng, sections: ['A'] }] }
    })
  }

  const removeGrade = (grade: string) => {
    setConfig((c) => ({ ...c, grades: c.grades.filter((g) => g.grade !== grade) }))
  }

  const addSection = (grade: string) => {
    setConfig((c) => ({
      ...c,
      grades: c.grades.map((g) => {
        if (g.grade !== grade) return g
        const next = nextSectionLetter(g.sections)
        return { ...g, sections: [...g.sections, next] }
      }),
    }))
  }

  const removeSection = (grade: string, section: string) => {
    setConfig((c) => ({
      ...c,
      grades: c.grades.map((g) =>
        g.grade === grade
          ? { ...g, sections: g.sections.filter((s) => s !== section) }
          : g
      ),
    }))
  }

  return (
    <>
      <section className="glass p-6" style={{ marginBottom: 16 }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Günlük Ders Sayısı</h3>
        <div className="row">
          <button
            className="btn btn-outline"
            onClick={() => updateDailyLessons(config.dailyLessons - 1)}
            aria-label="Azalt"
          >
            −
          </button>
          <input
            className="input"
            type="number"
            min={1}
            max={12}
            value={config.dailyLessons}
            onChange={(e) => updateDailyLessons(parseInt(e.target.value || '0', 10))}
            style={{ width: 92, textAlign: 'center' }}
          />
          <button
            className="btn btn-outline"
            onClick={() => updateDailyLessons(config.dailyLessons + 1)}
            aria-label="Arttır"
          >
            +
          </button>
        </div>
      </section>

      <section className="glass p-6">
        <div className="section-head">
          <h3 className="section-title" style={{ marginTop: 0 }}>Sınıflar ve Şubeler</h3>
          <div className="muted">Toplam Şube: {totalSections}</div>
        </div>

        

        <div className="grade-list">
          {config.grades.length === 0 && (
            <div className="muted">Henüz sınıf eklenmedi.</div>
          )}

          {config.grades.map((g) => (
            <div className="grade grade-card glass" key={g.grade}>
              <div className="grade-hero">
                <div className="plain-title">{g.grade}. Sınıf</div>
                <div className="grade-actions">
                  <button className="btn btn-danger btn-sm" onClick={() => removeGrade(g.grade)}>Sil</button>
                </div>
              </div>
              <div className="sections">
                {g.sections.map((s) => (
                  <div className="chip" key={s}>
                    <span>{s} Şubesi</span>
                    <button className="close" onClick={() => removeSection(g.grade, s)} aria-label={`${s} şubesini sil`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ))}

                <button className="chip-add chip-success" onClick={() => addSection(g.grade)}>
                  + Şube Ekle
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-primary" onClick={addNextGrade}>
            Sınıf Ekle
          </button>
        </div>
      </section>
    </>
  )
}

function nextSectionLetter(existing: string[]): string {
  // Prefer A, B, C ... Z; if taken, add next unicode letter
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  for (const ch of alphabet) {
    if (!existing.includes(ch)) return ch
  }
  // Fallback: A1, A2 ...
  let i = 1
  while (existing.includes(`A${i}`)) i++
  return `A${i}`
}

function nextGrade(grades: GradeConfig[]): string {
  const nums = grades
    .map((g) => (/^\d+$/.test(g.grade) ? parseInt(g.grade, 10) : NaN))
    .filter((n) => !Number.isNaN(n)) as number[]
  if (nums.length === 0) return '5'
  const max = Math.max(...nums)
  return String(max + 1)
}
