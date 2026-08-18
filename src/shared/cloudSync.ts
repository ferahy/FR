import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Subject, Teacher, Assignments } from './types'

const SUBJECT_KEY = 'ferah_subjects_v2'
const TEACHER_KEY = 'ferah_teachers_v2'
const SCHOOL_KEY = 'schoolConfig'
const TIMETABLE_KEY = 'timetables'
const ASSIGNMENTS_KEY = 'ferah_assignments_v1'
const LOCKED_CELLS_KEY = 'lockedCells'
const LOCKED_TEACHERS_KEY = 'lockedTeachers'

type CloudState = {
  subjects?: Subject[]
  teachers?: Teacher[]
  school?: any
  timetables?: any
  assignments?: Assignments
  lockedCells?: string[]
  lockedTeachers?: string[]
}

// Supabase tablosunda "assignments" kolonu henüz yoksa hata veriyor. Bu helper
// ile önce normal upsert dener, kolon hatasında ise assignments'ı timetables
// içine gömerek geriye dönük uyumlu şekilde kaydeder.
//
// lockedCells/lockedTeachers için ayrı bir DB kolonu hiç yok (ve şema
// değişikliği gerektirmesin diye eklenmeyecek) — bu yüzden her zaman
// timetables JSON'ı içine __lockedCells/__lockedTeachers olarak gömülüyor.
// Aksi halde bu kilitler buluta hiç gitmez; başka bir cihazdan "Buluttan
// Çek" yapıldığında o cihazın kendi eski/alakasız kilit listesi yeni gelen
// programla karışıp konum bazlı (classKey|day|slot) tesadüfi eşleşmelerle
// yanlış hücreleri/öğretmenleri "kilitli" gösterebilir.
async function resilientUpsert(client: SupabaseClient, userId: string, payload: CloudState) {
  const timetablesWithLocks = {
    ...(payload.timetables ?? {}),
    __lockedCells: payload.lockedCells ?? [],
    __lockedTeachers: payload.lockedTeachers ?? [],
  }
  const base = {
    id: userId,
    subjects: payload.subjects ?? [],
    teachers: payload.teachers ?? [],
    school: payload.school ?? {},
    timetables: timetablesWithLocks,
    assignments: payload.assignments ?? {},
    updated_at: new Date().toISOString(),
  }

  // 1) assignments kolonunu kullanarak kaydetmeyi dene
  let result = await client.from('app_state').upsert(base)
  if (!result.error) return { ok: true as const, warning: null }

  const missingAssignmentsColumn = result.error?.message?.includes("'assignments' column")
  if (!missingAssignmentsColumn) {
    return { ok: false as const, error: result.error.message }
  }

  // 2) Kolon yoksa assignments'ı timetables içine gömüp yeniden dene
  const { assignments, timetables, ...rest } = base
  const mergedTimetables = { ...(timetables ?? {}), __assignments: assignments }
  result = await client.from('app_state').upsert({ ...rest, timetables: mergedTimetables })
  if (result.error) return { ok: false as const, error: result.error.message }

  return {
    ok: true as const,
    warning: 'assignments kolonu bulunamadı; atamalar timetables içine yedeklenerek kaydedildi',
  }
}

// Build-time env veya fallback (GitHub Pages için gömülü)
const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://lyumqawteplssqjqtvwp.supabase.co'
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5dW1xYXd0ZXBsc3NxanF0dndwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MzkzNzEsImV4cCI6MjA4MjUxNTM3MX0.Vyqvrn_nWFZs22EmPV3LjaN8bkfsu3WaW20x7UL-JXQ'

function getClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

function getLocalState(): CloudState {
  const read = (k: string) => {
    try {
      const v = localStorage.getItem(k)
      return v ? JSON.parse(v) : undefined
    } catch {
      return undefined
    }
  }
  return {
    subjects: read(SUBJECT_KEY),
    teachers: read(TEACHER_KEY),
    school: read(SCHOOL_KEY),
    timetables: read(TIMETABLE_KEY),
    assignments: read(ASSIGNMENTS_KEY),
    lockedCells: read(LOCKED_CELLS_KEY),
    lockedTeachers: read(LOCKED_TEACHERS_KEY),
  }
}

function setLocalState(data: CloudState) {
  const write = (k: string, v: any) => {
    try {
      if (v === undefined) return
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      // ignore
    }
  }
  write(SUBJECT_KEY, data.subjects)
  write(TEACHER_KEY, data.teachers)
  write(SCHOOL_KEY, data.school)
  write(TIMETABLE_KEY, data.timetables)
  write(ASSIGNMENTS_KEY, data.assignments)
  write(LOCKED_CELLS_KEY, data.lockedCells ?? [])
  write(LOCKED_TEACHERS_KEY, data.lockedTeachers ?? [])
}

export async function saveToCloud(userId = 'ferah'): Promise<{ ok: boolean; error?: string; warning?: string | null }> {
  const client = getClient()
  if (!client) return { ok: false, error: 'Supabase anahtarları eksik (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' }
  const payload = getLocalState()
  const res = await resilientUpsert(client, userId, payload)
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, warning: res.warning }
}

export async function loadFromCloud(userId = 'ferah'): Promise<{ ok: boolean; error?: string }> {
  const client = getClient()
  if (!client) return { ok: false, error: 'Supabase anahtarları eksik (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' }
  const { data, error } = await client.from('app_state').select('*').eq('id', userId).single()
  if (error) return { ok: false, error: error.message }
  // assignments kolonunun eski sürümlerde olmaması durumunda timetables içindeki
  // __assignments yedeğini kullan; lockedCells/lockedTeachers için de aynı
  // gömme yöntemi kullanılıyor (bkz. resilientUpsert). Bu __-önekli alanları
  // gerçek timetables verisinden ayıklayıp temizliyoruz — yoksa kalıcı olarak
  // "hayalet" bir sınıf gibi timetables içinde birikip her sonraki kaydetmede
  // tekrar buluta yüklenirler.
  const rawTimetables = data?.timetables ?? {}
  const { __assignments, __lockedCells, __lockedTeachers, ...cleanTimetables } = rawTimetables
  const assignments = data?.assignments ?? __assignments ?? {}
  const lockedCells = __lockedCells ?? []
  const lockedTeachers = __lockedTeachers ?? []
  setLocalState({
    subjects: data?.subjects ?? [],
    teachers: data?.teachers ?? [],
    school: data?.school ?? {},
    timetables: cleanTimetables,
    assignments,
    lockedCells,
    lockedTeachers,
  })
  return { ok: true }
}
