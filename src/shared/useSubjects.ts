import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Subject } from './types'

// v2 key to start with empty defaults (scoped to auth user)
const STORAGE_KEY = 'ferah_subjects_v2'

type SubjectTemplate = {
  name: string
  abbreviation: string
  weeklyHoursByGrade: Record<string, number>
}

const DEFAULT_TEMPLATES: SubjectTemplate[] = [
  { name: 'Türkçe', abbreviation: 'TURKC', weeklyHoursByGrade: { '5': 6, '6': 6, '7': 5, '8': 5 } },
  { name: 'Matematik', abbreviation: 'MAT', weeklyHoursByGrade: { '5': 5, '6': 5, '7': 5, '8': 5 } },
  { name: 'Fen Bilimleri', abbreviation: 'FEN B', weeklyHoursByGrade: { '5': 4, '6': 4, '7': 4, '8': 4 } },
  { name: 'Sosyal Bilgiler', abbreviation: 'SOS', weeklyHoursByGrade: { '5': 3, '6': 3, '7': 3, '8': 0 } },
  { name: 'İngilizce', abbreviation: 'İNG', weeklyHoursByGrade: { '5': 3, '6': 3, '7': 4, '8': 4 } },
  { name: 'DİKAB', abbreviation: 'DİN', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 2, '8': 2, 'Özel Eğitim': 0 } },
  { name: 'Görsel Sanatlar', abbreviation: 'GÖRSE', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1, 'Özel Eğitim': 0 } },
  { name: 'Müzik', abbreviation: 'MÜZ', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1, 'Özel Eğitim': 0 } },
  { name: 'Beden Eğitimi', abbreviation: 'BED', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 2, '8': 2, 'Özel Eğitim': 0 } },
  { name: 'Bilişim Teknolojileri', abbreviation: 'BİL.T', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 0, '8': 0 } },
  { name: 'Teknoloji ve Tasarım', abbreviation: 'TTAS', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 2, '8': 2 } },
  { name: 'İnkılap Tarihi', abbreviation: 'İNK', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 0, '8': 2 } },
  { name: 'Rehberlik ve Kariyer Planlama', abbreviation: 'REH', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1, 'Özel Eğitim': 0 } },
  // Seçmeli dersler
  { name: 'Seçmeli Masal ve Destanlar', abbreviation: 'S.M.D', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 0 } },
  { name: 'Seçmeli İngilizce', abbreviation: 'S.İNG', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 2, '8': 0 } },
  { name: 'Seçmeli Peygamberimizin Hayatı', abbreviation: 'S.P.H', weeklyHoursByGrade: { '5': 2, '6': 0, '7': 2, '8': 0 } },
  { name: 'Seçmeli KMY', abbreviation: 'S.KMY', weeklyHoursByGrade: { '5': 0, '6': 2, '7': 0, '8': 2 } },
  { name: 'Seçmeli Medya Okuryazarlığı', abbreviation: 'S.MED', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 0, '8': 2 } },
  { name: 'Seçmeli Spor ve Fiziki Etkinlikler', abbreviation: 'S.SFE', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 0, '8': 2 } },
  // Özel Eğitim
  { name: 'Özel Eğitim Din Kültürü', abbreviation: 'ÖEDK', weeklyHoursByGrade: { 'Özel Eğitim': 2 } },
  { name: 'Özel Eğitim Beden', abbreviation: 'ÖEBDN', weeklyHoursByGrade: { 'Özel Eğitim': 2 } },
  { name: 'Özel Eğitim Görsel Sanatlar', abbreviation: 'ÖEGS', weeklyHoursByGrade: { 'Özel Eğitim': 2 } },
  { name: 'Özel Eğitim Müzik', abbreviation: 'ÖEM', weeklyHoursByGrade: { 'Özel Eğitim': 2 } },
]

export const DEFAULT_SUBJECTS: Subject[] = [] // başlangıç boş; kullanıcı isterse doldurur

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useSubjects() {
  const [subjects, setSubjects] = useLocalStorage<Subject[]>(STORAGE_KEY, DEFAULT_SUBJECTS)

  const add = useCallback((s: Omit<Subject, 'id'>) => {
    const subject: Subject = { ...s, id: genId() }
    setSubjects((prev) => [...prev, subject])
    return subject
  }, [setSubjects])

  const update = useCallback((id: string, next: Omit<Subject, 'id'>) => {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...next, id } : s)))
  }, [setSubjects])

  const remove = useCallback((id: string) => {
    setSubjects((prev) => prev.filter((s) => s.id !== id))
  }, [setSubjects])

  const resetToDefaults = useCallback(() => {
    const defaults = DEFAULT_TEMPLATES.map((tpl) => {
      const lower = tpl.name.toLowerCase()
      const isRehberlik = lower.includes('rehber')
      const isBeden = lower.includes('beden')

      return {
        id: genId(),
        name: tpl.name,
        abbreviation: tpl.abbreviation,
        weeklyHoursByGrade: tpl.weeklyHoursByGrade,
        rule: {
          perDayMax: 0, // sınıfın ihtiyacını tamamlamak için gün başına sınır yok
          maxConsecutive: isBeden ? 3 : 3,
          preferBlockScheduling: isBeden || lower.includes('seçmeli'), // beden zorunlu, seçmeliler mümkünse blok
          avoidSlots: isRehberlik ? ['S1'] : [], // rehberlik ilk saat olmasın; diğerleri serbest
        },
      }
    })
    setSubjects(defaults)
  }, [setSubjects])

  return { subjects, add, update, remove, setSubjects, resetToDefaults }
}

// Not: Varsayılan dersler sadece "Varsayılan Dersleri Yükle" butonu ile eklenir; başlangıçta boş kalır.
