import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import { useAssignments } from '../shared/useAssignments'
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
  const { assignments } = useAssignments()

  const slots = useMemo(() => Array.from({ length: Math.max(1, school.dailyLessons || 1) }, (_, i) => `S${i + 1}`), [school.dailyLessons])
  const classes = useMemo(() => buildClasses(school), [school])

  const [tables, setTables] = useLocalStorage<Record<ClassKey, Record<Day, Cell[]>>>('timetables', {})
  const [lockedTeachers] = useLocalStorage<string[]>('lockedTeachers', [])
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [showSheet, setShowSheet] = useState(false)
  const [requirementsGrade, setRequirementsGrade] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStart, setGenerationStart] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [triedCount, setTriedCount] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [bestMissing, setBestMissing] = useState(0)
  const [totalReqState, setTotalReqState] = useState(0)
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string; duration: number } | null>(null)
  const stopRef = useRef(false)

  const stopGeneration = () => {
    stopRef.current = true
  }

  // Son sonucu 8 saniye sonra gizle
  useEffect(() => {
    if (lastResult) {
      const timer = window.setTimeout(() => setLastResult(null), 8000)
      return () => window.clearTimeout(timer)
    }
  }, [lastResult])

  // İlerleme çubuğu: saniyeye göre gider (0-600s)
  useEffect(() => {
    let timer: number | undefined
    const tick = () => {
      if (isGenerating && generationStart != null) {
        const elapsed = (performance.now() - generationStart) / 1000
        setProgress(Math.min(1, elapsed / 600))
        setElapsedTime(Math.floor(elapsed))
      } else {
        setElapsedTime(0)
      }
      timer = window.setTimeout(tick, 250)
    }
    tick()
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [isGenerating, generationStart])

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

  const makeRng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  const shuffleInPlace = <T,>(arr: T[], rng: () => number) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  const runOnce = (seed: number) => {
    const rng = makeRng(seed)
    const dayOrder = shuffleInPlace([...DAYS], rng)
    const slotOrder = shuffleInPlace(Array.from({ length: slots.length }, (_, i) => i), rng)

    // Global state - tüm sınıflar için ortak
    const teacherLoad = new Map<string, number>()
    const teacherOccupied = new Map<string, Set<string>>() // teacherId -> Set("day-slot")
    // Bir öğretmenin aynı sınıfa günde kaç kez girdiği (max 3)
    const teacherClassDayCount = new Map<string, number>() // "teacherId|classKey|day" -> count

    // Her sınıf için tablo ve yardımcı veriler
    const workingTables: Record<ClassKey, Record<Day, Cell[]>> = {}
    const classSubjectTeacher: Record<ClassKey, Record<string, string>> = {} // class -> subject -> teacher
    const placedDays: Record<ClassKey, Record<string, Set<Day>>> = {} // class -> subject -> days
    const classGradeMap = new Map<string, string>(classes.map(c => [c.key, c.grade]))

    // Aynı sınıf seviyesinde aynı ders için farklı şubelere farklı öğretmen atamak için
    // gradeId-subjectId -> Set<teacherId> (bu kombinasyonda hangi öğretmenler zaten atandı)
    const gradeSubjectAssignedTeachers = new Map<string, Set<string>>()

    // ═══════════════════════════════════════════════════════════════
    // SIFIRDAN BAŞLA - Her seferinde temiz tablo ile oluştur
    // ═══════════════════════════════════════════════════════════════
    for (const c of classes) {
      workingTables[c.key] = Object.fromEntries(
        DAYS.map(d => [d, Array.from({ length: slots.length }, () => ({}) as Cell)])
      ) as Record<Day, Cell[]>
      classSubjectTeacher[c.key] = {}
      placedDays[c.key] = {}
    }

    // Branş başına “explicit tercih listesi var mı?” haritası
    const subjectHasExplicitPrefs = new Map<string, boolean>()
    teachers.forEach(t => {
      if (t.preferredGradesBySubject) {
        Object.entries(t.preferredGradesBySubject).forEach(([subjId, arr]) => {
          // Bu branş için explicit tercih tanımlanmışsa (boş bile olsa) işaretle
          if (Array.isArray(arr)) subjectHasExplicitPrefs.set(subjId, true)
        })
      }
    })

    const filterAllowedTeachers = (list: typeof teachers, subjId: string, gradeId: string) => {
      const hasExplicit = subjectHasExplicitPrefs.get(subjId) ?? false
      return list.filter(t => {
        const subs = getTeacherSubjectIds(t)
        if (!subs.includes(subjId)) return false
        const hasSubjectPref = t.preferredGradesBySubject && Object.prototype.hasOwnProperty.call(t.preferredGradesBySubject, subjId)
        if (hasExplicit) {
          if (!hasSubjectPref) return false
          const subjPref = t.preferredGradesBySubject?.[subjId] ?? []
          if (!subjPref.includes(gradeId)) return false
        } else {
          const subjPref = hasSubjectPref ? t.preferredGradesBySubject?.[subjId] ?? [] : undefined
          if (subjPref && subjPref.length > 0) {
            if (!subjPref.includes(gradeId)) return false
          } else {
            const prefGrades = t.preferredGrades ?? []
            if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
          }
        }
        return true
      })
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
      // Öğretmenin bu sınıfa bu gün kaç kez girdiğini artır
      const tcdKey = `${teacherId}|${classKey}|${day}`
      teacherClassDayCount.set(tcdKey, (teacherClassDayCount.get(tcdKey) ?? 0) + 1)
      if (!placedDays[classKey][subjId]) placedDays[classKey][subjId] = new Set<Day>()
      placedDays[classKey][subjId].add(day)
      if (!classSubjectTeacher[classKey][subjId]) {
        classSubjectTeacher[classKey][subjId] = teacherId
        // Bu sınıf seviyesi + ders için öğretmeni kaydet
        const gradeId = classGradeMap.get(classKey) ?? ''
        const gsKey = `${gradeId}|${subjId}`
        if (!gradeSubjectAssignedTeachers.has(gsKey)) {
          gradeSubjectAssignedTeachers.set(gsKey, new Set())
        }
        gradeSubjectAssignedTeachers.get(gsKey)!.add(teacherId)
      }
    }

    const teacherRandom = new Map(teachers.map(t => [t.id, rng()]))

    // Atama tablosundan öğretmen al
    const getAssignedTeacher = (classKey: ClassKey, subjId: string): string | undefined => {
      return assignments[`${classKey}|${subjId}`]
    }

    const findTeacherForSlot = (
      classKey: ClassKey,
      subjId: string,
      gradeId: string,
      day: Day,
      si: number,
      opts?: { tryLocked?: boolean }
    ): string | undefined => {
      const tryLocked = opts?.tryLocked ?? true

      // ÖNCELİK 1: Atama tablosundan öğretmen kontrolü
      const assignedTeacherId = getAssignedTeacher(classKey, subjId)
      if (assignedTeacherId) {
        // Atanmış öğretmen var, sadece onu kullan
        const assignedTeacher = teachers.find(t => t.id === assignedTeacherId)
        if (assignedTeacher) {
          // Müsaitlik kontrolü
          const slotLabel = `S${si + 1}`
          const isUnavailable = assignedTeacher.unavailable?.[day]?.includes(slotLabel)
          if (isUnavailable) return undefined

          // Başka sınıfta mı?
          const slotKey = `${day}-${si}`
          if (teacherOccupied.get(assignedTeacherId)?.has(slotKey)) return undefined

          // Max saat kontrolü
          const curLoad = teacherLoad.get(assignedTeacherId) ?? 0
          if (assignedTeacher.maxHours && curLoad >= assignedTeacher.maxHours) return undefined

          // Aynı sınıfa günde max 3 ders kontrolü
          const tcdKey = `${assignedTeacherId}|${classKey}|${day}`
          if ((teacherClassDayCount.get(tcdKey) ?? 0) >= 3) return undefined

          return assignedTeacherId
        }
      }

      // ÖNCELİK 2: Daha önce bu sınıf-ders için atanmış öğretmen (session içinde)
      const pool = filterAllowedTeachers(teachers, subjId, gradeId)
      const locked = classSubjectTeacher[classKey][subjId]
      if (tryLocked && locked) {
        return pickTeacher(pool, teacherLoad, subjId, gradeId, day, si, {
          commit: false, requiredTeacherId: locked, occupied: teacherOccupied, randomByTeacher: teacherRandom,
          classKey, teacherClassDayCount,
        })
      }

      // ÖNCELİK 3: Aynı sınıf seviyesinde farklı şubelere farklı öğretmen atamaya zorla
      const gsKey = `${gradeId}|${subjId}`
      const alreadyAssigned = gradeSubjectAssignedTeachers.get(gsKey)
      const totalEligible = pool.length
      const assignedCount = alreadyAssigned?.size ?? 0

      // Eğer birden fazla uygun öğretmen varsa, henüz atanmamış olanı zorunlu kıl
      if (totalEligible > assignedCount) {
        const unassignedPool = pool.filter(t => !alreadyAssigned?.has(t.id))
        if (unassignedPool.length === 0) {
          // henüz kullanılmamış kimse kalmadı, ama teoride olmamalı
          return undefined
        }
        const result = pickTeacher(unassignedPool, teacherLoad, subjId, gradeId, day, si, {
          commit: false, occupied: teacherOccupied, randomByTeacher: teacherRandom,
          classKey, teacherClassDayCount,
        })
        if (result) return result
        // hiçbiri uygun slot bulamadıysa bu adımda yerleştirmeyi iptal et
        return undefined
      }

      return pickTeacher(pool, teacherLoad, subjId, gradeId, day, si, {
        commit: false, occupied: teacherOccupied, randomByTeacher: teacherRandom,
        classKey, teacherClassDayCount,
      })
    }

    const eligibleTeacherCount = (subjId: string, gradeId: string): number => {
      return filterAllowedTeachers(teachers, subjId, gradeId).length
    }

    const capacityBySubjectGrade = new Map<string, number>()
    const scarcityBySubjectGrade = new Map<string, number>()
    const computeTeacherCapacity = (t: Teacher) => {
      const unavailableCount = DAYS.reduce((sum, d) => sum + (t.unavailable?.[d]?.length ?? 0), 0)
      const totalSlots = DAYS.length * slots.length
      const availableSlots = Math.max(0, totalSlots - unavailableCount)
      if (t.maxHours && t.maxHours > 0) return Math.min(availableSlots, t.maxHours)
      return availableSlots
    }
    const computeTeacherUnavailability = (t: Teacher) => {
      return DAYS.reduce((sum, d) => sum + (t.unavailable?.[d]?.length ?? 0), 0)
    }

    // Her öğretmenin toplam yoğunluk oranı: zorunlu saat / müsait slot
    const allGradeIds = [...new Set(classes.map(c => c.grade))]
    const sectionCountByGrade = new Map<string, number>()
    for (const gid of allGradeIds) {
      sectionCountByGrade.set(gid, classes.filter(c => c.grade === gid).length)
    }
    const teacherLoadRatio = new Map<string, number>()
    for (const t of teachers) {
      const unavailCount = DAYS.reduce((sum, d) => sum + (t.unavailable?.[d]?.length ?? 0), 0)
      const available = Math.max(1, DAYS.length * slots.length - unavailCount)
      let totalReq = 0
      for (const sid of getTeacherSubjectIds(t)) {
        const subj = subjects.find(s => s.id === sid)
        if (!subj) continue
        const coveredGrades =
          t.preferredGradesBySubject?.[sid]?.length
            ? t.preferredGradesBySubject[sid]
            : t.preferredGrades?.length
            ? t.preferredGrades
            : allGradeIds
        for (const gid of coveredGrades) {
          totalReq += (subj.weeklyHoursByGrade?.[gid] ?? 0) * (sectionCountByGrade.get(gid) ?? 1)
        }
      }
      teacherLoadRatio.set(t.id, totalReq / available)
    }

    // Her ders+sınıf kombinasyonu için: uygun öğretmenler arasında max yoğunluk oranı
    const maxTeacherLoadBySubjectGrade = new Map<string, number>()

    for (const s of subjects) {
      for (const g of classes) {
        const key = `${s.id}|${g.grade}`
        if (capacityBySubjectGrade.has(key)) continue
        const pool = filterAllowedTeachers(teachers, s.id, g.grade)
        const totalCapacity = pool.reduce((sum, t) => sum + computeTeacherCapacity(t), 0)
        const maxUnavailable = pool.reduce((max, t) => Math.max(max, computeTeacherUnavailability(t)), 0)
        const maxLoad = pool.reduce((max, t) => Math.max(max, teacherLoadRatio.get(t.id) ?? 0), 0)
        capacityBySubjectGrade.set(key, totalCapacity)
        scarcityBySubjectGrade.set(key, maxUnavailable)
        maxTeacherLoadBySubjectGrade.set(key, maxLoad)
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // KİLİTLİ ÖĞRETMEN SLOTLARINI ÖN YERLEŞTIR
    // ═══════════════════════════════════════════════════════════════
    if (lockedTeachers.length > 0) {
      for (const c of classes) {
        for (const day of DAYS) {
          const existingDay = tables[c.key]?.[day]
          if (!existingDay) continue
          for (let si = 0; si < existingDay.length; si++) {
            const cell = existingDay[si]
            if (!cell?.subjectId || !cell.teacherId) continue
            if (!lockedTeachers.includes(cell.teacherId)) continue
            placeCell(c.key, day, si, cell.subjectId, cell.teacherId)
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // TÜM DERSLERİ GLOBAL BİR HAVUZDA TOPLA (mevcut yerleşenleri çıkar)
    // ═══════════════════════════════════════════════════════════════
    type GlobalLesson = {
      classKey: ClassKey
      gradeId: string
      subjId: string
      isBlock: boolean // Beden eğitimi bloğu mu?
      priority: boolean
    }

    // Mevcut programda her sınıf için her dersten kaç saat yerleşmiş?
    const alreadyPlaced: Record<ClassKey, Record<string, number>> = {}
    for (const c of classes) {
      alreadyPlaced[c.key] = {}
      for (const day of dayOrder) {
        for (const cell of workingTables[c.key][day]) {
          if (cell?.subjectId) {
            alreadyPlaced[c.key][cell.subjectId] = (alreadyPlaced[c.key][cell.subjectId] ?? 0) + 1
          }
        }
      }
    }

    const allLessons: GlobalLesson[] = []

    for (const c of classes) {
      const gradeId = c.grade
      for (const s of subjects) {
        const totalNeeded = s.weeklyHoursByGrade[gradeId] ?? 0
        if (totalNeeded <= 0) continue

        // Mevcut programda zaten yerleşmiş olanları çıkar
        const alreadyCount = alreadyPlaced[c.key][s.id] ?? 0
        const remaining = totalNeeded - alreadyCount
        if (remaining <= 0) continue

        const isPriority = (s.priority ?? true) && gradeId !== 'Özel Eğitim'
        const prefersBlocks = prefersBlock(s, gradeId)
        const isBed = isMandatoryBlock(s, gradeId)
        const pairs = Math.floor(remaining / 2)
        let blocks = 0
        let singles = remaining % 2
        for (let i = 0; i < pairs; i++) {
          const shouldBlock = isBed || prefersBlocks || (isPriority && rng() < 0.9)
          if (shouldBlock) {
            blocks++
          } else {
            singles += 2
          }
        }
        for (let i = 0; i < blocks; i++) {
          allLessons.push({ classKey: c.key, gradeId, subjId: s.id, isBlock: true, priority: isPriority })
        }
        for (let i = 0; i < singles; i++) {
          allLessons.push({ classKey: c.key, gradeId, subjId: s.id, isBlock: false, priority: isPriority })
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // SHUFFLE + ÖNCELİK SIRALA: Önce karıştır, sonra kısıtlılara öncelik ver
    // ═══════════════════════════════════════════════════════════════
    // Shuffle - her çalıştırmada farklı sonuçlar için
    shuffleInPlace(allLessons, rng)

    // Öncelik sıralama - stable sort ile shuffle etkisi korunur
    allLessons.sort((a, b) => {
      // 1. Yoğunluğu yüksek öğretmenin dersleri önce (en kritik kısıt)
      //    Yoğunluk = toplam zorunlu saat / müsait slot oranı (>1 = fazla yüklü)
      const la = maxTeacherLoadBySubjectGrade.get(`${a.subjId}|${a.gradeId}`) ?? 0
      const lb = maxTeacherLoadBySubjectGrade.get(`${b.subjId}|${b.gradeId}`) ?? 0
      if (Math.abs(la - lb) > 0.02) return lb - la
      // 2. En kısıtlı (çok kapalı slot) öğretmenlere ait dersler önce
      const sa = scarcityBySubjectGrade.get(`${a.subjId}|${a.gradeId}`) ?? 0
      const sb = scarcityBySubjectGrade.get(`${b.subjId}|${b.gradeId}`) ?? 0
      if (sa !== sb) return sb - sa
      // 3. Öncelikli dersler önce
      if (a.priority !== b.priority) return a.priority ? -1 : 1
      // 4. Bloklar önce (2 slot birden lazım, daha kısıtlı)
      if (a.isBlock !== b.isBlock) return a.isBlock ? -1 : 1
      // 5. Öğretmen kapasitesi düşük olan dersler önce
      const ca = capacityBySubjectGrade.get(`${a.subjId}|${a.gradeId}`) ?? 0
      const cb = capacityBySubjectGrade.get(`${b.subjId}|${b.gradeId}`) ?? 0
      if (ca !== cb) return ca - cb
      // 6. Az öğretmeni olan dersler önce
      const ea = eligibleTeacherCount(a.subjId, a.gradeId)
      const eb = eligibleTeacherCount(b.subjId, b.gradeId)
      if (ea !== eb) return ea - eb
      // 7. Çok saatli dersler önce
      const ha = subjects.find(s => s.id === a.subjId)?.weeklyHoursByGrade[a.gradeId] ?? 0
      const hb = subjects.find(s => s.id === b.subjId)?.weeklyHoursByGrade[b.gradeId] ?? 0
      return hb - ha
    })

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Tüm dersleri yerleştir (yumuşak kısıtlarla)
    // ═══════════════════════════════════════════════════════════════
    const unplaced: GlobalLesson[] = []

    for (const lesson of allLessons) {
      const { classKey, gradeId, subjId, isBlock } = lesson
      const subject = subjects.find(s => s.id === subjId)!
      const rule = subject.rule
      const isPriority = (subject.priority ?? true) && gradeId !== 'Özel Eğitim'
      const lessonDayOrder = isPriority ? dayOrder : shuffleInPlace([...DAYS], rng)
      const lessonSlotOrder = isPriority ? slotOrder : shuffleInPlace([...slotOrder], rng)

      // Bu sınıf seviyesi+ders için zaten atanmış öğretmenler
      const gsKey = `${gradeId}|${subjId}`
      const alreadyAssignedToGrade = gradeSubjectAssignedTeachers.get(gsKey)

      type Candidate = { day: Day; si: number; teacherId: string; score: number; isNewTeacher: boolean }
      const candidates: Candidate[] = []

      for (const day of lessonDayOrder) {
        const currentDayCount = daySubjCount(classKey, day, subjId)
        const perDayMax = rule?.perDayMax ?? 0

        const slotsToCheck = isBlock ? slots.length - 1 : slots.length
        const order = slotsToCheck === lessonSlotOrder.length ? lessonSlotOrder : lessonSlotOrder.filter(i => i < slotsToCheck)
        for (const si of order) {
          // Slot boş mu?
          if (!isFree(classKey, day, si)) continue
          if (isBlock && !isFree(classKey, day, si + 1)) continue

          // Avoid slots kontrolü
          if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue
          if (isBlock && rule?.avoidSlots?.includes(`S${si + 2}`)) continue

          // Günlük max kontrolü (varsayılan: günde en fazla 2)
          const adding = isBlock ? 2 : 1
          const effectivePerDayMax = perDayMax > 0 ? perDayMax : 2
          if (currentDayCount + adding > effectivePerDayMax) continue

          // minDays: farklı günlere yayılmayı zorla
          const minDays = rule?.minDays ?? 0
        if (minDays > 0) {
          const placedUnique = placedDays[classKey][subjId]?.size ?? 0
          const alreadyThisDay = placedDays[classKey][subjId]?.has(day)
          if (!alreadyThisDay && placedUnique < minDays - 1 && currentDayCount > 0) continue
        }

        // maxConsecutive kontrolü
        const maxConsec = rule?.maxConsecutive ?? 0
        if (maxConsec > 0) {
          if (isBlock) {
            let backward = 0
            for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
            let forward = 0
            for (let k = si + 2; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
            if (backward + 2 + forward > maxConsec) continue
          } else {
            let backward = 0
            for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
            let forward = 0
            for (let k = si + 1; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
            if (backward + 1 + forward > maxConsec) continue
          }
        }

          // Ardışıklık kuralı: aynı günde aynı ders varsa yeni slot mevcut bloğa bitişik olmalı
          {
            const existingOnDay: number[] = []
            for (let k = 0; k < slots.length; k++) {
              if (workingTables[classKey][day][k]?.subjectId === subjId) existingOnDay.push(k)
            }
            if (existingOnDay.length > 0) {
              const newSlots = isBlock ? [si, si + 1] : [si]
              const combined = [...existingOnDay, ...newSlots].sort((a, b) => a - b)
              let contiguous = true
              for (let i = 1; i < combined.length; i++) {
                if (combined[i] !== combined[i - 1] + 1) { contiguous = false; break }
              }
              if (!contiguous) continue
            }
          }

          // Öğretmen bul
          let teacherId: string | undefined
          if (isBlock) {
            const t1 = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!t1) continue
            const t2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, {
              commit: false, requiredTeacherId: t1, occupied: teacherOccupied, randomByTeacher: teacherRandom,
              classKey, teacherClassDayCount,
            })
            if (t1 !== t2) continue
            teacherId = t1
          } else {
            teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
          }
          if (!teacherId) continue

          // Bu öğretmen bu sınıf seviyesine henüz atanmamış mı?
          const isNewTeacher = !alreadyAssignedToGrade || !alreadyAssignedToGrade.has(teacherId)

          // Skor hesapla
          let score = 0
          if (isPriority) {
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
          } else {
            score = rng()
          }

          candidates.push({ day, si, teacherId, score, isNewTeacher })
        }
      }

      if (candidates.length > 0) {
        // Önce yeni öğretmenleri tercih et (farklı şubelere farklı öğretmen), sonra skora göre sırala
        candidates.sort((a, b) => {
          // Yeni öğretmen (bu sınıf seviyesine henüz atanmamış) önce gelsin
          if (a.isNewTeacher !== b.isNewTeacher) return a.isNewTeacher ? -1 : 1
          // Sonra skora göre
          return b.score - a.score
        })
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
      const effectivePerDayMax = perDayMax > 0 ? perDayMax : 2
      if (currentDayCount + addCount > effectivePerDayMax) return false

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

      // maxConsecutive kontrolü
      const maxConsec = rule?.maxConsecutive ?? 0
      if (maxConsec > 0) {
        if (isBlock) {
          let backward = 0
          for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
          let forward = 0
          for (let k = si + 2; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
          if (backward + 2 + forward > maxConsec) return false
        } else {
          let backward = 0
          for (let k = si - 1; k >= 0 && workingTables[classKey][day][k]?.subjectId === subjId; k--) backward++
          let forward = 0
          for (let k = si + 1; k < slots.length && workingTables[classKey][day][k]?.subjectId === subjId; k++) forward++
          if (backward + 1 + forward > maxConsec) return false
        }
      }

      // Ardışıklık: aynı günde aynı ders varsa yeni slot mevcut bloğa bitişik olmalı
      {
        const existingOnDay: number[] = []
        for (let k = 0; k < slots.length; k++) {
          if (workingTables[classKey][day][k]?.subjectId === subjId) existingOnDay.push(k)
        }
        if (existingOnDay.length > 0) {
          const newSlots = isBlock ? [si, si + 1] : [si]
          const combined = [...existingOnDay, ...newSlots].sort((a, b) => a - b)
          for (let i = 1; i < combined.length; i++) {
            if (combined[i] !== combined[i - 1] + 1) return false
          }
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

    // Zincir halinde kaydırma: Bir dersi kaydırıp, onun yerini de başka dersle doldur
    const tryChainRelocate = (classKey: ClassKey, day: Day, si: number): boolean => {
      const current = workingTables[classKey][day][si]
      if (!current?.subjectId || !current.teacherId) return false
      const subjId = current.subjectId
      const teacherId = current.teacherId

      // Blok dersin parçasına dokunma
      const sameDay = workingTables[classKey][day]
      if (si + 1 < sameDay.length && sameDay[si + 1]?.subjectId === subjId && sameDay[si + 1]?.teacherId === teacherId) return false
      if (si - 1 >= 0 && sameDay[si - 1]?.subjectId === subjId && sameDay[si - 1]?.teacherId === teacherId) return false

      const teacher = teachers.find(t => t.id === teacherId)

      // Başka bir slotu bul ve oradaki dersi de taşı
      for (const d2 of DAYS) {
        for (let s2 = 0; s2 < slots.length; s2++) {
          if (d2 === day && s2 === si) continue

          const target = workingTables[classKey][d2][s2]

          // Hedef slot boşsa normal taşı
          if (!target?.subjectId) {
            const occKey = `${d2}-${s2}`
            if (teacherOccupied.get(teacherId)?.has(occKey)) continue
            const blocked = teacher?.unavailable?.[d2]?.includes(`S${s2 + 1}`)
            if (blocked) continue
            if (!canPlaceWithRules(classKey, d2, s2, subjId, false)) continue

            workingTables[classKey][d2][s2] = current
            workingTables[classKey][day][si] = {}
            teacherOccupied.get(teacherId)?.delete(`${day}-${si}`)
            if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
            teacherOccupied.get(teacherId)!.add(occKey)
            recomputeSubjectDays(classKey, subjId)
            return true
          }

          // Hedef slottaki dersi başka yere taşıyabilir miyiz?
          const targetSubjId = target.subjectId
          const targetTeacherId = target.teacherId
          if (!targetTeacherId) continue

          // Blok parçası mı kontrol et
          if (s2 + 1 < sameDay.length && workingTables[classKey][d2][s2 + 1]?.subjectId === targetSubjId) continue
          if (s2 - 1 >= 0 && workingTables[classKey][d2][s2 - 1]?.subjectId === targetSubjId) continue

          const targetTeacher = teachers.find(t => t.id === targetTeacherId)

          // Hedef dersi taşıyabileceğimiz bir yer bul
          for (const d3 of DAYS) {
            for (let s3 = 0; s3 < slots.length; s3++) {
              if ((d3 === d2 && s3 === s2) || (d3 === day && s3 === si)) continue
              if (!isFree(classKey, d3, s3)) continue

              const occKey3 = `${d3}-${s3}`
              if (teacherOccupied.get(targetTeacherId)?.has(occKey3)) continue
              const blocked3 = targetTeacher?.unavailable?.[d3]?.includes(`S${s3 + 1}`)
              if (blocked3) continue
              if (!canPlaceWithRules(classKey, d3, s3, targetSubjId, false)) continue

              // Şimdi current'ı da target'ın yerine koyabilir miyiz?
              const occKey2 = `${d2}-${s2}`
              if (teacherOccupied.get(teacherId)?.has(occKey2)) continue
              const blocked2 = teacher?.unavailable?.[d2]?.includes(`S${s2 + 1}`)
              if (blocked2) continue
              if (!canPlaceWithRules(classKey, d2, s2, subjId, false)) continue

              // Zincir taşıma yap
              // 1. Target'ı yeni yere taşı
              workingTables[classKey][d3][s3] = target
              teacherOccupied.get(targetTeacherId)?.delete(`${d2}-${s2}`)
              if (!teacherOccupied.has(targetTeacherId)) teacherOccupied.set(targetTeacherId, new Set())
              teacherOccupied.get(targetTeacherId)!.add(occKey3)

              // 2. Current'ı target'ın yerine koy
              workingTables[classKey][d2][s2] = current
              teacherOccupied.get(teacherId)?.delete(`${day}-${si}`)
              if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
              teacherOccupied.get(teacherId)!.add(occKey2)

              // 3. Eski yeri boşalt
              workingTables[classKey][day][si] = {}

              recomputeSubjectDays(classKey, subjId)
              recomputeSubjectDays(classKey, targetSubjId)
              return true
            }
          }
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
      const subj = subjects.find(s => s.id === subjId)
      const isMandatory = subj ? isMandatoryBlock(subj, gradeId) : false

      // Blok dersi önce blok olarak, kısıtları esneterek dene
      if (isBlock && !placed) {
        const rule = subj?.rule
        for (const day of dayOrder) {
          if (placed) break
          for (const si of slotOrder.filter(i => i < slots.length - 1)) {
            if (!isFree(classKey, day, si) || !isFree(classKey, day, si + 1)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, true)) continue
            if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue
            if (rule?.avoidSlots?.includes(`S${si + 2}`)) continue
            const t1 = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!t1) continue
            const t2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, {
              commit: false, requiredTeacherId: t1, occupied: teacherOccupied, randomByTeacher: teacherRandom,
              classKey, teacherClassDayCount,
            })
            if (t1 !== t2 || !t2) continue
            placeCell(classKey, day, si, subjId, t1)
            placeCell(classKey, day, si + 1, subjId, t1)
            placed = true
            break
          }
        }
      }

      // Blokları tekli olarak dene (kurallara uyarak) - Beden için asla bölme
      if (isBlock && !placed && !isMandatory) {
        let placedCount = 0
        for (let needed = 0; needed < 2 && !placed; needed++) {
          for (const day of dayOrder) {
            if (placedCount >= 2) break
            for (const si of slotOrder) {
              if (!isFree(classKey, day, si)) continue
              if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
              const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, { tryLocked: false })
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
        for (const day of dayOrder) {
          if (placed) break
          for (const si of slotOrder) {
            if (!isFree(classKey, day, si)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
            let teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, { tryLocked: true })
            if (!teacherId) teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si, { tryLocked: false })
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
    // PHASE 3: Kalanları tekrar tara (kurallar ve tercihler korunur)
    // ═══════════════════════════════════════════════════════════════
    const finalUnplaced: GlobalLesson[] = []
    for (const lesson of stillUnplaced) {
      const { classKey, subjId, isBlock } = lesson
      const gradeId = classGradeMap.get(classKey) ?? ''
      let placedHere = false

      if (isBlock) {
        for (const day of dayOrder) {
          if (placedHere) break
          for (const si of slotOrder.filter(i => i < slots.length - 1)) {
            if (!isFree(classKey, day, si) || !isFree(classKey, day, si + 1)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, true)) continue
            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue
            const slotKey2 = `${day}-${si + 1}`
            if (teacherOccupied.get(teacherId)?.has(slotKey2)) continue
            const teacher = teachers.find(t => t.id === teacherId)
            if (teacher?.unavailable?.[day]?.includes(`S${si + 2}`)) continue

            placeCell(classKey, day, si, subjId, teacherId)
            placeCell(classKey, day, si + 1, subjId, teacherId)
            placedHere = true
            break
          }
        }
      }

      if (!placedHere) {
        const neededCount = isBlock ? 2 : 1
        let placedCount = 0
        for (const day of dayOrder) {
          if (placedCount >= neededCount) break
          for (const si of slotOrder) {
            if (!isFree(classKey, day, si)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue
            placeCell(classKey, day, si, subjId, teacherId)
            placedCount++
            if (placedCount >= neededCount) break
          }
        }
        if (placedCount >= neededCount) placedHere = true
      }

      if (!placedHere) finalUnplaced.push(lesson)
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Yer açarak yerleştirme (kurallar ve tercihler korunur)
    // ═══════════════════════════════════════════════════════════════
    const lastResort: GlobalLesson[] = []
    for (const lesson of finalUnplaced) {
      const { classKey, subjId, isBlock } = lesson
      const gradeId = classGradeMap.get(classKey) ?? ''
      let placedHere = false

      if (isBlock) {
        for (const day of dayOrder) {
          if (placedHere) break
          for (const si of slotOrder.filter(i => i < slots.length - 1)) {
            if (!isFree(classKey, day, si) || !isFree(classKey, day, si + 1)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, true)) continue
            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue
            const slotKey2 = `${day}-${si + 1}`
            if (teacherOccupied.get(teacherId)?.has(slotKey2)) continue
            const teacher = teachers.find(t => t.id === teacherId)
            if (teacher?.unavailable?.[day]?.includes(`S${si + 2}`)) continue
            placeCell(classKey, day, si, subjId, teacherId)
            placeCell(classKey, day, si + 1, subjId, teacherId)
            placedHere = true
            break
          }
        }
      }

      if (isBlock) {
        if (!placedHere) lastResort.push(lesson)
        continue
      }

      // Önce boş slotlara dene (kurallar uygulanır)
      for (const day of dayOrder) {
        if (placedHere) break
        for (const si of slotOrder) {
          if (!isFree(classKey, day, si)) continue
          if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue

          const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
          if (!teacherId) continue

          placeCell(classKey, day, si, subjId, teacherId)
          placedHere = true
          break
        }
      }

      // Hala yerleşemediyse mevcut dersi kaydır
      if (!placedHere) {
        for (const day of dayOrder) {
          if (placedHere) break
          for (const si of slotOrder) {
            let slotFree = isFree(classKey, day, si)

            // Mümkünse mevcut dersi kaydırarak boşluk aç
            if (!slotFree) slotFree = tryRelocateSingle(classKey, day, si)
            if (!slotFree) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue

            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue

            placeCell(classKey, day, si, subjId, teacherId)
            placedHere = true
            break
          }
        }
      }

      // Hala yerleşemediyse zincir halinde kaydır
      if (!placedHere) {
        for (const day of dayOrder) {
          if (placedHere) break
          for (const si of slotOrder) {
            if (isFree(classKey, day, si)) continue // Zaten boş olan slotları atla

            // Zincir kaydırma dene
            if (!tryChainRelocate(classKey, day, si)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue

            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue

            placeCell(classKey, day, si, subjId, teacherId)
            placedHere = true
            break
          }
        }
      }

      if (!placedHere) lastResort.push(lesson)
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Son deneme - kurallara uyarak yerleştir
    // ═══════════════════════════════════════════════════════════════
    for (const lesson of lastResort) {
      const { classKey, subjId, isBlock } = lesson
      const gradeId = classGradeMap.get(classKey) ?? ''
      let placed = false

      if (isBlock) {
        for (const day of dayOrder) {
          if (placed) break
          for (const si of slotOrder.filter(i => i < slots.length - 1)) {
            if (!isFree(classKey, day, si) || !isFree(classKey, day, si + 1)) continue
            if (!canPlaceWithRules(classKey, day, si, subjId, true)) continue
            const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
            if (!teacherId) continue
            const slotKey2 = `${day}-${si + 1}`
            if (teacherOccupied.get(teacherId)?.has(slotKey2)) continue
            const teacher = teachers.find(t => t.id === teacherId)
            if (teacher?.unavailable?.[day]?.includes(`S${si + 2}`)) continue
            placeCell(classKey, day, si, subjId, teacherId)
            placeCell(classKey, day, si + 1, subjId, teacherId)
            placed = true
            break
          }
        }
        continue
      }

      for (const day of dayOrder) {
        if (placed) break
        for (const si of slotOrder) {
          if (!isFree(classKey, day, si)) continue
          if (!canPlaceWithRules(classKey, day, si, subjId, false)) continue
          const teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
          if (!teacherId) continue
          placeCell(classKey, day, si, subjId, teacherId)
          placed = true
          break
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DEEP REPAIR HELPERS
    // ═══════════════════════════════════════════════════════════════

    // Hangi sınıf/ders, belirli bir öğretmeni belirli bir slot'ta tutuyor?
    const findTeacherBlocker = (teacherId: string, day: Day, si: number): { classKey: ClassKey; subjId: string } | null => {
      for (const c of classes) {
        const cell = workingTables[c.key][day]?.[si]
        if (cell?.teacherId === teacherId && cell.subjectId) {
          return { classKey: c.key, subjId: cell.subjectId }
        }
      }
      return null
    }

    // Bir öğretmeni belirli slot'tan serbest bırak: o öğretmenin o slot'taki dersini başka yere taşı
    const tryFreeTeacherSlot = (teacherId: string, day: Day, si: number): boolean => {
      const blocker = findTeacherBlocker(teacherId, day, si)
      if (!blocker) return false
      const { classKey: bck, subjId: bsid } = blocker

      // Blok dersin ortasına dokunma
      const bDay = workingTables[bck][day]
      if (si + 1 < bDay.length && bDay[si + 1]?.subjectId === bsid && bDay[si + 1]?.teacherId === teacherId) return false
      if (si - 1 >= 0 && bDay[si - 1]?.subjectId === bsid && bDay[si - 1]?.teacherId === teacherId) return false

      const teacher = teachers.find(t => t.id === teacherId)

      for (const d2 of DAYS) {
        for (let s2 = 0; s2 < slots.length; s2++) {
          if (d2 === day && s2 === si) continue
          if (!isFree(bck, d2, s2)) continue
          if (teacherOccupied.get(teacherId)?.has(`${d2}-${s2}`)) continue
          if (teacher?.unavailable?.[d2]?.includes(`S${s2 + 1}`)) continue
          if (!canPlaceWithRules(bck, d2, s2, bsid, false)) continue

          // Dersi yeni slota taşı
          workingTables[bck][d2][s2] = workingTables[bck][day][si]
          workingTables[bck][day][si] = {}
          teacherOccupied.get(teacherId)?.delete(`${day}-${si}`)
          if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
          teacherOccupied.get(teacherId)!.add(`${d2}-${s2}`)
          const tcdOld = `${teacherId}|${bck}|${day}`
          const tcdNew = `${teacherId}|${bck}|${d2}`
          teacherClassDayCount.set(tcdOld, Math.max(0, (teacherClassDayCount.get(tcdOld) ?? 0) - 1))
          teacherClassDayCount.set(tcdNew, (teacherClassDayCount.get(tcdNew) ?? 0) + 1)
          recomputeSubjectDays(bck, bsid)
          return true
        }
      }
      return false
    }

    // Ardışıklık kuralına göre bu gün için YALNIZCA geçerli ekleme slotlarını döndür.
    // Aynı ders zaten günde varsa, yeni slot mevcut bloğa bitişik olmak zorunda.
    const getAdjacentInsertionSlots = (classKey: ClassKey, day: Day, subjId: string, isBlock: boolean): number[] => {
      const existing: number[] = []
      for (let k = 0; k < slots.length; k++) {
        if (workingTables[classKey][day][k]?.subjectId === subjId) existing.push(k)
      }
      if (existing.length === 0) {
        // Kısıt yok — tüm slotlar geçerli
        const maxSi = isBlock ? slots.length - 1 : slots.length
        return Array.from({ length: maxSi }, (_, i) => i)
      }
      const min = Math.min(...existing)
      const max = Math.max(...existing)
      const result: number[] = []
      if (isBlock) {
        if (min >= 2) result.push(min - 2)
        if (max + 2 < slots.length) result.push(max + 1)
      } else {
        if (min > 0) result.push(min - 1)
        if (max + 1 < slots.length) result.push(max + 1)
      }
      return result
    }

    // Akıllı derin yerleştirme:
    // 1. Slot boşaltma (relocate + chain)
    // 2. Öğretmeni serbest bırakma (başka sınıftaki dersini taşıma)
    // 3. İkisinin kombinasyonu
    const tryPlaceDeep = (classKey: ClassKey, subjId: string, gradeId: string, isBlock: boolean): boolean => {
      const subject = subjects.find(s => s.id === subjId)
      const rule = subject?.rule
      const perDayMax = rule?.perDayMax ?? 0
      const effectivePerDayMax = perDayMax > 0 ? perDayMax : 2

      for (const day of DAYS) {
        const currentDayCount = daySubjCount(classKey, day, subjId)
        if (currentDayCount + (isBlock ? 2 : 1) > effectivePerDayMax) continue

        const insertionSlots = getAdjacentInsertionSlots(classKey, day, subjId, isBlock)

        for (const si of insertionSlots) {
          if (si >= slots.length) continue
          if (isBlock && si + 1 >= slots.length) continue

          // Avoid slots kontrolü
          if (rule?.avoidSlots?.includes(`S${si + 1}`)) continue
          if (isBlock && rule?.avoidSlots?.includes(`S${si + 2}`)) continue

          // maxConsecutive kontrolü
          const maxConsec = rule?.maxConsecutive ?? 0
          if (maxConsec > 0) {
            const existingOnDay = []
            for (let k = 0; k < slots.length; k++) {
              if (workingTables[classKey][day][k]?.subjectId === subjId) existingOnDay.push(k)
            }
            const newSlots = isBlock ? [si, si + 1] : [si]
            const combined = [...existingOnDay, ...newSlots].sort((a, b) => a - b)
            if (combined.length > maxConsec) continue
          }

          // Adım 1: si slotunu boşalt
          if (!isFree(classKey, day, si)) {
            if (!tryRelocateSingle(classKey, day, si) && !tryChainRelocate(classKey, day, si)) continue
          }
          if (!isFree(classKey, day, si)) continue

          // Adım 2 (blok): si+1 slotunu boşalt
          if (isBlock) {
            if (!isFree(classKey, day, si + 1)) {
              if (!tryRelocateSingle(classKey, day, si + 1) && !tryChainRelocate(classKey, day, si + 1)) continue
            }
            if (!isFree(classKey, day, si + 1)) continue
          }

          // Adım 3: Öğretmen bul
          let teacherId: string | undefined = findTeacherForSlot(classKey, subjId, gradeId, day, si)

          if (!teacherId) {
            // Öğretmen başka sınıfta mı? Onu oradan kurtar
            const pool = filterAllowedTeachers(teachers, subjId, gradeId)
            for (const t of pool) {
              if (!teacherOccupied.get(t.id)?.has(`${day}-${si}`)) continue
              const teacher = teachers.find(x => x.id === t.id)
              if (teacher?.unavailable?.[day]?.includes(`S${si + 1}`)) continue
              if ((teacherLoad.get(t.id) ?? 0) >= (teacher?.maxHours ?? Infinity)) continue
              if (tryFreeTeacherSlot(t.id, day, si)) {
                teacherId = findTeacherForSlot(classKey, subjId, gradeId, day, si)
                if (teacherId) break
              }
            }
          }

          if (!teacherId) continue

          // Adım 4 (blok): öğretmen si+1'de de serbest mi?
          if (isBlock) {
            const slotKey2 = `${day}-${si + 1}`
            if (teacherOccupied.get(teacherId)?.has(slotKey2)) {
              if (!tryFreeTeacherSlot(teacherId, day, si + 1)) continue
            }
            const t2 = pickTeacher(teachers, teacherLoad, subjId, gradeId, day, si + 1, {
              commit: false, requiredTeacherId: teacherId, occupied: teacherOccupied,
              randomByTeacher: teacherRandom, classKey, teacherClassDayCount,
            })
            if (teacherId !== t2) continue
          }

          placeCell(classKey, day, si, subjId, teacherId)
          if (isBlock) placeCell(classKey, day, si + 1, subjId, teacherId)
          return true
        }
      }
      return false
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 6: Eksikleri yer açarak tamamlama (kural bozmaz)
    // ═══════════════════════════════════════════════════════════════
    for (let pass = 0; pass < 3; pass++) {
      let progress = false
      for (const c of classes) {
        const gradeId = c.grade
        const currentCounts: Record<string, number> = {}
        for (const day of dayOrder) {
          for (const cell of workingTables[c.key][day]) {
            if (cell?.subjectId) currentCounts[cell.subjectId] = (currentCounts[cell.subjectId] ?? 0) + 1
          }
        }

        for (const s of subjects) {
          const totalNeeded = s.weeklyHoursByGrade[gradeId] ?? 0
          if (totalNeeded <= 0) continue
          let missing = totalNeeded - (currentCounts[s.id] ?? 0)
          if (missing <= 0) continue

          const isMandatory = isMandatoryBlock(s, gradeId)

          if (isMandatory) {
            while (missing >= 2) {
              let placed = false
              for (const day of dayOrder) {
                if (placed) break
                for (const si of slotOrder.filter(i => i < slots.length - 1)) {
                  if (!isFree(c.key, day, si) || !isFree(c.key, day, si + 1)) continue
                  if (!canPlaceWithRules(c.key, day, si, s.id, true)) continue
                  const teacherId = findTeacherForSlot(c.key, s.id, gradeId, day, si)
                  if (!teacherId) continue
                  const slotKey2 = `${day}-${si + 1}`
                  if (teacherOccupied.get(teacherId)?.has(slotKey2)) continue
                  const teacher = teachers.find(t => t.id === teacherId)
                  if (teacher?.unavailable?.[day]?.includes(`S${si + 2}`)) continue
                  placeCell(c.key, day, si, s.id, teacherId)
                  placeCell(c.key, day, si + 1, s.id, teacherId)
                  missing -= 2
                  currentCounts[s.id] = (currentCounts[s.id] ?? 0) + 2
                  placed = true
                  progress = true
                  break
                }
              }
              if (!placed) break
            }
            continue
          }

          while (missing > 0) {
            let placed = false
            for (const day of dayOrder) {
              if (placed) break
              for (const si of slotOrder) {
                if (isFree(c.key, day, si)) {
                  if (!canPlaceWithRules(c.key, day, si, s.id, false)) continue
                  const teacherId = findTeacherForSlot(c.key, s.id, gradeId, day, si)
                  if (!teacherId) continue
                  placeCell(c.key, day, si, s.id, teacherId)
                  missing -= 1
                  currentCounts[s.id] = (currentCounts[s.id] ?? 0) + 1
                  placed = true
                  progress = true
                  break
                }

                if (tryRelocateSingle(c.key, day, si)) {
                  if (!canPlaceWithRules(c.key, day, si, s.id, false)) continue
                  const teacherId = findTeacherForSlot(c.key, s.id, gradeId, day, si)
                  if (!teacherId) continue
                  placeCell(c.key, day, si, s.id, teacherId)
                  missing -= 1
                  currentCounts[s.id] = (currentCounts[s.id] ?? 0) + 1
                  placed = true
                  progress = true
                  break
                }

                if (tryChainRelocate(c.key, day, si)) {
                  if (!canPlaceWithRules(c.key, day, si, s.id, false)) continue
                  const teacherId = findTeacherForSlot(c.key, s.id, gradeId, day, si)
                  if (!teacherId) continue
                  placeCell(c.key, day, si, s.id, teacherId)
                  missing -= 1
                  currentCounts[s.id] = (currentCounts[s.id] ?? 0) + 1
                  placed = true
                  progress = true
                  break
                }
              }
            }
            if (!placed) break
          }
        }
      }
      if (!progress) break
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 7: Derin onarım — öğretmen serbest bırakma + zincir taşıma
    // ═══════════════════════════════════════════════════════════════
    for (let pass = 0; pass < 6; pass++) {
      let madeProgress = false

      // Her sınıf için mevcut eksikleri hesapla
      const allDeficits: { classKey: ClassKey; gradeId: string; subjId: string; missing: number; isMandatory: boolean }[] = []
      for (const c of classes) {
        const gradeId = c.grade
        const currentCounts: Record<string, number> = {}
        for (const day of DAYS) {
          for (const cell of workingTables[c.key][day]) {
            if (cell?.subjectId) currentCounts[cell.subjectId] = (currentCounts[cell.subjectId] ?? 0) + 1
          }
        }
        for (const s of subjects) {
          const totalNeeded = s.weeklyHoursByGrade[gradeId] ?? 0
          if (totalNeeded <= 0) continue
          const missing = totalNeeded - (currentCounts[s.id] ?? 0)
          if (missing <= 0) continue
          allDeficits.push({
            classKey: c.key, gradeId, subjId: s.id, missing,
            isMandatory: isMandatoryBlock(s, gradeId),
          })
        }
      }

      if (allDeficits.length === 0) break

      // En az eksikten en çoğa sırala (kolay olanları önce bitir)
      allDeficits.sort((a, b) => a.missing - b.missing)

      for (const item of allDeficits) {
        const { classKey, gradeId, subjId, isMandatory } = item
        let remaining = item.missing

        while (remaining > 0) {
          const useBlock = isMandatory && remaining >= 2
          const placed = tryPlaceDeep(classKey, subjId, gradeId, useBlock)
          if (!placed) break
          remaining -= useBlock ? 2 : 1
          madeProgress = true
        }
      }

      if (!madeProgress) break
    }

    const deficits = classes.map(c => ({
      classKey: c.key,
      deficits: calculateDeficits(c, workingTables[c.key], subjects)
    }))
    const totalMissing = deficits.reduce(
      (sum, item) => sum + item.deficits.reduce((s, d) => s + d.missing, 0),
      0
    )
    return { tables: workingTables, totalMissing, deficits }
  }

  const generate = () => {
    stopRef.current = false
    setIsGenerating(true)
    setGenerationStart(performance.now())
    setProgress(0)
    setTriedCount(0)

    // Toplam gerekli ders saati (eksik göstergesi için)
    const totalReq = classes.reduce((sum, c) =>
      sum + subjects.reduce((s2, subj) => s2 + (subj.weeklyHoursByGrade[c.grade] ?? 0), 0), 0)
    setTotalReqState(totalReq)

    const start = performance.now()
    let best = runOnce(Date.now())
    setTables(best.tables)
    setBestMissing(best.totalMissing)

    let tried = 1
    // XOR-shift: her iterasyonda çok farklı seed üretir, ardışık seed benzerliğini önler
    let xorSeed = (Date.now() ^ 0xdeadbeef) >>> 0
    const xorNext = () => {
      xorSeed ^= xorSeed << 13
      xorSeed ^= xorSeed >>> 17
      xorSeed ^= xorSeed << 5
      xorSeed = xorSeed >>> 0
      return xorSeed
    }

    const seenSignatures = new Set<string>()
    const makeSignature = (defs: { classKey: string; deficits: { name: string; missing: number }[] }[]) =>
      defs.map(d => `${d.classKey}:${d.deficits.map(x => `${x.name}:${x.missing}`).join('|')}`).sort().join('||')

    const finish = (now: number) => {
      const duration = Math.round((now - start) / 1000)
      setTables(best.tables)
      setIsGenerating(false)
      setProgress(0)
      return duration
    }

    const tick = () => {
      if (stopRef.current) {
        const duration = finish(performance.now())
        setLastResult({
          success: best.totalMissing === 0,
          message: `Durduruldu. ${tried} kombinasyon denendi, ${best.totalMissing} eksik ders kaldı.`,
          duration
        })
        return
      }

      const now = performance.now()
      if (best.totalMissing === 0) {
        const duration = finish(now)
        setLastResult({
          success: true,
          message: `Tüm dersler başarıyla yerleştirildi! ${tried} kombinasyon denendi.`,
          duration
        })
        return
      }
      if (now - start > 600000) {
        const duration = finish(now)
        setLastResult({
          success: best.totalMissing === 0,
          message: best.totalMissing === 0
            ? `Tüm dersler başarıyla yerleştirildi! ${tried} kombinasyon denendi.`
            : `${tried} kombinasyon denendi, ${best.totalMissing} eksik ders kaldı. Öğretmen uygunluğu/tercih kısıtları çok sıkı olabilir.`,
          duration
        })
        return
      }

      // 200 deneme/tick — daha fazla keşif, daha hızlı yakınsama
      for (let i = 0; i < 200; i++) {
        tried += 1
        const currentSeed = xorNext()
        const res = runOnce(currentSeed)

        const signature = makeSignature(res.deficits)
        if (seenSignatures.has(signature)) continue
        seenSignatures.add(signature)

        // Signature havuzu çok büyürse eski yarısını temizle (yeni kombinasyonlara yer aç)
        if (seenSignatures.size > 8000) {
          const arr = Array.from(seenSignatures)
          arr.slice(0, 3000).forEach(s => seenSignatures.delete(s))
        }

        if (res.totalMissing < best.totalMissing) {
          best = res
          setTables(best.tables)
          setBestMissing(best.totalMissing)
        }

        if (best.totalMissing === 0) break
      }

      setTriedCount(tried)
      window.setTimeout(tick, 0)
    }

    window.setTimeout(tick, 0)
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

  // Eksik atama sayısı
  const assignmentStats = useMemo(() => {
    let total = 0
    let assigned = 0
    for (const c of classes) {
      for (const s of subjects) {
        const hours = s.weeklyHoursByGrade[c.grade] ?? 0
        if (hours <= 0) continue
        total++
        if (assignments[`${c.key}|${s.id}`]) assigned++
      }
    }
    return { total, assigned, missing: total - assigned }
  }, [classes, subjects, assignments])

  const placementSuggestions = useMemo(() => {
    if (!Object.keys(tables ?? {}).length) return []

    const teacherBusy = new Map<string, Set<string>>() // teacherId -> Set(day-slot)
    for (const [, schedule] of Object.entries(tables)) {
      for (const day of DAYS) {
        schedule[day]?.forEach((cell, si) => {
          if (!cell?.teacherId) return
          if (!teacherBusy.has(cell.teacherId)) teacherBusy.set(cell.teacherId, new Set())
          teacherBusy.get(cell.teacherId)!.add(`${day}-${si}`)
        })
      }
    }

    const suggestions: string[] = []
    const seen = new Set<string>()

    const getGradeOfClass = (ck: string) => ck.split('-')[0]

    for (const item of classDeficits) {
      const gradeId = getGradeOfClass(item.classKey)
      const schedule = tables[item.classKey]
      if (!schedule) continue

      const emptySlots: { day: Day; si: number }[] = []
      for (const day of DAYS) {
        schedule[day]?.forEach((cell, si) => {
          if (!cell?.subjectId) emptySlots.push({ day, si })
        })
      }

      for (const def of item.deficits) {
        const subj = subjects.find(s => s.name === def.name)
        if (!subj) continue

        const candidates = teachers.filter(t => {
          const subs = getTeacherSubjectIds(t)
          if (!subs.includes(subj.id)) return false
          const hasSubjectPref = t.preferredGradesBySubject && Object.prototype.hasOwnProperty.call(t.preferredGradesBySubject, subj.id)
          if (hasSubjectPref) {
            const subjPref = t.preferredGradesBySubject?.[subj.id] ?? []
            if (!subjPref.includes(gradeId)) return false
          } else {
            const prefGrades = t.preferredGrades ?? []
            if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
          }
          return true
        })

        for (const slot of emptySlots) {
          const slotLabel = `S${slot.si + 1}`
          for (const teacher of candidates) {
            const busyKey = `${slot.day}-${slot.si}`
            const unavailable = teacher.unavailable?.[slot.day]?.includes(slotLabel)
            const busy = teacherBusy.get(teacher.id)?.has(busyKey)

            // Eğer sadece uygunluk yüzünden bloklanmışsa öner
            if (unavailable && !busy) {
              const key = `${item.classKey}-${subj.id}-${teacher.id}-${slot.day}-${slot.si}-unavail`
              if (!seen.has(key)) {
                suggestions.push(`${item.classKey} ${subj.name}: ${teacher.name} için ${slot.day} S${slot.si + 1} açılırsa yerleşebilir.`)
                seen.add(key)
              }
            }

            // Çakışma varsa bilgi ver
            if (!unavailable && busy) {
              const key = `${item.classKey}-${subj.id}-${teacher.id}-${slot.day}-${slot.si}-busy`
              if (!seen.has(key)) {
                suggestions.push(`${item.classKey} ${subj.name}: ${teacher.name} aynı saatte başka sınıfta ( ${slot.day} S${slot.si + 1} ). Bu saat boşaltılırsa yerleşebilir.`)
                seen.add(key)
              }
            }

            if (suggestions.length > 8) break
          }
          if (suggestions.length > 8) break
        }
      }
      if (suggestions.length > 8) break
    }

    return suggestions
  }, [tables, classDeficits, subjects, teachers])

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
          <button className="btn btn-outline" onClick={() => setShowSheet(true)} disabled={!Object.keys(tables ?? {}).length || isGenerating}>Çarşaf Görünüm</button>
          <button className="btn btn-outline" onClick={handlePrintHandbooks} disabled={!Object.keys(tables ?? {}).length || isGenerating}>📄 Sınıf El PDF</button>
          <button className="btn btn-outline" onClick={handlePrintSheet} disabled={!Object.keys(tables ?? {}).length || isGenerating}>📊 Sınıf Çarşaf PDF</button>
          {!isGenerating && (
            <button className="btn btn-primary" onClick={generate}>
              Programları Oluştur
            </button>
          )}
        </div>
      </div>

      {/* Eksik atama uyarısı */}
      {assignmentStats.missing > 0 && !isGenerating && (
        <div style={{
          margin: '12px 0',
          padding: '14px 16px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, #78350f, #92400e)',
          color: '#fef3c7',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          border: '1px solid rgba(251, 191, 36, 0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚠️</span>
                Eksik Öğretmen Ataması
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                {assignmentStats.missing} ders için öğretmen atanmamış.
                Atama yapılmayan dersler için algoritma otomatik öğretmen seçecek.
              </div>
            </div>
            <a
              href="#/atamalar"
              className="btn btn-outline"
              style={{ borderColor: 'rgba(251, 191, 36, 0.5)', color: '#fef3c7' }}
            >
              Atamalara Git
            </a>
          </div>
        </div>
      )}

      {/* Aktif süreç göstergesi */}
      {isGenerating && (
        <div style={{
          margin: '12px 0',
          padding: '20px 22px',
          borderRadius: 16,
          background: 'linear-gradient(145deg, #0c1220, #111827)',
          color: '#e2e8f0',
          boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
          border: '1px solid rgba(99,102,241,0.2)',
        }}>
          {/* Top row: label + stats */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Animated live indicator */}
              <div style={{ position: 'relative', width: 16, height: 16, flexShrink: 0 }}>
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: '#6366f1',
                  animation: 'ping 1.4s ease-out infinite',
                  opacity: 0.5,
                }} />
                <div style={{
                  position: 'absolute', inset: '20%', borderRadius: '50%',
                  background: '#818cf8',
                }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.1 }}>
                  Ders Programı Oluşturuluyor
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  En iyi sonuç her an güncelleniyor
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {totalReqState > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1,
                    color: bestMissing === 0 ? '#22c55e' : bestMissing <= 3 ? '#f59e0b' : '#a5b4fc' }}>
                    {totalReqState - bestMissing}
                    <span style={{ fontSize: 13, fontWeight: 400, color: '#475569' }}>/{totalReqState}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {bestMissing === 0 ? 'tümü yerleşti ✓' : `${bestMissing} eksik`}
                  </div>
                </div>
              )}
              <div style={{ textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#94a3b8', lineHeight: 1 }}>
                  {elapsedTime}<span style={{ fontSize: 11, fontWeight: 400, color: '#475569' }}>s</span>
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>/ 600s</div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            position: 'relative',
            height: 10,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 999,
            overflow: 'hidden',
            marginBottom: 14,
            border: '1px solid rgba(255,255,255,0.04)',
          }}>
            {/* Filled portion */}
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              background: progress >= 0.98
                ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                : 'linear-gradient(90deg, #4f46e5, #6366f1, #818cf8)',
              borderRadius: 999,
              transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: progress > 0.02 ? '0 0 16px rgba(99,102,241,0.55)' : 'none',
            }} />
            {/* Shimmer overlay */}
            {progress > 0.02 && progress < 0.99 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                width: '40%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }} />
            )}
          </div>

          {/* Bottom row: combination count + hint */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: '#4f46e5',
                  animation: `barPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  opacity: 0.7,
                }} />
              ))}
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>
                {triedCount > 0 ? `${triedCount} kombinasyon denendi` : 'Başlatılıyor…'}
              </span>
            </div>
            <button
              className="btn btn-danger"
              style={{ padding: '4px 14px', fontSize: 12, borderRadius: 8 }}
              onClick={stopGeneration}
            >
              Durdur
            </button>
          </div>
        </div>
      )}

      {/* Tamamlanan süreç sonucu */}
      {lastResult && !isGenerating && (
        <div style={{
          margin: '12px 0',
          padding: '16px 20px',
          borderRadius: 14,
          background: lastResult.success
            ? 'linear-gradient(135deg, #052e16, #064e3b)'
            : 'linear-gradient(135deg, #1c0a00, #7c2d12)',
          color: '#e2e8f0',
          boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
          border: `1px solid ${lastResult.success ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: lastResult.success ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1.5px solid ${lastResult.success ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>
            {lastResult.success ? '✓' : '!'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>
              {lastResult.success ? 'Tüm dersler başarıyla yerleştirildi' : 'Yerleştirme tamamlandı'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {lastResult.message}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#475569', flexShrink: 0 }}>
            {lastResult.duration}s
          </div>
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ fontWeight: 600 }}>Eksik Dersler ({totalDeficits})</div>
          </div>
          {classDeficits.map(item => (
            <div key={item.classKey} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{item.classKey}:</span>{' '}
              {item.deficits.map(d => `${d.name} (${d.missing})`).join(', ')}
            </div>
          ))}
          {placementSuggestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Yerleşim Önerileri</div>
              {placementSuggestions.map((s, idx) => (
                <div key={idx} style={{ marginBottom: 2 }}>• {s}</div>
              ))}
            </div>
          )}
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

function pickTeacher(
  teachers: Teacher[],
  load: Map<string, number>,
  subjectId: string,
  gradeId: string,
  day: Day,
  slotIndex: number,
  opts?: {
    commit?: boolean
    requiredTeacherId?: string
    occupied?: Map<string, Set<string>>
    randomByTeacher?: Map<string, number>
    classKey?: string
    teacherClassDayCount?: Map<string, number>
  }
): string | undefined {
  const commit = opts?.commit ?? true
  const requiredTeacherId = opts?.requiredTeacherId
  const occupied = opts?.occupied
  const randomByTeacher = opts?.randomByTeacher
  const classKey = opts?.classKey
  const teacherClassDayCount = opts?.teacherClassDayCount

  const slotKey = `${day}-${slotIndex}`

  const choices = teachers.filter(t => {
    // If a specific teacher is required, only consider that teacher
    if (requiredTeacherId && t.id !== requiredTeacherId) return false

    const subs = getTeacherSubjectIds(t)
    if (!subs.includes(subjectId)) return false

    const hasSubjectPref = t.preferredGradesBySubject && Object.prototype.hasOwnProperty.call(t.preferredGradesBySubject, subjectId)
    if (hasSubjectPref) {
      const subjPref = t.preferredGradesBySubject?.[subjectId] ?? []
      if (!subjPref.includes(gradeId)) return false
    } else {
      const prefGrades = t.preferredGrades ?? []
      if (prefGrades.length > 0 && !prefGrades.includes(gradeId)) return false
    }

    // availability - ALWAYS check, never skip
    const blocked = t.unavailable?.[day]?.includes(`S${slotIndex + 1}`)
    if (blocked) return false

    const cur = load.get(t.id) ?? 0
    if (t.maxHours && cur >= t.maxHours) return false

    // Check if teacher is already teaching another class at this time - NEVER skip
    if (occupied && occupied.get(t.id)?.has(slotKey)) return false

    // Aynı sınıfa günde max 3 ders kontrolü
    if (classKey && teacherClassDayCount) {
      const tcdKey = `${t.id}|${classKey}|${day}`
      if ((teacherClassDayCount.get(tcdKey) ?? 0) >= 3) return false
    }

    return true
  })
  if (choices.length === 0) return undefined

  // Öncelik: minHours altındakileri doldur, sonra daha kısıtlı öğretmen (daha çok kapalı), sonra en az yük
  choices.sort((a, b) => {
    const curA = load.get(a.id) ?? 0
    const curB = load.get(b.id) ?? 0
    const underA = a.minHours ? curA < a.minHours : false
    const underB = b.minHours ? curB < b.minHours : false
    if (underA !== underB) return underA ? -1 : 1
    const unavailA = DAYS.reduce((sum, d) => sum + (a.unavailable?.[d]?.length ?? 0), 0)
    const unavailB = DAYS.reduce((sum, d) => sum + (b.unavailable?.[d]?.length ?? 0), 0)
    if (unavailA !== unavailB) return unavailB - unavailA
    if (curA !== curB) return curA - curB
    const randA = randomByTeacher?.get(a.id) ?? 0
    const randB = randomByTeacher?.get(b.id) ?? 0
    return randA - randB
  })
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
