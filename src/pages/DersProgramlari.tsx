import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import type { Day, Teacher } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'
import { generateClassHandbookHTML, generateClassSheetHTML } from '../shared/htmlPdfGenerator'
import { getSubjectAbbreviation, getTeacherAbbreviation } from '../shared/pdfUtils'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

type Cell = { subjectId?: string; teacherId?: string }
type ClassKey = string // e.g. "5-A"

export default function DersProgramlari() {
  const school = useSchool()
  const gradeOptions = useGrades()
  const { subjects } = useSubjects()
  const { teachers } = useTeachers()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const classes = useMemo(() => buildClasses(school), [school])

  const [tables, setTables] = useLocalStorage<Record<ClassKey, Record<Day, Cell[]>>>('timetables', {})
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [showSheet, setShowSheet] = useState(false)
  const [requirementsGrade, setRequirementsGrade] = useState<string | null>(null)

  const handlePrintHandbooks = () => {
    // Generate HTML for all classes and open in new window
    const allHTML = classes
      .filter(c => tables[c.key]) // Only classes with schedules
      .map(c => generateClassHandbookHTML(
        c.key,
        tables[c.key],
        subjects,
        teachers,
        school.schoolName || 'Hasyurt Ortaokulu',
        school.principalName
      ))
      .join('<div style="page-break-after: always;"></div>')

    if (!allHTML) {
      alert('Ders programı bulunamadı. Önce programları oluşturun.')
      return
    }

    const newWindow = window.open('', '_blank')
    if (!newWindow) {
      alert('Pop-up engelleyici aktif. Lütfen bu site için pop-up\'lara izin verin.')
      return
    }

    newWindow.document.write(allHTML)
    newWindow.document.close()

    // Wait for content to load then print
    newWindow.onload = () => {
      setTimeout(() => {
        newWindow.print()
      }, 500)
    }
  }

  const handlePrintSheet = () => {
    // Generate HTML for all classes and open in new window
    const html = generateClassSheetHTML(
      tables,
      subjects,
      teachers,
      classes,
      school.schoolName || 'Hasyurt Ortaokulu',
      slots
    )

    if (!html) {
      alert('Ders programı bulunamadı. Önce programları oluşturun.')
      return
    }

    const newWindow = window.open('', '_blank')
    if (!newWindow) {
      alert('Pop-up engelleyici aktif. Lütfen bu site için pop-up\'lara izin verin.')
      return
    }

    newWindow.document.write(html)
    newWindow.document.close()

    // Wait for content to load then print
    newWindow.onload = () => {
      setTimeout(() => {
        newWindow.print()
      }, 500)
    }
  }

  const generate = () => {
    // Global state - tüm sınıflar için ortak
    const teacherLoad = new Map<string, number>()
    const teacherOccupied = new Map<string, Set<string>>() // teacherId -> Set("day-slot")

    // Her sınıf için tablo ve yardımcı veriler
    const workingTables: Record<ClassKey, Record<Day, Cell[]>> = {}
    const classSubjectTeacher: Record<ClassKey, Record<string, string>> = {} // class -> subject -> teacher
    const placedDays: Record<ClassKey, Record<string, Set<Day>>> = {} // class -> subject -> days
    const classGradeMap = new Map<string, string>(classes.map(c => [c.key, c.grade]))

    // Tabloları başlat
    for (const c of classes) {
      workingTables[c.key] = Object.fromEntries(
        DAYS.map(d => [d, Array.from({ length: slots.length }, () => ({}) as Cell)])
      ) as Record<Day, Cell[]>
      classSubjectTeacher[c.key] = {}
      placedDays[c.key] = {}
    }

    // Helper fonksiyonlar
    const isFree = (classKey: ClassKey, day: Day, si: number) =>
      !workingTables[classKey][day][si]?.subjectId

    const daySubjCount = (classKey: ClassKey, day: Day, subjId: string): number =>
      workingTables[classKey][day].filter(cell => cell.subjectId === subjId).length

    const placeCell = (classKey: ClassKey, day: Day, si: number, subjId: string, teacherId: string) => {
      workingTables[classKey][day][si] = { subjectId: subjId, teacherId }
      teacherLoad.set(teacherId, (teacherLoad.get(teacherId) ?? 0) + 1)
      if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
      teacherOccupied.get(teacherId)!.add(`${day}-${si}`)
      if (!placedDays[classKey][subjId]) placedDays[classKey][subjId] = new Set<Day>()
      placedDays[classKey][subjId].add(day)
      if (!classSubjectTeacher[classKey][subjId]) classSubjectTeacher[classKey][subjId] = teacherId
    }

    const findTeacherForSlot = (
      classKey: ClassKey,
      subjId: string,
      gradeId: string,
      day: Day,
      si: number,
      tryLocked = true
    ): string | undefined => {
      const locked = classSubjectTeacher[classKey][subjId]
      if (tryLocked && locked) {
        return pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, {
          commit: false, requiredTeacherId: locked, occupied: teacherOccupied
        })
      }
      return pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si, {
        commit: false, occupied: teacherOccupied
      })
    }

    const eligibleTeacherCount = (subjId: string, gradeId: string): number => {
      return teachers.filter(t => {
        const subs = getTeacherSubjectIds(t)
        if (!subs.includes(subjId)) return false
        const subjPref = t.preferredGradesBySubject?.[subjId]
        const prefGrades = (subjPref && subjPref.length ? subjPref : t.preferredGrades) ?? []
        if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
        return true
      }).length
    }

    // ═══════════════════════════════════════════════════════════════
    // TÜM DERSLERİ GLOBAL BİR HAVUZDA TOPLA
    // ═══════════════════════════════════════════════════════════════
    type GlobalLesson = {
      classKey: ClassKey
      gradeId: string
      subjId: string
      isBlock: boolean // Beden eğitimi bloğu mu?
    }

    const allLessons: GlobalLesson[] = []

    for (const c of classes) {
      const gradeId = c.grade
      for (const s of subjects) {
        const count = s.weeklyHoursByGrade[gradeId] ?? 0
        if (count <= 0) continue

        const prefersBlocks = prefersBlock(s, gradeId)
        const isBed = isMandatoryBlock(s, gradeId)
        // Ders saatini 2-2-1 gibi blok ve tekliye böl
        const blocks = prefersBlocks ? Math.floor(count / 2) : (isBed ? Math.floor(count / 2) : 0)
        const singles = count - blocks * 2
        for (let i = 0; i < blocks; i++) {
          allLessons.push({ classKey: c.key, gradeId, subjId: s.id, isBlock: true })
        }
        for (let i = 0; i < singles; i++) {
          allLessons.push({ classKey: c.key, gradeId, subjId: s.id, isBlock: false })
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // ÖNCELİK SIRALA: En kısıtlı dersler önce
    // ═══════════════════════════════════════════════════════════════
    allLessons.sort((a, b) => {
      // 1. Bloklar önce (2 slot birden lazım, daha kısıtlı)
      if (a.isBlock !== b.isBlock) return a.isBlock ? -1 : 1
      // 2. Çok saatli dersler önce (daha fazla yerleştirilecek)
      const ha = subjects.find(s => s.id === a.subjId)?.weeklyHoursByGrade[a.gradeId] ?? 0
      const hb = subjects.find(s => s.id === b.subjId)?.weeklyHoursByGrade[b.gradeId] ?? 0
      if (ha !== hb) return hb - ha
      // 3. Az öğretmeni olan dersler önce
      const ea = eligibleTeacherCount(a.subjId, a.gradeId)
      const eb = eligibleTeacherCount(b.subjId, b.gradeId)
      return ea - eb
    })

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Tüm dersleri yerleştir (yumuşak kısıtlarla)
    // ═══════════════════════════════════════════════════════════════
    const unplaced: GlobalLesson[] = []

    for (const lesson of allLessons) {
      const { classKey, gradeId, subjId, isBlock } = lesson
      const subject = subjects.find(s => s.id === subjId)!
      const rule = subject.rule

      type Candidate = { day: Day; si: number; teacherId: string; score: number }
      const candidates: Candidate[] = []

      for (const day of DAYS) {
        const currentDayCount = daySubjCount(classKey, day, subjId)
        const perDayMax = rule?.perDayMax ?? 2

        const slotsToCheck = isBlock ? slots.length - 1 : slots.length
        for (let si = 0; si < slotsToCheck; si++) {
          // Slot boş mu?
          if (!isFree(classKey, day, si)) continue
          if (isBlock && !isFree(classKey, day, si + 1)) continue

          // Avoid slots kontrolü
          if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue
          if (isBlock && rule?.avoidSlots?.includes(`S${si + 2}`)) continue

          // Günlük max kontrolü
          const adding = isBlock ? 2 : 1
          if (perDayMax > 0 && currentDayCount + adding > perDayMax) continue

          // minDays: farklı günlere yayılmayı zorla
          const minDays = rule?.minDays ?? 0
          if (!isBlock && minDays > 0) {
            const placedUnique = placedDays[classKey][subjId]?.size ?? 0
            const alreadyThisDay = placedDays[classKey][subjId]?.has(day)
            if (!alreadyThisDay && placedUnique < minDays - 1 && currentDayCount > 0) continue
          }

          // maxConsecutive kontrolü (blok için skip)
          if (!isBlock) {
            const maxConsec = rule?.maxConsecutive ?? 2
            if (maxConsec > 0) {
              let backward = 0
              for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
              let forward = 0
              for (let k = si + 1; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
              if (backward + 1 + forward > maxConsec) continue
            }

            // Aynı gün iki ders varsa bitişik olmalı
            const sameDaySlots = workingTables[classKey][day]
              .map((c, idx) => (c.subjectId === subjId ? idx : -1))
              .filter(idx => idx >= 0)
            if (sameDaySlots.length > 0) {
              const isAdjacent = sameDaySlots.some(idx => Math.abs(idx - si) === 1)
              if (!isAdjacent) continue
            }
          }

          // Öğretmen bul
          let teacherId: string | undefined
          if (isBlock) {
            const t1 = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!t1) continue
            const t2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, {
              commit: false, requiredTeacherId: t1, occupied: teacherOccupied
            })
            if (t1 !== t2) continue
            teacherId = t1
          } else {
            teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
          }
          if (!teacherId) continue

          // Skor hesapla
          let score = 0
          // Yayılma bonusu (farklı günlere dağıt)
          if (!placedDays[classKey][subjId]?.has(day)) score += 50
          // Bitişiklik bonusu
          if (!isBlock) {
            if (si > 0 && workingTables[classKey][day][si - 1]?.subjectId === subjId) score += 30
            if (si + 1 < slots.length && workingTables[classKey][day][si + 1]?.subjectId === subjId) score += 30
          }
          // Ana dersleri sabaha koy
          const isMain = ['TÜRKÇE', 'MATEMATİK', 'FEN', 'SOSYAL', 'İNGİLİZCE'].some(
            n => subject.name.toLocaleUpperCase('tr-TR').includes(n)
          )
          if (isMain && si < 4) score += 15

          candidates.push({ day, si, teacherId, score })
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score)
        const best = candidates[0]
        placeCell(classKey, best.day, best.si, subjId, best.teacherId)
        if (isBlock) {
          placeCell(classKey, best.day, best.si + 1, subjId, best.teacherId)
        }
      } else {
        unplaced.push(lesson)
      }
    }

    const canPlaceWithRules = (
      classKey: ClassKey,
      day: Day,
      si: number,
      subjId: string,
      isBlock: boolean
    ) => {
      const subject = subjects.find(s => s.id === subjId)
      const rule = subject?.rule
      const addCount = isBlock ? 2 : 1

      const currentDayCount = daySubjCount(classKey, day, subjId)
      const perDayMax = rule?.perDayMax ?? 0
      if (perDayMax > 0 && currentDayCount + addCount > perDayMax) return false

      // minDays: aynı güne yığılmayı engelle
      const minDays = rule?.minDays ?? 0
      if (minDays > 0) {
        const placedUnique = placedDays[classKey][subjId]?.size ?? 0
        const alreadyThisDay = placedDays[classKey][subjId]?.has(day)
        if (!alreadyThisDay && placedUnique < minDays - 1 && currentDayCount > 0) {
          // minDays sağlanana kadar aynı güne ikinci dersi koyma
          return false
        }
      }

      // maxConsecutive / aynı gün 2 dersse bitişik olmalı
      if (!isBlock) {
        const maxConsec = rule?.maxConsecutive ?? 0
        if (maxConsec > 0) {
          let backward = 0
          for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
          let forward = 0
          for (let k = si + 1; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
          if (backward + 1 + forward > maxConsec) return false
        }

        const sameDaySlots = workingTables[classKey][day]
          .map((c, idx) => (c.subjectId === subjId ? idx : -1))
          .filter(idx => idx >= 0)
        if (sameDaySlots.length > 0) {
          const isAdjacent = sameDaySlots.some(idx => Math.abs(idx - si) === 1)
          if (!isAdjacent) return false
        }
      }

      // avoidSlots kontrolü
      const slotLabel = `S${si + 1}`
      if (rule?.avoidSlots?.includes(slotLabel)) return false
      if (isBlock && rule?.avoidSlots?.includes(`S${si + 2}`)) return false

      return true
    }

    const recomputeSubjectDays = (classKey: ClassKey, subjId: string) => {
      const days = new Set<Day>()
      for (const d of DAYS) {
        if (workingTables[classKey][d].some(c => c.subjectId === subjId)) days.add(d)
      }
      placedDays[classKey][subjId] = days
    }

    const tryRelocateSingle = (classKey: ClassKey, day: Day, si: number): boolean => {
      const current = workingTables[classKey][day][si]
      if (!current?.subjectId || !current.teacherId) return false
      const subjId = current.subjectId
      const teacherId = current.teacherId
      // Blok dersin parçasına dokunma
      const sameDay = workingTables[classKey][day]
      if (si + 1 < sameDay.length && sameDay[si + 1]?.subjectId === subjId && sameDay[si + 1]?.teacherId === teacherId) return false
      if (si - 1 >= 0 && sameDay[si - 1]?.subjectId === subjId && sameDay[si - 1]?.teacherId === teacherId) return false

      const teacher = teachers.find(t => t.id === teacherId)

      for (const d2 of DAYS) {
        for (let s2 = 0; s2 < slots.length; s2++) {
          if (d2 === day && s2 === si) continue
          if (!isFree(classKey, d2, s2)) continue
          if (!canPlaceWithRules(classKey, d2, s2, subjId, false)) continue

          const occKey = `${d2}-${s2}`
          if (teacherOccupied.get(teacherId)?.has(occKey)) continue
          const blocked = teacher?.unavailable?.[d2]?.includes(`S${s2 + 1}`)
          if (blocked) continue

          // move
          workingTables[classKey][d2][s2] = current
          workingTables[classKey][day][si] = {}
          teacherOccupied.get(teacherId)?.delete(`${day}-${si}`)
          if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
          teacherOccupied.get(teacherId)!.add(occKey)
          recomputeSubjectDays(classKey, subjId)
          return true
        }
      }
      return false
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Yerleşemeyenler için kısıtları gevşet
    // ═══════════════════════════════════════════════════════════════
    const stillUnplaced: GlobalLesson[] = []

    for (const lesson of unplaced) {
      const { classKey, subjId, isBlock } = lesson
      let placed = false
      const gradeId = classGradeMap.get(classKey) ?? ''

      // Blok dersi önce blok olarak, kısıtları esneterek dene
      if (isBlock && !placed) {
        const subj = subjects.find(s => s.id === subjId)
        const rule = subj?.rule
        for (const day of DAYS) {
          if (placed) break
          for (let si = 0; si < slots.length - 1; si++) {
            if (!isFree(classKey, day, si) || !isFree(classKey, day, si + 1)) continue
            if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue
            if (rule?.avoidSlots?.includes(`S${si + 2}`)) continue
            const t1 = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!t1) continue
            const t2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, {
              commit: false, requiredTeacherId: t1, occupied: teacherOccupied
            })
            if (t1 !== t2 || !t2) continue
            placeCell(classKey, day, si, subjId, t1)
            placeCell(classKey, day, si + 1, subjId, t1)
            placed = true
            break
          }
        }
      }

      // Blokları tekli olarak dene (kurallara uyarak)
      if (isBlock && !placed) {
        let placedCount = 0
        for (let needed = 0; needed < 2 && !placed; needed++) {
          for (const day of DAYS) {
            if (placedCount >= 2) break
            for (let si = 0; si < slots.length; si++) {
              if (!isFree(classKey, day, si)) continue
              if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
              const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, false)
              if (!teacherId) continue
              placeCell(classKey, day, si, subjId, teacherId)
              placedCount++
              if (placedCount >= 2) { placed = true; break }
              break
            }
          }
        }
        if (!placed && placedCount < 2) {
          for (let i = placedCount; i < 2; i++) {
            stillUnplaced.push({ ...lesson, isBlock: false })
          }
        }
      } else {
        // Tek ders - herhangi bir boş slota koy
        for (const day of DAYS) {
          if (placed) break
          for (let si = 0; si < slots.length; si++) {
            if (!isFree(classKey, day, si)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
            let teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, true)
            if (!teacherId) teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, false)
            if (!teacherId) continue
            placeCell(classKey, day, si, subjId, teacherId)
            placed = true
            break
          }
        }
        if (!placed) stillUnplaced.push(lesson)
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Son çare - kuralları gevşetmeden son deneme
    // ═══════════════════════════════════════════════════════════════
    const finalUnplaced: GlobalLesson[] = []
    for (const lesson of stillUnplaced) {
      const { classKey, subjId } = lesson
      let placedHere = false

      // Herhangi bir boş slot, herhangi bir öğretmen (hala kurallara uy)
      for (const day of DAYS) {
        if (placedHere) break
        for (let si = 0; si < slots.length; si++) {
          if (!isFree(classKey, day, si)) continue
          if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue

          const eligibleTeachers = teachers.filter(t => {
            const subs = getTeacherSubjectIds(t)
            if (!subs.includes(subjId)) return false
            const slotKey = `${day}-${si}`
            if (teacherOccupied.get(t.id)?.has(slotKey)) return false
            const blocked = t.unavailable?.[day]?.includes(`S${si + 1}`)
            if (blocked) return false
            return true
          })

          if (eligibleTeachers.length > 0) {
            eligibleTeachers.sort((a, b) => (teacherLoad.get(a.id) ?? 0) - (teacherLoad.get(b.id) ?? 0))
            const teacherId = eligibleTeachers[0].id
            placeCell(classKey, day, si, subjId, teacherId)
            placedHere = true
            break
          }
        }
      }

      if (!placedHere) finalUnplaced.push(lesson)
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Full relax - kuralları esnet, boş kalmasın
    // ═══════════════════════════════════════════════════════════════
    for (const lesson of finalUnplaced) {
      const { classKey, subjId, isBlock } = lesson
      let placedHere = false

      for (const day of DAYS) {
        if (placedHere) break
        const slotsToCheck = isBlock ? slots.length - 1 : slots.length
        for (let si = 0; si < slotsToCheck; si++) {
          let slotFree = isFree(classKey, day, si)
          let slot2Free = !isBlock || isFree(classKey, day, si + 1)

          // Mümkünse mevcut dersi kaydırarak boşluk aç
          if (!slotFree) slotFree = tryRelocateSingle(classKey, day, si)
          if (isBlock && !slot2Free) slot2Free = tryRelocateSingle(classKey, day, si + 1)
          if (!slotFree || (isBlock && !slot2Free)) continue

          const eligibleTeachers = teachers.filter(t => {
            const subs = getTeacherSubjectIds(t)
            if (!subs.includes(subjId)) return false
            const slotKey1 = `${day}-${si}`
            const slotKey2 = `${day}-${si + 1}`
            if (teacherOccupied.get(t.id)?.has(slotKey1)) return false
            if (isBlock && teacherOccupied.get(t.id)?.has(slotKey2)) return false
            const blocked1 = t.unavailable?.[day]?.includes(`S${si + 1}`)
            const blocked2 = isBlock ? t.unavailable?.[day]?.includes(`S${si + 2}`) : false
            if (blocked1 || blocked2) return false
            return true
          })

          if (!eligibleTeachers.length) continue
          eligibleTeachers.sort((a, b) => (teacherLoad.get(a.id) ?? 0) - (teacherLoad.get(b.id) ?? 0))
          const teacherId = eligibleTeachers[0].id
          placeCell(classKey, day, si, subjId, teacherId)
          if (isBlock) placeCell(classKey, day, si + 1, subjId, teacherId)
          placedHere = true
          break
        }
      }
    }

    setTables(workingTables)
  }

  const classesToShow = useMemo(() => classes.filter(c => gradeFilter === 'all' ? true : c.grade === gradeFilter), [classes, gradeFilter])
  const grouped = useMemo(() => {
    const map = new Map<string, typeof classes>()
    for (const c of classesToShow) {
      if (!map.has(c.grade)) map.set(c.grade, [])
      map.get(c.grade)!.push(c)
    }
    return Array.from(map.entries()).sort((a,b) => Number(a[0]) - Number(b[0]))
  }, [classesToShow])

  const classDeficits = useMemo(() => {
    if (!Object.keys(tables ?? {}).length) return []
    return classes.map(c => {
      const def = calculateDeficits(c, tables[c.key], subjects)
      return { classKey: c.key, deficits: def }
    }).filter(item => item.deficits.length > 0)
  }, [classes, subjects, tables])
  const totalDeficits = classDeficits.reduce((sum, item) => sum + item.deficits.length, 0)

  return (
    <>
      <div className="topbar glass p-6" style={{ justifyContent: 'space-between', gap: 12 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">Sınıf Filtresi</span>
          <select className="select" value={gradeFilter} onChange={(e)=> setGradeFilter(e.target.value)}>
            <option value="all">Hepsi</option>
            {gradeOptions.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => setShowSheet(true)} disabled={!Object.keys(tables ?? {}).length}>Çarşaf Görünüm</button>
          <button className="btn btn-outline" onClick={handlePrintHandbooks} disabled={!Object.keys(tables ?? {}).length}>📄 Sınıf El PDF</button>
          <button className="btn btn-outline" onClick={handlePrintSheet} disabled={!Object.keys(tables ?? {}).length}>📊 Sınıf Çarşaf PDF</button>
          <button className="btn btn-primary" onClick={generate}>Programları Oluştur</button>
        </div>
      </div>

      <div className="timetable-sections">
        {grouped.map(([gradeId, list]) => (
          <div key={gradeId} className="grade-section">
            <div className="grid-timetables">
              {list.map((c) => (
                <div key={c.key} className="timetable glass">
                  <div className="timetable-head">
                    <div className="title">{c.grade}. Sınıf — {c.section}</div>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => setRequirementsGrade(c.grade)}>
                        Zorunlu Dersler
                      </button>
                      {tables[c.key] && <div className="tt-status" aria-label="Oluşturuldu">Oluşturuldu</div>}
                    </div>
                  </div>
                  <div className="timetable-body">
                    <table className="tt">
                      <thead>
                        <tr>
                          <th>Gün</th>
                          {slots.map((s) => (
                            <th key={s}>{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map((d) => (
                          <tr key={d}>
                            <td className="day">{d}</td>
                            {slots.map((_, si) => {
                              const cell = tables[c.key]?.[d]?.[si]
                              const subj = subjects.find(s => s.id === cell?.subjectId)
                              const teacher = teachers.find(t => t.id === cell?.teacherId)
                              return (
                                <td key={c.key + d + si} className="slot">
                                  {cell?.subjectId ? (
                                    <div className="slot-pill" title={`${subj?.name} — ${teacher ? teacher.name : 'Atanmadı'}`}>
                                      <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{getSubjectAbbreviation(subj?.name || '', subj?.abbreviation)}</span>
                                      <span className="s-teacher">{teacher ? getTeacherAbbreviation(teacher.name) : '—'}</span>
                                    </div>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile-friendly accordion per day */}
                    <div className="tt-accordion">
                      {DAYS.map((d) => (
                        <details key={d} className="tt-acc-day">
                          <summary className="tt-acc-summary">{d}</summary>
                          <div className="tt-acc-slots">
                            {slots.map((_, si) => {
                              const cell = tables[c.key]?.[d]?.[si]
                              const subj = subjects.find(s => s.id === cell?.subjectId)
                              const teacher = teachers.find(t => t.id === cell?.teacherId)
                              return (
                                <div key={c.key + d + 'a' + si} className="acc-slot">
                                  <div className="acc-slot-left">S{si + 1}</div>
                                  {cell?.subjectId ? (
                                    <div className="acc-slot-main">
                                      <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{subj?.name}</span>
                                      <span className="s-teacher">{teacher ? teacher.name : '—'}</span>
                                    </div>
                                  ) : (
                                    <div className="acc-slot-empty muted">—</div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {classDeficits.length > 0 && (
        <div className="muted" style={{ marginTop: 16, fontSize: 12, lineHeight: 1.4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Eksik Dersler ({totalDeficits})</div>
          {classDeficits.map(item => (
            <div key={item.classKey} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{item.classKey}:</span>{' '}
              {item.deficits.map(d => `${d.name} (${d.missing})`).join(', ')}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!requirementsGrade} onClose={() => setRequirementsGrade(null)} title={`${requirementsGrade ?? ''}. Sınıf Zorunlu Ders Saatleri`}>
        {requirementsGrade ? (
          (() => {
            const required = getRequiredSubjectsForGrade(subjects, requirementsGrade)
            if (!required.length) return <div className="muted">Bu sınıf için zorunlu ders bilgisi yok.</div>
            const total = required.reduce((sum, r) => sum + r.hours, 0)
            return (
              <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 1.4, listStyle: 'disc' }}>
                {required.map(item => (
                  <li key={item.id}>{item.name}: {item.hours} saat</li>
                ))}
                <li style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)', fontWeight: 600 }}>
                  Toplam: {total} saat
                </li>
              </ul>
            )
          })()
        ) : (
          <div className="muted">Bu sınıf için zorunlu ders bilgisi tanımlı değil.</div>
        )}
      </Modal>

      {showSheet && (
        <div className="sheet-overlay">
          <div className="sheet-backdrop" onClick={() => setShowSheet(false)} />
          <div className="sheet-panel glass">
            <div className="sheet-head">
              <div>
                <div className="title" style={{ margin: 0 }}>{school.schoolName || 'Hasyurt Ortaokulu'} - SINIFLARIN HAFTALIK DERS PROGRAMI</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => window.print()}>Yazdır / PDF</button>
                <button className="btn btn-danger btn-sm" onClick={() => setShowSheet(false)}>Kapat</button>
              </div>
            </div>
            <div className="sheet-body">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sheet-class-head">Sınıf</th>
                    {DAYS.map((d) => (
                      <th key={d} colSpan={slots.length} className="sheet-day-head">{d}</th>
                    ))}
                  </tr>
                  <tr>
                    {DAYS.map((d) =>
                      slots.map((s) => <th key={d + s} className="sheet-slot-head">{s.replace('S', '')}</th>)
                    )}
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.key}>
                      <td className="sheet-class">{c.grade}. Sınıf {c.section}</td>
                      {DAYS.map((d) =>
                        slots.map((_, si) => {
                          const cell = tables[c.key]?.[d]?.[si]
                          if (!cell?.subjectId) {
                            return <td key={c.key + d + si} className="sheet-empty">—</td>
                          }
                          const subj = subjects.find((s) => s.id === cell.subjectId)
                          const teacher = teachers.find((t) => t.id === cell.teacherId)
                          return (
                            <td key={c.key + d + si} className="sheet-slot">
                              <div className="sheet-pill" title={`${subj?.name || ''} ${teacher?.name ? '— ' + teacher.name : ''}`}>
                                <div className="sheet-text">
                                  <div className="sheet-subj">{getSubjectAbbreviation(subj?.name || '', subj?.abbreviation)}</div>
                                  {teacher?.name && <div className="sheet-teacher">{getTeacherAbbreviation(teacher.name)}</div>}
                                </div>
                              </div>
                            </td>
                          )
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

function buildClasses(school: ReturnType<typeof useSchool>): { key: ClassKey; grade: string; section: string }[] {
  const out: { key: ClassKey; grade: string; section: string }[] = []
  for (const g of school.grades) {
    for (const s of g.sections) out.push({ key: `${g.grade}-${s}`, grade: g.grade, section: s })
  }
  return out
}

function isMandatoryBlock(subject: ReturnType<typeof useSubjects>['subjects'][number], gradeId: string): boolean {
  const hours = subject.weeklyHoursByGrade[gradeId] ?? 0
  if (hours < 2) return false
  // Sadece Beden Eğitimi kesin blok olmalı
  const name = subject.name.toLocaleUpperCase('tr-TR')
  return name.includes('BEDEN')
}

function prefersBlock(subject: ReturnType<typeof useSubjects>['subjects'][number], gradeId: string): boolean {
  const hours = subject.weeklyHoursByGrade[gradeId] ?? 0
  if (hours < 2) return false
  // Blok tercih eden dersler (zorunlu değil, mümkünse)
  return subject.rule?.preferBlockScheduling ?? false
}

function calculateDeficits(
  c: { key: string; grade: string; section: string },
  schedule: Record<Day, Cell[]> | undefined,
  subjects: ReturnType<typeof useSubjects>['subjects']
): { name: string; missing: number }[] {
  const required = getRequiredSubjectsForGrade(subjects, c.grade)
  if (!required.length) return []

  const counts: Record<string, number> = {}
  if (schedule) {
    DAYS.forEach(day => {
      schedule[day]?.forEach(cell => {
        if (!cell?.subjectId) return
        counts[cell.subjectId] = (counts[cell.subjectId] ?? 0) + 1
      })
    })
  }

  return required
    .map(req => {
      const current = counts[req.id] ?? 0
      return { name: req.name, missing: req.hours - current }
    })
    .filter(d => d.missing > 0)
}

function getRequiredSubjectsForGrade(
  subjects: ReturnType<typeof useSubjects>['subjects'],
  gradeId: string
): { id: string; name: string; hours: number }[] {
  return subjects
    .map((s) => ({
      id: s.id,
      name: s.name,
      hours: s.weeklyHoursByGrade[gradeId] ?? 0,
    }))
    .filter((s) => s.hours > 0)
}

function pickTeacher(teachers: Teacher[], load: Map<string, number>, subjectId: string, gradeId: string, day: Day, slotIndex: number, opts?: { commit?: boolean; requiredTeacherId?: string; occupied?: Map<string, Set<string>> }): string | undefined {
  const commit = opts?.commit ?? true
  const requiredTeacherId = opts?.requiredTeacherId
  const occupied = opts?.occupied

  const slotKey = `${day}-${slotIndex}`

  const choices = teachers.filter(t => {
    // If a specific teacher is required, only consider that teacher
    if (requiredTeacherId && t.id !== requiredTeacherId) return false

    const subs = getTeacherSubjectIds(t)
    if (!subs.includes(subjectId)) return false
    // preferred grades check
    const subjPref = t.preferredGradesBySubject?.[subjectId]
    const prefGrades = (subjPref && subjPref.length ? subjPref : t.preferredGrades) ?? []
    if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
    // availability
    const blocked = t.unavailable?.[day]?.includes(`S${slotIndex + 1}`)
    if (blocked) return false
    // max hours
    const cur = load.get(t.id) ?? 0
    if (t.maxHours && cur >= t.maxHours) return false
    // Check if teacher is already teaching another class at this time
    if (occupied && occupied.get(t.id)?.has(slotKey)) return false
    return true
  })
  if (choices.length === 0) return undefined
  // Prefer least-loaded teacher for balanced distribution
  choices.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))
  const pick = choices[0]
  if (commit) {
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1)
    // Mark teacher as occupied at this time slot
    if (occupied) {
      if (!occupied.has(pick.id)) occupied.set(pick.id, new Set())
      occupied.get(pick.id)!.add(slotKey)
    }
  }
  return pick.id
}

// shortName removed (show full name under subject)

function getTeacherSubjectIds(t: Teacher): string[] {
  if (t.subjectIds && t.subjectIds.length) return t.subjectIds
  if (t.subjectId) return [t.subjectId]
  return []
}
