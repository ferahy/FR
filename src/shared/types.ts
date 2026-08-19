export type SubjectRule = {
  perDayMax?: number
  syncAcrossSections?: boolean
  maxConsecutive?: number
  minDays?: number
  preferBlockScheduling?: boolean
  avoidSlots?: string[]
}

export type Subject = {
  id: string
  name: string
  abbreviation?: string
  weeklyHoursByGrade: Record<string, number>
  // Şubeye özel saat sapması (opsiyonel). Key: classKey (örn. "5-A").
  // Tanımlıysa weeklyHoursByGrade[grade] yerine bu değer kullanılır —
  // 0 dahil, çünkü bir şubenin dersi hiç almadığını belirtmek de geçerli.
  weeklyHoursByClass?: Record<string, number>
  rule?: SubjectRule
  color?: string
  priority?: boolean
}

// Bir dersin belirli bir şube için haftalık saatini çözer: önce şubeye özel
// sapma (weeklyHoursByClass), yoksa sınıf seviyesinin varsayılanı
// (weeklyHoursByGrade) kullanılır.
export function getClassHours(subject: Subject, classKey: string, gradeId: string): number {
  const override = subject.weeklyHoursByClass?.[classKey]
  return override !== undefined ? override : (subject.weeklyHoursByGrade[gradeId] ?? 0)
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
  // Optional: preferred grades per subject
  preferredGradesBySubject?: Record<string, string[]>
}

// Öğretmen-Sınıf-Ders ataması
// Key format: "classKey|subjectId" -> teacherId
export type Assignments = Record<string, string>
