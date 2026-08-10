import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import Toasts, { pushToast } from '../components/Toast'
import LockIcon from '../components/LockIcon'
import { useSchool } from '../shared/useSchool'
import { useGrades } from '../shared/useGrades'
import { useSubjects } from '../shared/useSubjects'
import { useTeachers } from '../shared/useTeachers'
import { useAssignments } from '../shared/useAssignments'
import type { Day, Subject, Teacher } from '../shared/types'
import { useLocalStorage } from '../shared/useLocalStorage'
import { generateClassHandbookHTML, generateClassSheetHTML } from '../shared/htmlPdfGenerator'
import { getSubjectAbbreviation, getTeacherAbbreviation } from '../shared/pdfUtils'

const DAYS: Day[] = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma']

type Cell = { subjectId?: string; teacherId?: string }
type ClassKey = string // e.g. "5-A"
type CellRef = { classKey: ClassKey; day: Day; si: number }

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
  const [lockedCells, setLockedCells] = useLocalStorage<string[]>('lockedCells', [])
  const lockedCellSet = useMemo(() => new Set(lockedCells), [lockedCells])
  const isCellLocked = (classKey: ClassKey, day: Day, si: number) =>
    lockedCellSet.has(`${classKey}|${day}|${si}`)
  const toggleCellLock = (classKey: ClassKey, day: Day, si: number) => {
    // Hücre 2 saatlik bir bloğun (ör. Beden Eğitimi) parçasıysa, kilidi
    // her iki hücreye birden uygula/kaldır — sadece yarısını kilitlemek
    // bloğu parçalanmaya açık bırakır.
    const dayCells = tables[classKey]?.[day]
    const cell = dayCells?.[si]
    const keys = [`${classKey}|${day}|${si}`]
    if (cell?.subjectId && dayCells) {
      const next = dayCells[si + 1]
      const prev = dayCells[si - 1]
      if (next && next.subjectId === cell.subjectId && next.teacherId === cell.teacherId) {
        keys.push(`${classKey}|${day}|${si + 1}`)
      } else if (prev && prev.subjectId === cell.subjectId && prev.teacherId === cell.teacherId) {
        keys.push(`${classKey}|${day}|${si - 1}`)
      }
    }
    setLockedCells((prevLocked) => {
      const isLocked = prevLocked.includes(keys[0])
      if (isLocked) return prevLocked.filter((k) => !keys.includes(k))
      const toAdd = keys.filter((k) => !prevLocked.includes(k))
      return [...prevLocked, ...toAdd]
    })
  }
  const clearAllCellLocks = () => setLockedCells([])

  // Sürükle-bırak / dokunarak taşıma için geçici arayüz durumu
  const [dragSource, setDragSource] = useState<CellRef | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<CellRef | null>(null)
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set())
  const [shakeCells, setShakeCells] = useState<Set<string>>(new Set())
  const [tapSelected, setTapSelected] = useState<CellRef | null>(null)
  // Bir ders seçilip taşınmaya başlandığında, o dersin gerçekten
  // konabileceği tüm hücrelerin anahtarları (kurallar canlı olarak
  // kontrol edilerek hesaplanır) — "nereye koyabilirim" önizlemesi için.
  const [validTargets, setValidTargets] = useState<Set<string> | null>(null)
  // Kaynak bir blok (2 saatlik) dersse: her geçerli hedef hücrenin anahtarını,
  // o hedefin ait olduğu çiftin BAŞLANGIÇ slotuna eşler. Render'ı tetiklemesi
  // gerekmez (sadece drop anında okunur), bu yüzden state değil ref.
  const blockTargetStarts = useRef<Map<string, number>>(new Map())

  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [showSheet, setShowSheet] = useState(false)
  const [requirementsGrade, setRequirementsGrade] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStart, setGenerationStart] = useState<number | null>(null)
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

  // Geçen süre sayacı (ilerleme çubuğu artık gerçek yerleşme oranını gösteriyor, bkz. placementRatio)
  useEffect(() => {
    let timer: number | undefined
    const tick = () => {
      if (isGenerating && generationStart != null) {
        const elapsed = (performance.now() - generationStart) / 1000
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

  const runOnce = (
    seed: number,
    opts?: { seedTables?: Record<ClassKey, Record<Day, Cell[]>>; saBudgetMs?: number }
  ) => {
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
    // Atama tablosundan (Atamalar sayfası) öğretmen başına KESİN yük hesapla —
    // bu, "uygun havuzdaki tahmini yük" hesabından çok daha doğru bir kıtlık
    // sinyali verir, çünkü bu okullarda genelde her sınıf-ders sabit bir
    // öğretmene atanmış olur (serbest seçim değil).
    const assignedHoursByTeacher = new Map<string, number>()
    const coveredClassSubjects = new Set<string>() // "classKey|subjId" — atama var mı?
    for (const c of classes) {
      for (const s of subjects) {
        const csKey = `${c.key}|${s.id}`
        const assignedTeacherId = assignments[csKey]
        if (!assignedTeacherId) continue
        coveredClassSubjects.add(csKey)
        const hours = s.weeklyHoursByGrade[c.grade] ?? 0
        if (hours <= 0) continue
        assignedHoursByTeacher.set(assignedTeacherId, (assignedHoursByTeacher.get(assignedTeacherId) ?? 0) + hours)
      }
    }

    const teacherLoadRatio = new Map<string, number>()
    for (const t of teachers) {
      const unavailCount = DAYS.reduce((sum, d) => sum + (t.unavailable?.[d]?.length ?? 0), 0)
      const available = Math.max(1, DAYS.length * slots.length - unavailCount)
      // Atanmış (kesin) saatlerle başla; atama tablosunda yer almayan
      // sınıf-ders kombinasyonları için eski tahmini (serbest seçim) modeli
      // kullan — böylece karışık kullanımda (bazı dersler atanmış, bazıları
      // değil) çift sayım olmaz.
      let totalReq = assignedHoursByTeacher.get(t.id) ?? 0
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
          const hours = subj.weeklyHoursByGrade?.[gid] ?? 0
          if (hours <= 0) continue
          for (const c of classes) {
            if (c.grade !== gid) continue
            if (coveredClassSubjects.has(`${c.key}|${sid}`)) continue
            totalReq += hours
          }
        }
      }
      teacherLoadRatio.set(t.id, totalReq / available)
    }

    // Sınıf-ders kombinasyonu atama tablosunda sabitlenmişse, o dersin
    // gerçek yoğunluk sinyali doğrudan atanan öğretmenin oranıdır (havuzdaki
    // "en yoğun ihtimal" tahminine gerek yok — kesin cevap zaten belli).
    const assignedTeacherScarcity = new Map<string, number>() // "classKey|subjId" -> ratio
    for (const c of classes) {
      for (const s of subjects) {
        const csKey = `${c.key}|${s.id}`
        const tId = assignments[csKey]
        if (!tId) continue
        assignedTeacherScarcity.set(csKey, teacherLoadRatio.get(tId) ?? 0)
      }
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
    // KİLİTLİ ÖĞRETMEN + KİLİTLİ HÜCRE SLOTLARINI ÖN YERLEŞTIR
    // (opts.seedTables verildiyse: sıfırdan Faz 1 kurmak yerine mevcut en iyi
    // çözümü olduğu gibi başlangıç noktası yap. generate()'in "cilalama"
    // modu bunu kullanır — geniş SA bütçesiyle var olan iyi bir çözümü
    // üzerinde çalışıp iyileştirmeyi dener, sıfırdan şansını denemek yerine.)
    // ═══════════════════════════════════════════════════════════════
    const seedTables = opts?.seedTables
    if (seedTables || lockedTeachers.length > 0 || lockedCellSet.size > 0) {
      for (const c of classes) {
        for (const day of DAYS) {
          const existingDay = (seedTables ?? tables)[c.key]?.[day]
          if (!existingDay) continue
          for (let si = 0; si < existingDay.length; si++) {
            const cell = existingDay[si]
            if (!cell?.subjectId || !cell.teacherId) continue
            if (!seedTables) {
              const teacherLocked = lockedTeachers.includes(cell.teacherId)
              const cellLocked = isCellLocked(c.key, day, si)
              if (!teacherLocked && !cellLocked) continue
            }
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
      // 1. Yoğunluğu yüksek öğretmenin dersleri önce (en kritik kısıt) —
      //    Atama tablosunda sabit bir öğretmen varsa onun GERÇEK oranını
      //    kullan (en kesin sinyal); yoksa uygun havuzdaki en yoğun
      //    ihtimale göre tahmin et. Yoğunluk = zorunlu saat / müsait slot.
      const la = assignedTeacherScarcity.get(`${a.classKey}|${a.subjId}`) ?? maxTeacherLoadBySubjectGrade.get(`${a.subjId}|${a.gradeId}`) ?? 0
      const lb = assignedTeacherScarcity.get(`${b.classKey}|${b.subjId}`) ?? maxTeacherLoadBySubjectGrade.get(`${b.subjId}|${b.gradeId}`) ?? 0
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

    // placeCell'in tersi. Simulated annealing fazının hamlelerini geri almak için kullanılır.
    // classSubjectTeacher / gradeSubjectAssignedTeachers kilidini yalnızca bu sınıf-ders için
    // hiç hücre kalmadığında serbest bırakır (başka hücreler hâlâ o kilide güveniyor olabilir).
    const unplaceCell = (classKey: ClassKey, day: Day, si: number): { subjId: string; teacherId: string } | null => {
      const cell = workingTables[classKey][day][si]
      if (!cell?.subjectId || !cell.teacherId) return null
      const subjId = cell.subjectId
      const teacherId = cell.teacherId

      workingTables[classKey][day][si] = {}
      teacherLoad.set(teacherId, Math.max(0, (teacherLoad.get(teacherId) ?? 0) - 1))
      teacherOccupied.get(teacherId)?.delete(`${day}-${si}`)
      const tcdKey = `${teacherId}|${classKey}|${day}`
      teacherClassDayCount.set(tcdKey, Math.max(0, (teacherClassDayCount.get(tcdKey) ?? 0) - 1))
      recomputeSubjectDays(classKey, subjId)

      const stillHasCells = DAYS.some(d => workingTables[classKey][d].some(c => c.subjectId === subjId))
      if (!stillHasCells) {
        delete classSubjectTeacher[classKey][subjId]
        const gradeId = classGradeMap.get(classKey) ?? ''
        const gsKey = `${gradeId}|${subjId}`
        const usedElsewhereInGrade = classes.some(c =>
          c.key !== classKey && c.grade === gradeId &&
          DAYS.some(d => workingTables[c.key][d].some(cc => cc.subjectId === subjId && cc.teacherId === teacherId))
        )
        if (!usedElsewhereInGrade) gradeSubjectAssignedTeachers.get(gsKey)?.delete(teacherId)
      }
      return { subjId, teacherId }
    }

    const tryRelocateSingle = (classKey: ClassKey, day: Day, si: number): boolean => {
      if (isCellLocked(classKey, day, si)) return false
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
      if (isCellLocked(classKey, day, si)) return false
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
          if (isCellLocked(classKey, d2, s2)) continue
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

    // tryRelocateSingle/tryChainRelocate bilerek blok derslerin (2 saatlik,
    // aynı öğretmen) parçalarına hiç dokunmuyor — bir bloğu bozmadan taşımak
    // farklı bir mantık gerektiriyor. Bu yüzden bir blok "yanlış" günde
    // kilitli kalıp o günün geri kalan boşluklarını başka bir derse hiç
    // vermeden tutabiliyor (özellikle her sınıfın haftası tam doluyken, ki
    // bu durumda başka hiçbir onarım hamlesi bloğu es geçip devam edemiyor).
    // Bu fonksiyon bloğu bütün halinde, zaten boş olan başka bir gün+saat
    // çiftine taşımayı dener.
    const tryRelocateBlockPair = (classKey: ClassKey, day: Day, si: number): boolean => {
      const cell = workingTables[classKey][day][si]
      if (!cell?.subjectId || !cell.teacherId) return false
      const sameDay = workingTables[classKey][day]
      let blockStart = -1
      if (si + 1 < sameDay.length && sameDay[si + 1]?.subjectId === cell.subjectId && sameDay[si + 1]?.teacherId === cell.teacherId) {
        blockStart = si
      } else if (si - 1 >= 0 && sameDay[si - 1]?.subjectId === cell.subjectId && sameDay[si - 1]?.teacherId === cell.teacherId) {
        blockStart = si - 1
      }
      if (blockStart === -1) return false // blok değil, tek ders — bu fonksiyonun işi değil

      if (isCellLocked(classKey, day, blockStart) || isCellLocked(classKey, day, blockStart + 1)) return false

      const subjId = cell.subjectId
      const teacherId = cell.teacherId
      const teacher = teachers.find(t => t.id === teacherId)

      for (const day2 of DAYS) {
        if (day2 === day) continue
        for (let si2 = 0; si2 < slots.length - 1; si2++) {
          if (!isFree(classKey, day2, si2) || !isFree(classKey, day2, si2 + 1)) continue
          if (!canPlaceWithRules(classKey, day2, si2, subjId, true)) continue

          const occKey1 = `${day2}-${si2}`
          const occKey2 = `${day2}-${si2 + 1}`
          if (teacherOccupied.get(teacherId)?.has(occKey1)) continue
          if (teacherOccupied.get(teacherId)?.has(occKey2)) continue
          if (teacher?.unavailable?.[day2]?.includes(`S${si2 + 1}`)) continue
          if (teacher?.unavailable?.[day2]?.includes(`S${si2 + 2}`)) continue
          const tcdKeyNew = `${teacherId}|${classKey}|${day2}`
          if ((teacherClassDayCount.get(tcdKeyNew) ?? 0) >= 3) continue

          workingTables[classKey][day2][si2] = { subjectId: subjId, teacherId }
          workingTables[classKey][day2][si2 + 1] = { subjectId: subjId, teacherId }
          workingTables[classKey][day][blockStart] = {}
          workingTables[classKey][day][blockStart + 1] = {}

          teacherOccupied.get(teacherId)?.delete(`${day}-${blockStart}`)
          teacherOccupied.get(teacherId)?.delete(`${day}-${blockStart + 1}`)
          if (!teacherOccupied.has(teacherId)) teacherOccupied.set(teacherId, new Set())
          teacherOccupied.get(teacherId)!.add(occKey1)
          teacherOccupied.get(teacherId)!.add(occKey2)

          const tcdKeyOld = `${teacherId}|${classKey}|${day}`
          teacherClassDayCount.set(tcdKeyOld, Math.max(0, (teacherClassDayCount.get(tcdKeyOld) ?? 0) - 2))
          teacherClassDayCount.set(tcdKeyNew, (teacherClassDayCount.get(tcdKeyNew) ?? 0) + 2)

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
      } else if (isBlock && !placed && isMandatory) {
        // Beden gibi zorunlu blok dersler burada ASLA tek saate düşürülmemeli:
        // bunu tek ders gibi yerleştirirsek diğer saati çok sonra, habersizce
        // başka bir güne/saate koyarız ve "arka arkaya" garantisi bozulur.
        // Bütün 2 saatlik dersi olduğu gibi sonraki fazlara bırak (orada da
        // yalnızca blok olarak denenecek).
        stillUnplaced.push(lesson)
      } else if (!isBlock && !placed) {
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
      const subjForMandatoryCheck = subjects.find(s => s.id === subjId)
      const isMandatory = subjForMandatoryCheck ? isMandatoryBlock(subjForMandatoryCheck, gradeId) : false
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

      // Beden gibi zorunlu blok dersler burada da tekli/dağınık saatlere
      // bölünmesin; blok denemesi başarısızsa bütün olarak sonraki faza bırak.
      if (!placedHere && !(isBlock && isMandatory)) {
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
      if (isCellLocked(bck, day, si)) return false

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
            if (
              !tryRelocateSingle(classKey, day, si) &&
              !tryChainRelocate(classKey, day, si) &&
              !tryRelocateBlockPair(classKey, day, si)
            ) continue
          }
          if (!isFree(classKey, day, si)) continue

          // Adım 2 (blok): si+1 slotunu boşalt
          if (isBlock) {
            if (!isFree(classKey, day, si + 1)) {
              if (
                !tryRelocateSingle(classKey, day, si + 1) &&
                !tryChainRelocate(classKey, day, si + 1) &&
                !tryRelocateBlockPair(classKey, day, si + 1)
              ) continue
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

                if (tryRelocateBlockPair(c.key, day, si)) {
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

    let deficits = classes.map(c => ({
      classKey: c.key,
      deficits: calculateDeficits(c, workingTables[c.key], subjects)
    }))
    let totalMissing = deficits.reduce(
      (sum, item) => sum + item.deficits.reduce((s, d) => s + d.missing, 0),
      0
    )

    // ═══════════════════════════════════════════════════════════════
    // PHASE 8: Simulated Annealing — Faz 1-7 sonrası kalan eksikleri iyileştir
    // Faz 1-7 zaten çoğu senaryoyu tam çözüyor; bu faz SADECE hâlâ eksik
    // ders varsa çalışır, bu yüzden zaten çözülen durumlarda davranış
    // birebir aynı kalır. Rastgele hamleler dener (boşluğa yerleştir /
    // iki dersi yer değiştir / birini feda et) ve "sıcaklık" düştükçe
    // kötü hamleleri daha az kabul ederek (Metropolis kriteri) Faz 1-7'nin
    // asla kötüleşmeyen onarımlarının sıkışıp kaldığı yerel çözümlerden
    // kaçabilir.
    // ═══════════════════════════════════════════════════════════════
    if (totalMissing > 0) {
      const cloneWorkingTables = (): Record<ClassKey, Record<Day, Cell[]>> => {
        const out: Record<ClassKey, Record<Day, Cell[]>> = {}
        for (const c of classes) {
          out[c.key] = {} as Record<Day, Cell[]>
          for (const day of DAYS) out[c.key][day] = workingTables[c.key][day].map(cell => ({ ...cell }))
        }
        return out
      }

      const pickRandomOccupiedSingle = (): { classKey: ClassKey; day: Day; si: number; subjId: string; teacherId: string } | null => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const c = classes[Math.floor(rng() * classes.length)]
          const day = DAYS[Math.floor(rng() * DAYS.length)]
          const si = Math.floor(rng() * slots.length)
          const cell = workingTables[c.key][day][si]
          if (!cell?.subjectId || !cell.teacherId) continue
          if (isCellLocked(c.key, day, si)) continue
          const dayCells = workingTables[c.key][day]
          const isBlockPart =
            (si + 1 < dayCells.length && dayCells[si + 1]?.subjectId === cell.subjectId && dayCells[si + 1]?.teacherId === cell.teacherId) ||
            (si - 1 >= 0 && dayCells[si - 1]?.subjectId === cell.subjectId && dayCells[si - 1]?.teacherId === cell.teacherId)
          if (isBlockPart) continue // blok dersler bu MVP'de SA tarafından taşınmaz, Faz 1-7'nin işi
          return { classKey: c.key, day, si, subjId: cell.subjectId, teacherId: cell.teacherId }
        }
        return null
      }

      let currentMissing = totalMissing
      let bestMissing = currentMissing
      let bestSnap = cloneWorkingTables()

      const T_START = 1.2
      const COOL = 0.97
      const T_MIN = 0.05
      const TIME_BUDGET_MS = opts?.saBudgetMs ?? 15
      // Cilalama modunda (büyük saBudgetMs) çok daha fazla iterasyona izin ver —
      // aksi halde MAX_ITERS düşük kalırsa süre bütçesinin çoğu boşa gider.
      const MAX_ITERS = opts?.saBudgetMs ? Math.max(200, Math.ceil(opts.saBudgetMs * 40)) : 200
      const CHECK_EVERY = 25

      let temperature = T_START
      const saStart = performance.now()

      for (let iter = 0; iter < MAX_ITERS; iter++) {
        if (currentMissing === 0) break
        if (iter % CHECK_EVERY === 0 && performance.now() - saStart > TIME_BUDGET_MS) break

        const roll = rng()

        if (roll < 0.5) {
          // Hamle A: eksik bir dersi yerleştirmeyi dene (asla kötüleştirmez)
          const withDeficit: { classKey: ClassKey; gradeId: string; subjId: string; missing: number; isMandatory: boolean }[] = []
          for (const c of classes) {
            const gradeId = c.grade
            const counts: Record<string, number> = {}
            for (const day of DAYS) {
              for (const cell of workingTables[c.key][day]) {
                if (cell?.subjectId) counts[cell.subjectId] = (counts[cell.subjectId] ?? 0) + 1
              }
            }
            for (const s of subjects) {
              const need = s.weeklyHoursByGrade[gradeId] ?? 0
              if (need <= 0) continue
              const missing = need - (counts[s.id] ?? 0)
              if (missing > 0) withDeficit.push({ classKey: c.key, gradeId, subjId: s.id, missing, isMandatory: isMandatoryBlock(s, gradeId) })
            }
          }
          if (withDeficit.length > 0) {
            const pick = withDeficit[Math.floor(rng() * withDeficit.length)]
            const useBlock = pick.isMandatory && pick.missing >= 2
            const placed = tryPlaceDeep(pick.classKey, pick.subjId, pick.gradeId, useBlock)
            if (placed) currentMissing -= useBlock ? 2 : 1
          }
        } else if (roll < 0.8) {
          // Hamle B: iki dersi yer değiştir (toplam eksik sayısı değişmez,
          // ama düzeni bozup yeniden kurarak yeni olasılıklar açar)
          const a = pickRandomOccupiedSingle()
          const b = pickRandomOccupiedSingle()
          if (a && b && !(a.classKey === b.classKey && a.day === b.day && a.si === b.si) && a.subjId !== b.subjId) {
            const gradeA = classGradeMap.get(a.classKey) ?? ''
            const gradeB = classGradeMap.get(b.classKey) ?? ''
            // Bu sınıflarda ilgili ders zaten başka bir öğretmene kilitliyse
            // (aynı sınıf-ders her zaman aynı öğretmeni kullanmalı), o öğretmeni zorunlu kıl.
            const requiredAtA = classSubjectTeacher[a.classKey]?.[b.subjId]
            const requiredAtB = classSubjectTeacher[b.classKey]?.[a.subjId]

            unplaceCell(a.classKey, a.day, a.si)
            unplaceCell(b.classKey, b.day, b.si)

            const teacherAtA = pickTeacher(
              filterAllowedTeachers(teachers, b.subjId, gradeA), teacherLoad, b.subjId, gradeA, a.day, a.si,
              { commit: false, requiredTeacherId: requiredAtA, occupied: teacherOccupied, randomByTeacher: teacherRandom, classKey: a.classKey, teacherClassDayCount }
            )
            const teacherAtB = pickTeacher(
              filterAllowedTeachers(teachers, a.subjId, gradeB), teacherLoad, a.subjId, gradeB, b.day, b.si,
              { commit: false, requiredTeacherId: requiredAtB, occupied: teacherOccupied, randomByTeacher: teacherRandom, classKey: b.classKey, teacherClassDayCount }
            )
            const validA = !!teacherAtA && canPlaceWithRules(a.classKey, a.day, a.si, b.subjId, false)
            const validB = !!teacherAtB && canPlaceWithRules(b.classKey, b.day, b.si, a.subjId, false)

            if (validA && validB && teacherAtA && teacherAtB) {
              placeCell(a.classKey, a.day, a.si, b.subjId, teacherAtA)
              placeCell(b.classKey, b.day, b.si, a.subjId, teacherAtB)
            } else {
              // geri al
              placeCell(a.classKey, a.day, a.si, a.subjId, a.teacherId)
              placeCell(b.classKey, b.day, b.si, b.subjId, b.teacherId)
            }
          }
        } else {
          // Hamle C: rastgele bir dersi feda et — Metropolis kriteriyle kabul/red edilir.
          // Bu, maliyeti gerçekten kötüleştirebilen tek hamledir; onu göze
          // alabilmek Faz 1-7'nin asla geri adım atmayan onarımının çıkamayacağı
          // çıkmazlardan kaçmayı sağlar.
          const victim = pickRandomOccupiedSingle()
          if (victim) {
            unplaceCell(victim.classKey, victim.day, victim.si)
            const delta = 1
            if (rng() < Math.exp(-delta / temperature)) {
              currentMissing += delta
            } else {
              placeCell(victim.classKey, victim.day, victim.si, victim.subjId, victim.teacherId)
            }
          }
        }

        if (currentMissing < bestMissing) {
          bestMissing = currentMissing
          bestSnap = cloneWorkingTables()
        }
        temperature = Math.max(T_MIN, temperature * COOL)
      }

      if (bestMissing < currentMissing) {
        for (const c of classes) {
          for (const day of DAYS) {
            workingTables[c.key][day] = bestSnap[c.key][day]
          }
        }
      }

      deficits = classes.map(c => ({
        classKey: c.key,
        deficits: calculateDeficits(c, workingTables[c.key], subjects)
      }))
      totalMissing = deficits.reduce(
        (sum, item) => sum + item.deficits.reduce((s, d) => s + d.missing, 0),
        0
      )
    }

    return { tables: workingTables, totalMissing, deficits }
  }

  const generate = () => {
    stopRef.current = false
    setIsGenerating(true)
    setGenerationStart(performance.now())
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

    // Sıfırdan-kurma (restart) taraması bir noktadan sonra çıkmaza girebilir:
    // her deneme %95+ dolu ama son birkaç saat bir türlü oturmuyor (özellikle
    // her sınıfın haftası tam dolu olduğunda — boşluk yok, tek bir yanlış
    // erken karar telafisiz kalabiliyor). Bu durumda yeni bir rastgele kurulum
    // denemek yerine, elimizdeki en iyi çözüm üzerinde çok daha uzun bir
    // simulated annealing turu ("cilalama") çalıştırmak çok daha etkili:
    // SA'ya sıfırdan başlamak yerine zaten %95+ tamamlanmış bir duruma devam
    // etme fırsatı veriyoruz. İlerleme durursa modlar arasında geçiş yaparız.
    let mode: 'restart' | 'polish' = 'restart'
    let stuckTicks = 0
    const RESTART_STUCK_LIMIT = 6
    const POLISH_STUCK_LIMIT = 10

    const finish = (now: number) => {
      const duration = Math.round((now - start) / 1000)
      setTables(best.tables)
      setIsGenerating(false)
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
      if (now - start > 900000) {
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

      const missingBeforeTick = best.totalMissing

      if (mode === 'restart') {
        // 50 deneme/tick — artık her deneme sonunda kısa bir simulated annealing
        // iyileştirmesi de çalışabiliyor (bkz. runOnce PHASE 8), bu yüzden batch
        // boyutu küçültüldü: tek bir tick'in en kötü ihtimalle süresi sınırlı
        // kalır ve ilerleme çubuğu daha sık güncellenir.
        for (let i = 0; i < 50; i++) {
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
      } else {
        // CİLALAMA MODU: sıfırdan yeni bir kurulum denemek yerine, elimizdeki
        // en iyi çözümü başlangıç noktası alıp üzerinde çok daha uzun
        // (300ms'lik) bir simulated annealing turu çalıştırıyoruz. Her deneme
        // farklı bir rastgele hamle dizisiyle aynı iyi başlangıçtan yola çıkar.
        for (let i = 0; i < 6; i++) {
          tried += 1
          const currentSeed = xorNext()
          const res = runOnce(currentSeed, { seedTables: best.tables, saBudgetMs: 300 })

          if (res.totalMissing < best.totalMissing) {
            best = res
            setTables(best.tables)
            setBestMissing(best.totalMissing)
          }

          if (best.totalMissing === 0) break
        }
      }

      if (best.totalMissing < missingBeforeTick) {
        stuckTicks = 0
      } else {
        stuckTicks += 1
        if (mode === 'restart' && stuckTicks >= RESTART_STUCK_LIMIT) {
          mode = 'polish'
          stuckTicks = 0
        } else if (mode === 'polish' && stuckTicks >= POLISH_STUCK_LIMIT) {
          mode = 'restart'
          stuckTicks = 0
        }
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

  // İlerleme çubuğu artık geçen süre yerine gerçekte kaç ders saatinin
  // yerleştiğini gösterir (0-900s'lik zaman sınırı değil, dersler/toplam oranı)
  const placementRatio = totalReqState > 0
    ? Math.min(1, Math.max(0, (totalReqState - bestMissing) / totalReqState))
    : 0

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

  const placementHints = useMemo(() => {
    if (!Object.keys(tables ?? {}).length) return []

    const teacherBusy = new Map<string, Set<string>>() // teacherId -> Set(day-slot)
    const teacherBusyClass = new Map<string, ClassKey>() // "teacherId|day-slot" -> hangi sınıf o saati tutuyor
    for (const [classKey, schedule] of Object.entries(tables)) {
      for (const day of DAYS) {
        schedule[day]?.forEach((cell, si) => {
          if (!cell?.teacherId) return
          if (!teacherBusy.has(cell.teacherId)) teacherBusy.set(cell.teacherId, new Set())
          teacherBusy.get(cell.teacherId)!.add(`${day}-${si}`)
          teacherBusyClass.set(`${cell.teacherId}|${day}-${si}`, classKey)
        })
      }
    }

    // Her öneri, mümkünse "hangi ders taşınırsa yer açılır" (blockerKey) bilgisini
    // de taşır — bu, aşağıdaki tabloda o dersin hücresini amber renkle
    // vurgulamak için kullanılır (metni okumadan doğrudan programda görünür).
    const suggestions: { text: string; blockerKey?: string }[] = []
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
                suggestions.push({ text: `${item.classKey} ${subj.name}: ${teacher.name} için ${slot.day} S${slot.si + 1} açılırsa yerleşebilir.` })
                seen.add(key)
              }
            }

            // Çakışma varsa, hangi sınıfın dersinin taşınması gerektiğini adıyla söyle
            if (!unavailable && busy) {
              const key = `${item.classKey}-${subj.id}-${teacher.id}-${slot.day}-${slot.si}-busy`
              if (!seen.has(key)) {
                const blockingClassKey = teacherBusyClass.get(`${teacher.id}|${slot.day}-${slot.si}`)
                const blockingLabel = blockingClassKey ? `${blockingClassKey} sınıfında` : 'başka bir sınıfta'
                const blockerKey = blockingClassKey ? `${blockingClassKey}|${slot.day}|${slot.si}` : undefined
                suggestions.push({
                  text: `${item.classKey} ${subj.name}: ${teacher.name} aynı saatte ${blockingLabel} ders veriyor (${slot.day} S${slot.si + 1}). Bu ders taşınırsa yerleşebilir.`,
                  blockerKey,
                })
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

  // Öneriler içindeki "bu ders taşınırsa yer açılır" işaretli hücrelerin
  // anahtarları — programda doğrudan amber renkte yanıp sönerek gösterilir.
  const placementBlockerCells = useMemo(() => {
    const set = new Set<string>()
    placementHints.forEach((h) => { if (h.blockerKey) set.add(h.blockerKey) })
    return set
  }, [placementHints])

  // ═══════════════════════════════════════════════════════════════
  // MANUEL DÜZENLEME: sürükle-bırak / dokunarak taşıma + hücre kilitleme
  // Faz 1-7 + 8 (üretim algoritması) ile aynı kuralları (günlük üst sınır,
  // en az gün, üst üste limit, bitişiklik, kaçınılacak saat, öğretmen
  // uygunluğu/çakışması) canlı `tables` durumu üzerinde yeniden değerlendirir.
  // ═══════════════════════════════════════════════════════════════
  const sameCell = (a: CellRef, b: CellRef) =>
    a.classKey === b.classKey && a.day === b.day && a.si === b.si
  const cellKeyOf = (r: CellRef) => `${r.classKey}|${r.day}|${r.si}`

  // Bir hücre 2 saatlik bir bloğun (ör. Beden Eğitimi) parçasıysa, bloğun
  // [başlangıç, bitiş] slot indekslerini döner — değilse null. Sürükle-bırak
  // artık blokları tek parça olarak taşıyabildiği için (bkz. computeValidTargets/
  // attemptBlockPlacement) bu, "hangi iki hücre birlikte hareket etmeli" sorusunun
  // tek kaynağı.
  const getBlockBounds = (classKey: ClassKey, day: Day, si: number): [number, number] | null => {
    const dayCells = tables[classKey]?.[day]
    const cell = dayCells?.[si]
    if (!cell?.subjectId || !cell.teacherId) return null
    const next = dayCells[si + 1]
    const prev = dayCells[si - 1]
    if (next && next.subjectId === cell.subjectId && next.teacherId === cell.teacherId) return [si, si + 1]
    if (prev && prev.subjectId === cell.subjectId && prev.teacherId === cell.teacherId) return [si - 1, si]
    return null
  }

  const isBlockCell = (classKey: ClassKey, day: Day, si: number): boolean =>
    getBlockBounds(classKey, day, si) !== null

  const isDraggableCell = (classKey: ClassKey, day: Day, si: number): boolean => {
    const cell = tables[classKey]?.[day]?.[si]
    if (!cell?.subjectId) return false
    const bounds = getBlockBounds(classKey, day, si)
    if (bounds) return !isCellLocked(classKey, day, bounds[0]) && !isCellLocked(classKey, day, bounds[1])
    return !isCellLocked(classKey, day, si)
  }

  // Bir blok hücresinin hangi yarısına tıklanırsa tıklansın, kaynağı her zaman
  // bloğun başlangıç hücresine sabitler — böylece dragSource/tapSelected ve
  // attemptPlacement tek bir tutarlı referansla çalışır.
  const normalizeCellRef = (ref: CellRef): CellRef => {
    const bounds = getBlockBounds(ref.classKey, ref.day, ref.si)
    return bounds ? { ...ref, si: bounds[0] } : ref
  }

  // Sürüklenen/seçilen kaynak bir blok ise, bloğun HER İKİ hücresi de
  // "kaynak" olarak vurgulanmalı (tek hücre değil).
  const isSourceCell = (source: CellRef | null, cellRef: CellRef): boolean => {
    if (!source) return false
    if (sameCell(source, cellRef)) return true
    if (source.classKey !== cellRef.classKey || source.day !== cellRef.day) return false
    const bounds = getBlockBounds(source.classKey, source.day, source.si)
    return !!bounds && (cellRef.si === bounds[0] || cellRef.si === bounds[1])
  }

  const isLockableCell = (classKey: ClassKey, day: Day, si: number): boolean => {
    const cell = tables[classKey]?.[day]?.[si]
    return !!cell?.subjectId
  }

  const isVacated = (vacated: CellRef[], classKey: ClassKey, day: Day, si: number) =>
    vacated.some((v) => v.classKey === classKey && v.day === day && v.si === si)

  const daySubjectCountLive = (classKey: ClassKey, day: Day, subjId: string, vacated: CellRef[]): number => {
    const dayCells = tables[classKey]?.[day] ?? []
    let n = 0
    dayCells.forEach((c, i) => {
      if (isVacated(vacated, classKey, day, i)) return
      if (c?.subjectId === subjId) n++
    })
    return n
  }

  const checkSubjectPlacement = (
    classKey: ClassKey, day: Day, si: number, subject: Subject, vacated: CellRef[]
  ): string | null => {
    const rule = subject.rule
    const currentDayCount = daySubjectCountLive(classKey, day, subject.id, vacated)
    const perDayMax = rule?.perDayMax ?? 0
    const effectivePerDayMax = perDayMax > 0 ? perDayMax : 2
    if (currentDayCount + 1 > effectivePerDayMax) return `${subject.name}: günlük üst sınır (${effectivePerDayMax}) aşılır`

    const minDays = rule?.minDays ?? 0
    if (minDays > 0) {
      const daysWithSubject = new Set<Day>()
      for (const d of DAYS) {
        const dayCells = tables[classKey]?.[d] ?? []
        dayCells.forEach((c, i) => {
          if (isVacated(vacated, classKey, d, i)) return
          if (c?.subjectId === subject.id) daysWithSubject.add(d)
        })
      }
      const alreadyThisDay = daysWithSubject.has(day)
      if (!alreadyThisDay && daysWithSubject.size < minDays - 1 && currentDayCount > 0) {
        return `${subject.name}: en az ${minDays} güne yayılma kuralı bozulur`
      }
    }

    const maxConsec = rule?.maxConsecutive ?? 0
    if (maxConsec > 0) {
      const dayCells = tables[classKey][day]
      let backward = 0
      for (let k = si - 1; k >= 0; k--) {
        if (isVacated(vacated, classKey, day, k)) break
        if (dayCells[k]?.subjectId !== subject.id) break
        backward++
      }
      let forward = 0
      for (let k = si + 1; k < slots.length; k++) {
        if (isVacated(vacated, classKey, day, k)) break
        if (dayCells[k]?.subjectId !== subject.id) break
        forward++
      }
      if (backward + 1 + forward > maxConsec) return `${subject.name}: art arda en fazla ${maxConsec} saat olabilir`
    }

    // Ardışıklık: aynı günde aynı ders varsa yeni slot mevcut bloğa bitişik olmalı
    {
      const dayCells = tables[classKey][day]
      const existingOnDay: number[] = []
      dayCells.forEach((c, i) => {
        if (isVacated(vacated, classKey, day, i)) return
        if (c?.subjectId === subject.id) existingOnDay.push(i)
      })
      if (existingOnDay.length > 0) {
        const combined = [...existingOnDay, si].sort((a, b) => a - b)
        for (let i = 1; i < combined.length; i++) {
          if (combined[i] !== combined[i - 1] + 1) return `${subject.name}: aynı gün içinde bitişik olmalı`
        }
      }
    }

    const slotLabel = `S${si + 1}`
    if (rule?.avoidSlots?.includes(slotLabel)) return `${subject.name}: bu saat kaçınılacak saatler arasında`

    return null
  }

  const checkTeacherPlacement = (
    day: Day, si: number, teacher: Teacher, vacated: CellRef[]
  ): string | null => {
    const slotLabel = `S${si + 1}`
    if (teacher.unavailable?.[day]?.includes(slotLabel)) return `${teacher.name} bu saatte müsait değil`
    for (const c of classes) {
      if (isVacated(vacated, c.key, day, si)) continue
      if (tables[c.key]?.[day]?.[si]?.teacherId === teacher.id) {
        return `${teacher.name} bu saatte ${c.key} sınıfında ders veriyor`
      }
    }
    return null
  }

  // Bir ders taşınmaya başlandığında, o dersin gerçekten konabileceği tüm
  // hücreleri (aynı sınıf içinde — bir ders başka sınıfa geçemez, çünkü her
  // sınıfın kendi haftalık saat ihtiyacı var) attemptPlacement ile BİREBİR
  // aynı kuralları kontrol ederek bulur. "Nereye koyabilirim" önizlemesi
  // (yeşil vurgulama) bunu kullanır.
  // Blok (2 saatlik) bir dersin taşınabileceği tüm gün+çift-slot başlangıçlarını
  // bulur: ya tamamen boş bir çifte, ya da tam eşleşen başka bir bloğa (yer
  // değiştirerek). Karışık durumlar (yarı boş/yarı tek ders vb.) desteklenmiyor —
  // bunlar önce tek ders taşımalarıyla çözülmeli, bu yüzden hedef olarak sayılmaz.
  const computeBlockValidTargets = (source: CellRef, bounds: [number, number]): Set<string> => {
    const result = new Set<string>()
    const [sA, sB] = bounds
    if (isCellLocked(source.classKey, source.day, sA) || isCellLocked(source.classKey, source.day, sB)) return result
    const sourceCell = tables[source.classKey]?.[source.day]?.[sA]
    if (!sourceCell?.subjectId || !sourceCell.teacherId) return result
    const sourceSubject = subjects.find((s) => s.id === sourceCell.subjectId)
    const sourceTeacher = teachers.find((t) => t.id === sourceCell.teacherId)
    if (!sourceSubject || !sourceTeacher) return result
    const vacatedSource: CellRef[] = [
      { classKey: source.classKey, day: source.day, si: sA },
      { classKey: source.classKey, day: source.day, si: sB },
    ]

    for (const day of DAYS) {
      for (let tA = 0; tA < slots.length - 1; tA++) {
        const tB = tA + 1
        if (day === source.day && tA <= sB && tB >= sA) continue // kaynakla çakışıyor
        if (isCellLocked(source.classKey, day, tA) || isCellLocked(source.classKey, day, tB)) continue
        const cellA = tables[source.classKey]?.[day]?.[tA]
        const cellB = tables[source.classKey]?.[day]?.[tB]
        const targetA: CellRef = { classKey: source.classKey, day, si: tA }
        const targetB: CellRef = { classKey: source.classKey, day, si: tB }

        if (!cellA?.subjectId && !cellB?.subjectId) {
          const reason =
            checkSubjectPlacement(source.classKey, day, tA, sourceSubject, vacatedSource) ??
            checkSubjectPlacement(source.classKey, day, tB, sourceSubject, vacatedSource) ??
            checkTeacherPlacement(day, tA, sourceTeacher, vacatedSource) ??
            checkTeacherPlacement(day, tB, sourceTeacher, vacatedSource)
          if (reason) continue
        } else if (
          cellA?.subjectId && cellA.teacherId && cellB?.subjectId &&
          cellA.subjectId === cellB.subjectId && cellA.teacherId === cellB.teacherId
        ) {
          const targetSubject = subjects.find((s) => s.id === cellA.subjectId)
          const targetTeacher = teachers.find((t) => t.id === cellA.teacherId)
          if (!targetSubject || !targetTeacher) continue
          const vacated: CellRef[] = [...vacatedSource, targetA, targetB]
          const reasonA =
            checkSubjectPlacement(source.classKey, day, tA, sourceSubject, vacated) ??
            checkSubjectPlacement(source.classKey, day, tB, sourceSubject, vacated) ??
            checkTeacherPlacement(day, tA, sourceTeacher, vacated) ??
            checkTeacherPlacement(day, tB, sourceTeacher, vacated)
          if (reasonA) continue
          const reasonB =
            checkSubjectPlacement(source.classKey, source.day, sA, targetSubject, vacated) ??
            checkSubjectPlacement(source.classKey, source.day, sB, targetSubject, vacated) ??
            checkTeacherPlacement(source.day, sA, targetTeacher, vacated) ??
            checkTeacherPlacement(source.day, sB, targetTeacher, vacated)
          if (reasonB) continue
        } else {
          continue // karışık doluluk — desteklenmiyor
        }

        result.add(cellKeyOf(targetA))
        result.add(cellKeyOf(targetB))
        blockTargetStarts.current.set(cellKeyOf(targetA), tA)
        blockTargetStarts.current.set(cellKeyOf(targetB), tA)
      }
    }
    return result
  }

  const computeValidTargets = (source: CellRef): Set<string> => {
    blockTargetStarts.current = new Map()
    const blockBounds = getBlockBounds(source.classKey, source.day, source.si)
    if (blockBounds) return computeBlockValidTargets(source, blockBounds)

    const result = new Set<string>()
    if (isCellLocked(source.classKey, source.day, source.si)) return result
    const sourceCell = tables[source.classKey]?.[source.day]?.[source.si]
    if (!sourceCell?.subjectId || !sourceCell.teacherId) return result
    const sourceSubject = subjects.find((s) => s.id === sourceCell.subjectId)
    const sourceTeacher = teachers.find((t) => t.id === sourceCell.teacherId)
    if (!sourceSubject || !sourceTeacher) return result

    for (const day of DAYS) {
      for (let si = 0; si < slots.length; si++) {
        if (day === source.day && si === source.si) continue
        if (isCellLocked(source.classKey, day, si)) continue
        if (isBlockCell(source.classKey, day, si)) continue
        const target: CellRef = { classKey: source.classKey, day, si }
        const targetCell = tables[source.classKey]?.[day]?.[si]

        if (!targetCell?.subjectId) {
          const vacated: CellRef[] = [source]
          const reason =
            checkSubjectPlacement(source.classKey, day, si, sourceSubject, vacated) ??
            checkTeacherPlacement(day, si, sourceTeacher, vacated)
          if (!reason) result.add(cellKeyOf(target))
        } else {
          if (!targetCell.teacherId) continue
          const targetSubject = subjects.find((s) => s.id === targetCell.subjectId)
          const targetTeacher = teachers.find((t) => t.id === targetCell.teacherId)
          if (!targetSubject || !targetTeacher) continue
          const vacated: CellRef[] = [source, target]
          const reasonA =
            checkSubjectPlacement(source.classKey, day, si, sourceSubject, vacated) ??
            checkTeacherPlacement(day, si, sourceTeacher, vacated)
          if (reasonA) continue
          const reasonB =
            checkSubjectPlacement(source.classKey, source.day, source.si, targetSubject, vacated) ??
            checkTeacherPlacement(source.day, source.si, targetTeacher, vacated)
          if (reasonB) continue
          result.add(cellKeyOf(target))
        }
      }
    }
    return result
  }

  const cloneTablesFor = (
    prev: Record<ClassKey, Record<Day, Cell[]>>, classKey: ClassKey, days: Day[]
  ) => {
    const next = { ...prev, [classKey]: { ...prev[classKey] } }
    for (const d of days) next[classKey][d] = [...prev[classKey][d]]
    return next
  }

  const flashSuccess = (keys: string[]) => {
    setFlashCells(new Set(keys))
    window.setTimeout(() => setFlashCells(new Set()), 550)
  }
  const flashReject = (key: string) => {
    setShakeCells((prev) => new Set(prev).add(key))
    window.setTimeout(() => setShakeCells((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    }), 400)
  }

  const restoreSnapshot = (snapshot: { classKey: ClassKey; day: Day; si: number; cell: Cell }[]) => {
    setTables((prev) => {
      const byClass = new Map<ClassKey, Set<Day>>()
      snapshot.forEach((s) => {
        if (!byClass.has(s.classKey)) byClass.set(s.classKey, new Set())
        byClass.get(s.classKey)!.add(s.day)
      })
      let next = prev
      byClass.forEach((days, ck) => { next = cloneTablesFor(next, ck, Array.from(days)) })
      snapshot.forEach((s) => { next[s.classKey][s.day][s.si] = s.cell })
      return next
    })
  }

  // Blok (2 saatlik) bir dersi taşır/yer değiştirir. computeBlockValidTargets
  // ile aynı kuralları drop anında yeniden kontrol eder (savunma amaçlı —
  // önizleme hesaplandıktan sonra tablo değişmiş olabilir).
  const attemptBlockPlacement = (source: CellRef, target: CellRef) => {
    const classKey = source.classKey
    const bounds = getBlockBounds(classKey, source.day, source.si)
    if (!bounds) return
    const [sA, sB] = bounds
    const targetKey = cellKeyOf(target)

    if (classKey !== target.classKey) {
      pushToast({ kind: 'error', text: 'Ders sadece kendi sınıfı içinde taşınabilir' })
      flashReject(targetKey)
      return
    }
    if (isCellLocked(classKey, source.day, sA) || isCellLocked(classKey, source.day, sB)) {
      pushToast({ kind: 'error', text: 'Bu blok kilitli, taşınamaz' })
      return
    }

    const tA = blockTargetStarts.current.get(targetKey)
    if (tA === undefined) {
      pushToast({ kind: 'error', text: 'Blok ders buraya taşınamaz' })
      flashReject(targetKey)
      return
    }
    const tB = tA + 1
    if (source.day === target.day && tA === sA) return

    if (isCellLocked(classKey, target.day, tA) || isCellLocked(classKey, target.day, tB)) {
      pushToast({ kind: 'error', text: 'Hedef blok kilitli' })
      flashReject(targetKey)
      return
    }

    const sourceCell = tables[classKey][source.day][sA]
    if (!sourceCell?.subjectId || !sourceCell.teacherId) return
    const sourceSubject = subjects.find((s) => s.id === sourceCell.subjectId)
    const sourceTeacher = teachers.find((t) => t.id === sourceCell.teacherId)
    if (!sourceSubject || !sourceTeacher) return

    const targetCellA = tables[classKey][target.day][tA]
    const targetCellB = tables[classKey][target.day][tB]
    const targetKeyA = cellKeyOf({ classKey, day: target.day, si: tA })
    const targetKeyB = cellKeyOf({ classKey, day: target.day, si: tB })
    const sourceKeyA = cellKeyOf({ classKey, day: source.day, si: sA })
    const sourceKeyB = cellKeyOf({ classKey, day: source.day, si: sB })

    if (!targetCellA?.subjectId && !targetCellB?.subjectId) {
      const vacated: CellRef[] = [{ classKey, day: source.day, si: sA }, { classKey, day: source.day, si: sB }]
      const reason =
        checkSubjectPlacement(classKey, target.day, tA, sourceSubject, vacated) ??
        checkSubjectPlacement(classKey, target.day, tB, sourceSubject, vacated) ??
        checkTeacherPlacement(target.day, tA, sourceTeacher, vacated) ??
        checkTeacherPlacement(target.day, tB, sourceTeacher, vacated)
      if (reason) {
        pushToast({ kind: 'error', text: reason })
        flashReject(targetKey)
        return
      }

      setTables((prev) => {
        const next = cloneTablesFor(prev, classKey, Array.from(new Set([source.day, target.day])))
        next[classKey][source.day][sA] = {}
        next[classKey][source.day][sB] = {}
        next[classKey][target.day][tA] = sourceCell
        next[classKey][target.day][tB] = sourceCell
        return next
      })
      const snapshot = [
        { classKey, day: source.day, si: sA, cell: sourceCell },
        { classKey, day: source.day, si: sB, cell: sourceCell },
        { classKey, day: target.day, si: tA, cell: {} as Cell },
        { classKey, day: target.day, si: tB, cell: {} as Cell },
      ]
      flashSuccess([targetKeyA, targetKeyB])
      pushToast({
        kind: 'success', text: 'Blok ders taşındı', durationMs: 6000,
        action: { label: 'Geri Al', onClick: () => restoreSnapshot(snapshot) },
      })
    } else {
      if (!targetCellA?.teacherId || targetCellA.subjectId !== targetCellB?.subjectId || targetCellA.teacherId !== targetCellB?.teacherId) {
        pushToast({ kind: 'error', text: 'Hedef geçerli bir blok değil' })
        flashReject(targetKey)
        return
      }
      const targetSubject = subjects.find((s) => s.id === targetCellA.subjectId)
      const targetTeacher = teachers.find((t) => t.id === targetCellA.teacherId)
      if (!targetSubject || !targetTeacher) return

      const vacated: CellRef[] = [
        { classKey, day: source.day, si: sA }, { classKey, day: source.day, si: sB },
        { classKey, day: target.day, si: tA }, { classKey, day: target.day, si: tB },
      ]
      const reasonA =
        checkSubjectPlacement(classKey, target.day, tA, sourceSubject, vacated) ??
        checkSubjectPlacement(classKey, target.day, tB, sourceSubject, vacated) ??
        checkTeacherPlacement(target.day, tA, sourceTeacher, vacated) ??
        checkTeacherPlacement(target.day, tB, sourceTeacher, vacated)
      if (reasonA) {
        pushToast({ kind: 'error', text: reasonA })
        flashReject(targetKey)
        return
      }
      const reasonB =
        checkSubjectPlacement(classKey, source.day, sA, targetSubject, vacated) ??
        checkSubjectPlacement(classKey, source.day, sB, targetSubject, vacated) ??
        checkTeacherPlacement(source.day, sA, targetTeacher, vacated) ??
        checkTeacherPlacement(source.day, sB, targetTeacher, vacated)
      if (reasonB) {
        pushToast({ kind: 'error', text: reasonB })
        flashReject(targetKey)
        return
      }

      setTables((prev) => {
        const next = cloneTablesFor(prev, classKey, Array.from(new Set([source.day, target.day])))
        next[classKey][source.day][sA] = targetCellA
        next[classKey][source.day][sB] = targetCellB
        next[classKey][target.day][tA] = sourceCell
        next[classKey][target.day][tB] = sourceCell
        return next
      })
      const snapshot = [
        { classKey, day: source.day, si: sA, cell: sourceCell },
        { classKey, day: source.day, si: sB, cell: sourceCell },
        { classKey, day: target.day, si: tA, cell: targetCellA },
        { classKey, day: target.day, si: tB, cell: targetCellB },
      ]
      flashSuccess([sourceKeyA, sourceKeyB, targetKeyA, targetKeyB])
      pushToast({
        kind: 'success', text: 'Bloklar yer değiştirdi', durationMs: 6000,
        action: { label: 'Geri Al', onClick: () => restoreSnapshot(snapshot) },
      })
    }
  }

  const attemptPlacement = (source: CellRef, target: CellRef) => {
    if (sameCell(source, target)) return
    const targetKey = cellKeyOf(target)

    if (getBlockBounds(source.classKey, source.day, source.si)) {
      attemptBlockPlacement(source, target)
      return
    }

    if (source.classKey !== target.classKey) {
      pushToast({ kind: 'error', text: 'Ders sadece kendi sınıfı içinde taşınabilir' })
      flashReject(targetKey)
      return
    }
    if (isCellLocked(source.classKey, source.day, source.si)) {
      pushToast({ kind: 'error', text: 'Bu ders kilitli, taşınamaz' })
      return
    }
    if (isCellLocked(target.classKey, target.day, target.si)) {
      pushToast({ kind: 'error', text: 'Hedef ders kilitli' })
      flashReject(targetKey)
      return
    }
    if (isBlockCell(target.classKey, target.day, target.si)) {
      pushToast({ kind: 'error', text: 'Hedef, 2 saatlik bir bloğun parçası' })
      flashReject(targetKey)
      return
    }

    const sourceCell = tables[source.classKey][source.day][source.si]
    if (!sourceCell?.subjectId || !sourceCell.teacherId) return
    const targetCell = tables[target.classKey][target.day][target.si]

    const sourceSubject = subjects.find((s) => s.id === sourceCell.subjectId)
    const sourceTeacher = teachers.find((t) => t.id === sourceCell.teacherId)
    if (!sourceSubject || !sourceTeacher) return

    if (!targetCell?.subjectId) {
      // Boş hücreye taşıma
      const vacated: CellRef[] = [source]
      const reason =
        checkSubjectPlacement(target.classKey, target.day, target.si, sourceSubject, vacated) ??
        checkTeacherPlacement(target.day, target.si, sourceTeacher, vacated)
      if (reason) {
        pushToast({ kind: 'error', text: reason })
        flashReject(targetKey)
        return
      }

      setTables((prev) => {
        const next = cloneTablesFor(prev, source.classKey, Array.from(new Set([source.day, target.day])))
        next[source.classKey][source.day][source.si] = {}
        next[target.classKey][target.day][target.si] = sourceCell
        return next
      })
      const snapshot = [
        { ...source, cell: sourceCell },
        { ...target, cell: {} as Cell },
      ]
      flashSuccess([targetKey])
      pushToast({
        kind: 'success', text: 'Ders taşındı', durationMs: 6000,
        action: { label: 'Geri Al', onClick: () => restoreSnapshot(snapshot) },
      })
    } else {
      // Dolu hücreyle yer değiştirme
      if (!targetCell.teacherId) return
      const targetSubject = subjects.find((s) => s.id === targetCell.subjectId)
      const targetTeacher = teachers.find((t) => t.id === targetCell.teacherId)
      if (!targetSubject || !targetTeacher) return

      const vacated: CellRef[] = [source, target]
      const reasonA =
        checkSubjectPlacement(target.classKey, target.day, target.si, sourceSubject, vacated) ??
        checkTeacherPlacement(target.day, target.si, sourceTeacher, vacated)
      if (reasonA) {
        pushToast({ kind: 'error', text: reasonA })
        flashReject(targetKey)
        return
      }
      const reasonB =
        checkSubjectPlacement(source.classKey, source.day, source.si, targetSubject, vacated) ??
        checkTeacherPlacement(source.day, source.si, targetTeacher, vacated)
      if (reasonB) {
        pushToast({ kind: 'error', text: reasonB })
        flashReject(targetKey)
        return
      }

      setTables((prev) => {
        const next = cloneTablesFor(prev, source.classKey, Array.from(new Set([source.day, target.day])))
        next[source.classKey][source.day][source.si] = targetCell
        next[target.classKey][target.day][target.si] = sourceCell
        return next
      })
      const snapshot = [
        { ...source, cell: sourceCell },
        { ...target, cell: targetCell },
      ]
      flashSuccess([cellKeyOf(source), targetKey])
      pushToast({
        kind: 'success', text: 'Dersler yer değiştirdi', durationMs: 6000,
        action: { label: 'Geri Al', onClick: () => restoreSnapshot(snapshot) },
      })
    }
  }

  const onTapSlot = (cellRef: CellRef) => {
    if (!tapSelected) {
      if (!isDraggableCell(cellRef.classKey, cellRef.day, cellRef.si)) {
        if (isCellLocked(cellRef.classKey, cellRef.day, cellRef.si)) {
          pushToast({ kind: 'error', text: 'Bu ders kilitli' })
        }
        return
      }
      const normalized = normalizeCellRef(cellRef)
      setTapSelected(normalized)
      setValidTargets(computeValidTargets(normalized))
      return
    }
    if (isSourceCell(tapSelected, cellRef)) {
      setTapSelected(null)
      setValidTargets(null)
      return
    }
    attemptPlacement(tapSelected, cellRef)
    setTapSelected(null)
    setValidTargets(null)
  }

  return (
    <>
      <Toasts />
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
          {lockedCells.length > 0 && (
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={clearAllCellLocks}
              style={{ borderColor: 'rgba(245,158,11,0.5)', color: '#f59e0b' }}
              title="Tüm hücre kilitlerini kaldır"
            >
              🔓 Kilitleri Kaldır ({lockedCells.length})
            </button>
          )}
          {!isGenerating && (
            <button className="btn btn-primary" onClick={generate}>
              Programları Oluştur
            </button>
          )}
        </div>
      </div>

      {/* Hücre kilidi bilgi bandı */}
      {lockedCells.length > 0 && (
        <div style={{
          margin: '12px 0',
          padding: '10px 16px',
          borderRadius: 10,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: '#fbbf24',
        }}>
          <LockIcon locked />
          {lockedCells.length} ders kilitli — program yeniden oluşturulduğunda bu hücreler korunur.
        </div>
      )}

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
          border: '1px solid rgba(34,211,238,0.2)',
        }}>
          {/* Top row: live indicator + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ position: 'relative', width: 16, height: 16, flexShrink: 0 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'ping 1.4s ease-out infinite',
                opacity: 0.5,
              }} />
              <div style={{
                position: 'absolute', inset: '20%', borderRadius: '50%',
                background: 'var(--accent-2)',
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

          {/* Hero: yerleşen ders saati sayısı */}
          {totalReqState > 0 && (
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{
                fontSize: 44, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1,
                ...(bestMissing === 0
                  ? { color: '#22c55e' }
                  : {
                      backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    }),
                animation: bestMissing === 0 ? 'lockPop 0.4s ease' : undefined,
              }}>
                {totalReqState - bestMissing}
                <span style={{ fontSize: 20, fontWeight: 400, color: '#475569' }}>/{totalReqState}</span>
              </div>
              <div style={{ fontSize: 12, color: bestMissing === 0 ? '#4ade80' : '#64748b', marginTop: 6, fontWeight: 600 }}>
                {bestMissing === 0 ? 'tüm dersler yerleşti ✓' : `ders saati yerleşti · ${bestMissing} eksik kaldı`}
              </div>
            </div>
          )}

          {/* Progress bar — gerçek yerleşme oranını gösterir */}
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
              width: `${Math.min(100, Math.max(0, placementRatio * 100))}%`,
              background: placementRatio >= 1
                ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                : 'linear-gradient(90deg, var(--accent), var(--accent-2))',
              borderRadius: 999,
              transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: placementRatio <= 0.02 ? 'none' : placementRatio >= 1
                ? '0 0 16px rgba(34,197,94,0.55)'
                : '0 0 16px rgba(34,211,238,0.5)',
              animation: placementRatio >= 1 ? 'barPulse 0.8s ease-in-out 2' : undefined,
            }} />
            {/* Shimmer overlay */}
            {placementRatio > 0.02 && placementRatio < 0.99 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                width: '40%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }} />
            )}
          </div>

          {/* Bottom row: ikincil bilgiler + durdur */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--accent-2)',
                  animation: `barPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  opacity: 0.7,
                }} />
              ))}
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>
                {triedCount > 0 ? `${elapsedTime}s · ${triedCount} deneme yapıldı` : 'Başlatılıyor…'}
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
            animation: lastResult.success ? 'lockPop 0.5s ease' : undefined,
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
                              const cellRef: CellRef = { classKey: c.key, day: d, si }
                              const key = cellKeyOf(cellRef)
                              const locked = isCellLocked(c.key, d, si)
                              const draggableCell = isDraggableCell(c.key, d, si)
                              const lockable = isLockableCell(c.key, d, si)
                              const blockBounds = getBlockBounds(c.key, d, si)
                              const isDragSource = isSourceCell(dragSource, cellRef)
                              const isValidTarget = !isDragSource && !!validTargets && validTargets.has(key)
                              const isDragOverThis = !!dragSource && !!dragOverTarget && sameCell(dragOverTarget, cellRef)
                              const dragOverValid = isDragOverThis && isValidTarget
                              const pillClasses = [
                                'slot-pill',
                                cell?.subjectId ? '' : 'empty',
                                draggableCell ? 'draggable' : '',
                                locked ? 'locked' : '',
                                placementBlockerCells.has(key) ? 'hint-blocker' : '',
                                isDragSource ? 'dragging' : '',
                                !isDragOverThis && isValidTarget ? 'valid-move-target' : '',
                                isDragOverThis ? (dragOverValid ? 'drop-target-valid' : 'drop-target-invalid') : '',
                                flashCells.has(key) ? 'drop-success' : '',
                                shakeCells.has(key) ? 'drop-reject' : '',
                              ].filter(Boolean).join(' ')
                              return (
                                <td key={key} className="slot">
                                  <div
                                    className={pillClasses}
                                    draggable={draggableCell}
                                    title={cell?.subjectId ? `${subj?.name} — ${teacher ? teacher.name : 'Atanmadı'}${blockBounds ? ' (2 saatlik blok)' : ''}` : undefined}
                                    onDragStart={(e) => {
                                      if (!draggableCell) { e.preventDefault(); return }
                                      e.dataTransfer.effectAllowed = 'move'
                                      const normalized = normalizeCellRef(cellRef)
                                      setDragSource(normalized)
                                      setValidTargets(computeValidTargets(normalized))
                                    }}
                                    onDragEnd={() => { setDragSource(null); setDragOverTarget(null); setValidTargets(null) }}
                                    onDragOver={(e) => {
                                      if (!dragSource || dragSource.classKey !== c.key) return
                                      e.preventDefault()
                                      setDragOverTarget(cellRef)
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault()
                                      if (dragSource) attemptPlacement(dragSource, cellRef)
                                      setDragSource(null)
                                      setDragOverTarget(null)
                                      setValidTargets(null)
                                    }}
                                  >
                                    {cell?.subjectId ? (
                                      <>
                                        <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                        <span className="s-name">{getSubjectAbbreviation(subj?.name || '', subj?.abbreviation)}</span>
                                        <span className="s-teacher">{teacher ? getTeacherAbbreviation(teacher.name) : '—'}</span>
                                        {lockable && (
                                          <button
                                            type="button"
                                            className="cell-lock-btn"
                                            aria-label={locked ? 'Kilidi aç' : 'Hücreyi kilitle'}
                                            onClick={(e) => { e.stopPropagation(); toggleCellLock(c.key, d, si) }}
                                          >
                                            <LockIcon locked={locked} />
                                          </button>
                                        )}
                                      </>
                                    ) : (
                                      <span className="muted">—</span>
                                    )}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile-friendly accordion per day — dokunarak seç, sonra hedefe dokun */}
                    <div className="tt-accordion">
                      {DAYS.map((d) => (
                        <details key={d} className="tt-acc-day">
                          <summary className="tt-acc-summary">{d}</summary>
                          <div className="tt-acc-slots">
                            {slots.map((_, si) => {
                              const cell = tables[c.key]?.[d]?.[si]
                              const subj = subjects.find(s => s.id === cell?.subjectId)
                              const teacher = teachers.find(t => t.id === cell?.teacherId)
                              const cellRef: CellRef = { classKey: c.key, day: d, si }
                              const key = cellKeyOf(cellRef)
                              const locked = isCellLocked(c.key, d, si)
                              const lockable = isLockableCell(c.key, d, si)
                              const selected = isSourceCell(tapSelected, cellRef)
                              const isValidTarget = !selected && !!tapSelected && !!validTargets && validTargets.has(key)
                              const slotClasses = [
                                'acc-slot',
                                isBlockCell(c.key, d, si) ? 'acc-block' : '',
                                placementBlockerCells.has(key) ? 'hint-blocker' : '',
                                selected ? 'tap-selected' : '',
                                isValidTarget ? 'valid-move-target' : '',
                                locked ? 'locked' : '',
                                flashCells.has(key) ? 'drop-success' : '',
                                shakeCells.has(key) ? 'drop-reject' : '',
                              ].filter(Boolean).join(' ')
                              return (
                                <div
                                  key={c.key + d + 'a' + si}
                                  className={slotClasses}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onTapSlot(cellRef)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTapSlot(cellRef) } }}
                                >
                                  <div className="acc-slot-left">S{si + 1}</div>
                                  {cell?.subjectId ? (
                                    <div className="acc-slot-main">
                                      <span className="dot" style={{ background: subj?.color ?? '#93c5fd' }} />
                                      <span className="s-name">{subj?.name}</span>
                                      <span className="s-teacher">{teacher ? teacher.name : '—'}</span>
                                      {lockable && (
                                        <button
                                          type="button"
                                          className="cell-lock-btn"
                                          aria-label={locked ? 'Kilidi aç' : 'Hücreyi kilitle'}
                                          onClick={(e) => { e.stopPropagation(); toggleCellLock(c.key, d, si) }}
                                        >
                                          <LockIcon locked={locked} />
                                        </button>
                                      )}
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
          {placementHints.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Yerleşim Önerileri</div>
              {placementHints.map((h, idx) => (
                <div key={idx} style={{ marginBottom: 2 }}>
                  <span style={{ color: h.blockerKey ? '#f59e0b' : undefined }}>•</span> {h.text}
                </div>
              ))}
              {placementBlockerCells.size > 0 && (
                <div style={{ marginTop: 6, fontStyle: 'italic' }}>
                  Programdaki amber renkte yanıp sönen dersler, taşınırsa yer açacak derslerdir — sürükleyip yeşil gösterilen yere bırakabilirsiniz.
                </div>
              )}
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
