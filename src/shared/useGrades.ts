import { useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { GradeItem } from './types'

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

export function useGrades() {
  const [cfg] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)
  // Okul sayfasında tanımlanan sınıflar neyse aynen o kullanılır; kullanıcı
  // bir varsayılan sınıfı (ör. Özel Eğitim) silmişse burada hayalet olarak
  // geri gelmemeli. Sadece hiç sınıf tanımlanmamışsa varsayılanlara dönülür.
  const activeGrades = cfg.grades && cfg.grades.length ? cfg.grades : DEFAULT_GRADES
  const grades: GradeItem[] = useMemo(
    () => activeGrades.map((g) => ({ id: g.grade, label: `${g.grade}. Sınıf` })),
    [activeGrades]
  )
  return grades
}
