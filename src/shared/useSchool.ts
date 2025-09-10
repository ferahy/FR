import { useLocalStorage } from './useLocalStorage'

type SchoolConfig = {
  dailyLessons: number
  grades: { grade: string; sections: string[] }[]
}

const DEFAULT_CONFIG: SchoolConfig = {
  dailyLessons: 6,
  grades: [
    { grade: '5', sections: ['A', 'B'] },
    { grade: '6', sections: ['A', 'B'] },
    { grade: '7', sections: ['A', 'B'] },
    { grade: '8', sections: ['A', 'B'] },
  ],
}

export function useSchool() {
  const [cfg] = useLocalStorage<SchoolConfig>('schoolConfig', DEFAULT_CONFIG)
  return cfg
}

