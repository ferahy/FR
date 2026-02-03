import { useLocalStorage } from './useLocalStorage'

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
  grades: [],
}

export function useSchool() {
  const [cfg] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)

  const safeName =
    cfg.schoolName && cfg.schoolName.trim() && cfg.schoolName.trim() !== 'Okul'
      ? cfg.schoolName.trim()
      : 'Hasyurt Ortaokulu'

  return { ...cfg, schoolName: safeName }
}
