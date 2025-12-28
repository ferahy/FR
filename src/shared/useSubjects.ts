import { useCallback, useEffect, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Subject } from './types'

// v2 key to start with empty defaults (scoped to auth user)
const STORAGE_KEY = 'ferah_subjects_v2'

export const DEFAULT_SUBJECTS: Subject[] = buildDefaults()

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useSubjects() {
  const [subjects, setSubjects] = useLocalStorage<Subject[]>(STORAGE_KEY, DEFAULT_SUBJECTS)
  const seededRef = useRef(false)

  useEffect(() => {
    if (!seededRef.current && subjects.length === 0) {
      seededRef.current = true
      setSubjects(DEFAULT_SUBJECTS)
    }
  }, [subjects, setSubjects])

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
    setSubjects(DEFAULT_SUBJECTS.map((s) => ({ ...s, id: genId() })))
  }, [setSubjects])

  return { subjects, add, update, remove, setSubjects, resetToDefaults }
}

function buildDefaults(): Subject[] {
  const grades = ['5', '6', '7', '8']
  const mk = (name: string, hours: Record<string, number>): Subject => ({
    id: genId(),
    name,
    weeklyHoursByGrade: Object.fromEntries(grades.map((g) => [g, hours[g] ?? 0])),
    rule: {
      perDayMax: 2,
      maxConsecutive: 2,
    },
  })
  return [
    mk('Türkçe', { '5': 6, '6': 6, '7': 5, '8': 5 }),
    mk('Matematik', { '5': 5, '6': 5, '7': 5, '8': 5 }),
    mk('Fen', { '5': 4, '6': 4, '7': 4, '8': 4 }),
    mk('Sosyal', { '5': 3, '6': 3, '7': 3, '8': 0 }),
    mk('İngilizce', { '5': 3, '6': 3, '7': 4, '8': 4 }),
    mk('Din Kültürü', { '5': 2, '6': 2, '7': 2, '8': 2 }),
    mk('Görsel Sanatlar', { '5': 1, '6': 1, '7': 1, '8': 1 }),
    mk('Müzik', { '5': 1, '6': 1, '7': 1, '8': 1 }),
    mk('Beden Eğitimi', { '5': 2, '6': 2, '7': 2, '8': 2 }),
    mk('Bilişim', { '5': 2, '6': 2, '7': 0, '8': 0 }),
    mk('Teknoloji ve Tasarım', { '5': 0, '6': 0, '7': 2, '8': 0 }),
    mk('İnkılap Tarihi', { '5': 0, '6': 0, '7': 0, '8': 2 }),
    mk('Rehberlik', { '5': 0, '6': 0, '7': 0, '8': 1 }),
  ]
}
