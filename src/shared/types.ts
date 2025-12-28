export type SubjectRule = {
  perDayMax?: number
  syncAcrossSections?: boolean
  maxConsecutive?: number
  minDays?: number
}

export type Subject = {
  id: string
  name: string
  weeklyHoursByGrade: Record<string, number>
  rule?: SubjectRule
  color?: string
}

export type GradeItem = {
  id: string
  label: string
}

export type Day = 'Pazartesi' | 'Salı' | 'Çarşamba' | 'Perşembe' | 'Cuma'

export type Teacher = {
  id: string
  name: string
  // New multi-branch support
  subjectIds?: string[]
  // Legacy single-branch (kept for backward compatibility of saved data)
  subjectId?: string
  minHours?: number
  maxHours?: number
  unavailable?: Partial<Record<Day, string[]>>
  preferredGrades?: string[]
}
