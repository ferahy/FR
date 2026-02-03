import type { Day, Teacher, Subject } from './types'

// Öğretmen programını sınıf programlarından hesapla
export type TeacherSchedule = Record<Day, Array<{
  classKey: string
  className: string
  subjectId: string
  subjectName: string
}>>

export type ClassSchedule = Record<Day, Array<{
  subjectId?: string
  teacherId?: string
}>>

export function calculateTeacherSchedules(
  tables: Record<string, ClassSchedule>,
  teachers: Teacher[],
  subjects: Subject[],
  slots: string[]
): Record<string, TeacherSchedule> {
  const result: Record<string, TeacherSchedule> = {}
  const days: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']

  // Her öğretmen için boş program oluştur
  for (const teacher of teachers) {
    result[teacher.id] = {} as TeacherSchedule
    for (const day of days) {
      result[teacher.id][day] = []
      for (let i = 0; i < slots.length; i++) {
        result[teacher.id][day].push({
          classKey: '',
          className: '',
          subjectId: '',
          subjectName: ''
        })
      }
    }
  }

  // Sınıf programlarından öğretmen programlarına dönüştür
  for (const [classKey, schedule] of Object.entries(tables)) {
    for (const day of days) {
      const daySchedule = schedule[day]
      if (!daySchedule) continue

      for (let slotIndex = 0; slotIndex < daySchedule.length; slotIndex++) {
        const cell = daySchedule[slotIndex]
        if (!cell?.teacherId || !cell?.subjectId) continue

        const subject = subjects.find(s => s.id === cell.subjectId)
        if (!result[cell.teacherId]) continue

        result[cell.teacherId][day][slotIndex] = {
          classKey,
          className: formatClassName(classKey),
          subjectId: cell.subjectId,
          subjectName: subject?.name || ''
        }
      }
    }
  }

  return result
}

export function formatClassName(classKey: string): string {
  const [grade, section] = classKey.split('-')
  return `${grade}/${section}`
}

// Ders kısaltmaları (PDF'lerdeki gibi)
export function getSubjectAbbreviation(subjectName: string): string {
  const upper = subjectName.trim().toLocaleUpperCase('tr-TR')
  if (!upper) return ''

  const map: Array<{ match: RegExp; abbr: string }> = [
    { match: /MATEMATİK/, abbr: 'MAT' },
    { match: /TÜRKÇE/, abbr: 'TÜRKÇ' },
    { match: /FEN\s*BİL/, abbr: 'FEN B' },
    { match: /İNGİLİZCE/, abbr: 'İNG.' },
    { match: /SOSYAL/, abbr: 'SOS' },
    { match: /DİN\s*KÜLT/, abbr: 'DİN' },
    { match: /BEDEN/, abbr: 'BED' },
    { match: /MÜZİK/, abbr: 'MÜZ' },
    { match: /GÖRSEL/, abbr: 'GÖR' },
    { match: /BİLİŞİM/, abbr: 'BİL.T' },
    { match: /TEKNOLOJ.*TASARIM/, abbr: 'TTAS' },
    { match: /REHBERLİK/, abbr: 'REH' },
    { match: /İNK(ILAP)?\s*TAR/, abbr: 'İNK' },
    { match: /TEKNOLOJ/, abbr: 'TEKNO' },
    // Seçmeli
    { match: /^S\./, abbr: upper.slice(0, 5) },
  ]

  for (const { match, abbr } of map) {
    if (match.test(upper)) return abbr
  }

  return upper.slice(0, 6)
}

// Öğretmen kısaltması (örn: "MUSTAFA GÜLMEZ" -> "M.G.")
export function getTeacherAbbreviation(teacherName: string): string {
  const parts = teacherName.trim().toUpperCase().split(' ').filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 3)
  return parts.map(p => p[0]).join('.')
}

// Saat dilimlerini formatla
export function formatTimeSlot(index: number, school: { dailyLessons?: number; lessonDuration?: number; breakDuration?: number }): string {
  // Başlangıç saati: 08:40
  const startHour = 8
  const startMinute = 40
  const lessonDuration = school.lessonDuration || 40
  const breakDuration = school.breakDuration || 10

  const totalMinutes = startHour * 60 + startMinute + index * (lessonDuration + breakDuration)
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60

  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}
