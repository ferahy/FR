import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Subject } from './types'

// v2 key to start with empty defaults (scoped to auth user)
const STORAGE_KEY = 'ferah_subjects_v2'

type SubjectTemplate = {
  name: string
  weeklyHoursByGrade: Record<string, number>
}

const DEFAULT_TEMPLATES: SubjectTemplate[] = [
  { name: 'Türkçe', weeklyHoursByGrade: { '5': 6, '6': 6, '7': 5, '8': 5 } },
  { name: 'Matematik', weeklyHoursByGrade: { '5': 5, '6': 5, '7': 5, '8': 5 } },
  { name: 'Fen', weeklyHoursByGrade: { '5': 4, '6': 4, '7': 4, '8': 4 } },
  { name: 'Sosyal', weeklyHoursByGrade: { '5': 3, '6': 3, '7': 3, '8': 0 } },
  { name: 'İngilizce', weeklyHoursByGrade: { '5': 3, '6': 3, '7': 4, '8': 4 } },
  { name: 'Din Kültürü', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 2, '8': 2 } },
  { name: 'Görsel Sanatlar', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1 } },
  { name: 'Müzik', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1 } },
  { name: 'Beden Eğitimi', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 2, '8': 2 } },
  { name: 'Bilişim', weeklyHoursByGrade: { '5': 2, '6': 2, '7': 0, '8': 0 } },
  { name: 'Teknoloji ve Tasarım', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 2, '8': 0 } },
  { name: 'İnkılap Tarihi', weeklyHoursByGrade: { '5': 0, '6': 0, '7': 0, '8': 2 } },
  { name: 'Rehberlik', weeklyHoursByGrade: { '5': 1, '6': 1, '7': 1, '8': 1 } },
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
      const isGorsel = tpl.name.toLowerCase().includes('görsel')
      const isMuzik = tpl.name.toLowerCase().includes('müzik')
      const isRehberlik = tpl.name.toLowerCase().includes('rehber')

      return {
        id: genId(),
        name: tpl.name,
        weeklyHoursByGrade: tpl.weeklyHoursByGrade,
        rule: {
          perDayMax: 2,
          maxConsecutive: 2,
          preferBlockScheduling: true, // Tüm dersler için blok yerleştirme açık
          avoidSlots: isGorsel || isMuzik ? ['S1'] : isRehberlik ? ['S1', 'S5'] : [], // Sanat dersleri ve rehberlik sabah ilk saatte değil
        },
      }
    })
    setSubjects(defaults)
  }, [setSubjects])

  return { subjects, add, update, remove, setSubjects, resetToDefaults }
}

// Not: Varsayılan dersler sadece "Varsayılan Dersleri Yükle" butonu ile eklenir; başlangıçta boş kalır.
