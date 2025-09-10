import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Subject } from './types'

const STORAGE_KEY = 'subjects'

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useSubjects() {
  const [subjects, setSubjects] = useLocalStorage<Subject[]>(STORAGE_KEY, [])

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

  return { subjects, add, update, remove, setSubjects }
}

