import { useLocalStorage } from './useLocalStorage'

type SchoolConfig = {
  schoolName?: string
  principalName?: string
  dailyLessons: number
  grades: { grade: string; sections: string[] }[]
}

export const DEFAULT_GRADES: { grade: string; sections: string[] }[] = [
  { grade: '5', sections: ['A', 'B'] },
  { grade: '6', sections: ['A', 'B'] },
  { grade: '7', sections: ['A', 'B'] },
  { grade: '8', sections: ['A', 'B'] },
  { grade: 'Özel Eğitim', sections: ['A'] },
]

const DEFAULT_CONFIG: SchoolConfig = {
  schoolName: 'Hasyurt Ortaokulu',
  principalName: 'Nurten HOYRAZLI',
  dailyLessons: 7,
  grades: DEFAULT_GRADES,
}

export function useSchool() {
  const [cfg] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)
  const mergedGrades = (() => {
    const base = cfg.grades && cfg.grades.length ? [...cfg.grades] : [...DEFAULT_GRADES]
    for (const def of DEFAULT_GRADES) {
      if (!base.some((g) => g.grade === def.grade)) {
        base.push(def)
      }
    }
    return base
  })()

  const safeName =
    cfg.schoolName && cfg.schoolName.trim() && cfg.schoolName.trim() !== 'Okul'
      ? cfg.schoolName.trim()
      : 'Hasyurt Ortaokulu'

  return { ...cfg, grades: mergedGrades, schoolName: safeName }
}
