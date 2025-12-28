import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Subject, Teacher } from './types'

const SUBJECT_KEY = 'ferah_subjects_v2'
const TEACHER_KEY = 'ferah_teachers_v2'
const SCHOOL_KEY = 'schoolConfig'
const TIMETABLE_KEY = 'timetables'

type CloudState = {
  subjects?: Subject[]
  teachers?: Teacher[]
  school?: any
  timetables?: any
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

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
}

export async function saveToCloud(userId = 'ferah'): Promise<{ ok: boolean; error?: string }> {
  const client = getClient()
  if (!client) return { ok: false, error: 'Supabase anahtarları eksik (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' }
  const payload = getLocalState()
  const { error } = await client.from('app_state').upsert({
    id: userId,
    subjects: payload.subjects ?? [],
    teachers: payload.teachers ?? [],
    school: payload.school ?? {},
    timetables: payload.timetables ?? {},
    updated_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function loadFromCloud(userId = 'ferah'): Promise<{ ok: boolean; error?: string }> {
  const client = getClient()
  if (!client) return { ok: false, error: 'Supabase anahtarları eksik (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' }
  const { data, error } = await client.from('app_state').select('*').eq('id', userId).single()
  if (error) return { ok: false, error: error.message }
  setLocalState({
    subjects: data?.subjects ?? [],
    teachers: data?.teachers ?? [],
    school: data?.school ?? {},
    timetables: data?.timetables ?? {},
  })
  return { ok: true }
}
