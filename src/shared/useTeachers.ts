import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Teacher } from './types'

const STORAGE_KEY = 'teachers'

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useTeachers() {
  const [teachers, setTeachers] = useLocalStorage<Teacher[]>(STORAGE_KEY, [])

  const add = useCallback((t: Omit<Teacher, 'id'>) => {
    const teacher: Teacher = { ...t, id: genId() }
    setTeachers((prev) => [...prev, teacher])
    return teacher
  }, [setTeachers])

  const update = useCallback((id: string, next: Omit<Teacher, 'id'>) => {
    setTeachers((prev) => prev.map((t) => (t.id === id ? { ...next, id } : t)))
  }, [setTeachers])

  const remove = useCallback((id: string) => {
    setTeachers((prev) => prev.filter((t) => t.id !== id))
  }, [setTeachers])

  return { teachers, add, update, remove, setTeachers }
}

