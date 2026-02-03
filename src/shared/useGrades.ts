import { useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { GradeItem } from './types'

type SchoolConfig = {
  schoolName?: string
  principalName?: string
  dailyLessons: number
  grades: { grade: string; sections: string[] }[]
}

const DEFAULT_CONFIG: SchoolConfig = {
  schoolName: 'Hasyurt Ortaokulu',
  principalName: 'Nurten HOYRAZLI',
  dailyLessons: 7,
  grades: [
    { grade: '5', sections: ['A', 'B'] },
    { grade: '6', sections: ['A', 'B'] },
    { grade: '7', sections: ['A', 'B'] },
    { grade: '8', sections: ['A', 'B'] },
  ],
}

export function useGrades() {
  const [cfg] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)
  const grades: GradeItem[] = useMemo(
    () => cfg.grades.map((g) => ({ id: g.grade, label: `${g.grade}. Sınıf` })),
    [cfg.grades]
  )
  return grades
}
