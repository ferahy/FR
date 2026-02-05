import type { Day, Teacher, Subject } from './types'

// Öğretmen programını sınıf programlarından hesapla
export type TeacherSchedule = Record<Day, Array<{
  classKey: string
  className: string
  subjectId: string
  subjectName: string
  subjectAbbreviation?: string
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
          subjectName: subject?.name || '',
          subjectAbbreviation: subject?.abbreviation || ''
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
const SUBJECT_ABBR_MAP: Record<string, string> = {
  'TÜRKÇE': 'TURKC',
  'MATEMATİK': 'MAT',
  'FEN BİLİMLERİ': 'FEN B',
  'SOSYAL BİLGİLER': 'SOS',
  'İNGİLİZCE': 'İNG',
  'DİKAB': 'DİN',
  'DİN KÜLTÜRÜ': 'DİN',
  'GÖRSEL SANATLAR': 'GÖRSE',
  'MÜZİK': 'MÜZ',
  'BEDEN EĞİTİMİ': 'BED',
  'BİLİŞİM TEKNOLOJİLERİ': 'BİL.T',
  'TEKNOLOJİ VE TASARIM': 'TTAS',
  'İNKILAP TARİHİ': 'İNK',
  'REHBERLİK VE KARİYER PLANLAMA': 'REH',
  'SEÇMELİ MASAL VE DESTANLAR': 'S.M.D',
  'SEÇMELİ İNGİLİZCE': 'S.İNG',
  'SEÇMELİ PEYGAMBERİMİZİN HAYATI': 'S.P.H',
  'SEÇMELİ KMY': 'S.KMY',
  'SEÇMELİ MEDYA OKURYAZARLIĞI': 'S.MED',
  'SEÇMELİ SPOR VE FİZİKİ ETKİNLİKLER': 'S.SFE',
  'ÖZEL EĞİTİM DİN KÜLTÜRÜ': 'ÖEDK',
  'ÖZEL EĞİTİM BEDEN': 'ÖEBDN',
  'ÖZEL EĞİTİM GÖRSEL SANATLAR': 'ÖEGS',
  'ÖZEL EĞİTİM MÜZİK': 'ÖEM',
}

export function getSubjectAbbreviation(subjectName: string, preferredAbbr?: string): string {
  if (preferredAbbr && preferredAbbr.trim()) {
    return preferredAbbr.trim()
  }
  const upper = subjectName.trim().toLocaleUpperCase('tr-TR')
  if (!upper) return ''

  if (SUBJECT_ABBR_MAP[upper]) return SUBJECT_ABBR_MAP[upper]

  // Seçmeli dersler (önce kontrol et)
  if (upper.startsWith('S.') || upper.startsWith('SEÇMELİ')) {
    if (upper.includes('İNGİLİZCE')) return 'S.İNG'
    if (upper.includes('MASAL')) return 'SMD'
    if (upper.includes('PEYGAMBER')) return 'S.P.H'
    if (upper.includes('KÜLTÜR')) return 'S.KMY'
    if (upper.includes('KUR') && upper.includes('AN')) return 'S.KUR'
    if (upper.includes('MATEMATİK')) return 'S.M.B'
    if (upper.includes('AFET')) return 'S.A.B'
    if (upper.includes('OYUN')) return 'S.O.E'
    if (upper.includes('ÇEVRİ')) return 'S.ÇİD'
    if (upper.includes('MEDYA')) return 'MED'
  }

  // Özel eğitim dersleri
  if (upper.startsWith('ÖE') || upper.includes('ÖZEL EĞİTİM')) {
    if (upper.includes('DİN') || upper.includes('KÜLT')) return 'ÖEDK'
    if (upper.includes('GÖRSEL')) return 'ÖEGS'
    if (upper.includes('BEDEN')) return 'ÖEBDN'
    if (upper.includes('MÜZ')) return 'ÖEM'
    return 'ÖE'
  }

  // Normal dersler
  if (upper.includes('MATEMATİK')) return 'MAT'
  if (upper.includes('TÜRKÇE')) return 'TURKC'
  if (upper.includes('FEN')) return 'FEN B'
  if (upper.includes('İNGİLİZCE')) return 'İNG.'
  if (upper.includes('SOSYAL')) {
    // SOS7 veya SOS B olabilir
    return upper.includes('7') ? 'SOS7' : 'SOS B'
  }
  if (upper.includes('DİN') || upper.includes('KÜLT')) return 'DİN'
  if (upper.includes('BEDEN')) {
    // BED, BEDN veya BDN olabilir
    if (upper.includes('BEDN')) return 'BEDN'
    if (upper.includes('BDN')) return 'BDN'
    return 'BED'
  }
  if (upper.includes('MÜZİK')) return 'MÜZ'
  if (upper.includes('GÖRSEL')) return 'GÖRSE'
  if (upper.includes('BİLİŞİM')) {
    return upper.includes('TEKNOLOJ') ? 'BTK' : 'BİL.T'
  }
  if (upper.includes('TEKNOLOJ')) {
    if (upper.includes('TASARIM')) return 'TTAS'
    if (upper.includes('TEKTA')) return 'TEKTA'
    return 'TEKNO'
  }
  if (upper.includes('REHBERLİK')) return 'REH'
  if (upper.includes('İNKILAP') || upper.includes('İNK')) {
    return upper.includes('8') ? 'İNK8' : 'İNK'
  }

  // Varsayılan: ilk 6 karakter
  return upper.slice(0, 6)
}

// Öğretmen kısaltması (örn: "MUSTAFA GÜLMEZ" -> "M.G.")
export function getTeacherAbbreviation(teacherName: string): string {
  const parts = teacherName
    .trim()
    .split(/\s+/)
    .map((p) => p.toLocaleUpperCase('tr-TR'))
    .filter(Boolean)

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 3)
  return parts.map(p => p[0]).join('.') + '.'
}

// Saat dilimlerini formatla
export function formatTimeSlot(index: number, school: { dailyLessons?: number; lessonDuration?: number; breakDuration?: number }): string {
  const FIXED_SLOT_TIMES = ['08:40', '09:35', '10:35', '11:30', '13:10', '14:05', '15:00']
  if (index < FIXED_SLOT_TIMES.length) return FIXED_SLOT_TIMES[index]

  // Fallback hesaplama (uzarsa)
  const startHour = 8
  const startMinute = 40
  const lessonDuration = school.lessonDuration || 40
  const breakDuration = school.breakDuration || 10

  const totalMinutes = startHour * 60 + startMinute + index * (lessonDuration + breakDuration)
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60

  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}
