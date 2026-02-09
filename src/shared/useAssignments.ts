import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { Assignments } from './types'

const STORAGE_KEY = 'ferah_assignments_v1'

export function useAssignments() {
  const [assignments, setAssignments] = useLocalStorage<Assignments>(STORAGE_KEY, {})

  // Atama yap: classKey (örn: "5-A"), subjectId, teacherId
  const assign = useCallback((classKey: string, subjectId: string, teacherId: string | null) => {
    const key = `${classKey}|${subjectId}`
    setAssignments(prev => {
      if (teacherId === null) {
        // Atamayı kaldır
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: teacherId }
    })
  }, [setAssignments])

  // Belirli bir sınıf ve ders için atanan öğretmeni getir
  const getAssignment = useCallback((classKey: string, subjectId: string): string | undefined => {
    return assignments[`${classKey}|${subjectId}`]
  }, [assignments])

  // Tüm atamaları sıfırla
  const resetAll = useCallback(() => {
    setAssignments({})
  }, [setAssignments])

  // Belirli bir öğretmenin kaç sınıfa atandığını say
  const countByTeacher = useCallback((teacherId: string): number => {
    return Object.values(assignments).filter(id => id === teacherId).length
  }, [assignments])

  return { assignments, assign, getAssignment, resetAll, countByTeacher, setAssignments }
}
