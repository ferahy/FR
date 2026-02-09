import { useEffect, useMemo, useState } from 'react'

export type PageKey =
  | 'okul'
  | 'dersler'
  | 'ogretmenler'
  | 'atamalar'
  | 'ders-programlari'
  | 'ogretmen-programlari'

export function useHashRoute(defaultPage: PageKey = 'okul') {
  const parse = (): PageKey => {
    const raw = (location.hash || '').replace(/^#/, '') || `/${defaultPage}`
    const key = raw.startsWith('/') ? raw.slice(1) : raw
    const alias = key === 'teachers' ? 'ogretmenler' : key
    const normalized = alias as PageKey
    return isValidPage(normalized) ? normalized : defaultPage
  }

  const [page, setPage] = useState<PageKey>(parse)

  useEffect(() => {
    const onHash = () => setPage(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (p: PageKey) => {
    if (!isValidPage(p)) return
    const next = `#/${p}`
    if (location.hash !== next) location.hash = next
    else setPage(p)
  }

  return useMemo(() => ({ page, navigate }), [page])
}

export const PAGES: { key: PageKey; label: string }[] = [
  { key: 'okul', label: 'Okul' },
  { key: 'dersler', label: 'Dersler' },
  { key: 'ogretmenler', label: 'Öğretmenler' },
  { key: 'atamalar', label: 'Atamalar' },
  { key: 'ders-programlari', label: 'Ders Programları' },
  { key: 'ogretmen-programlari', label: 'Öğretmen Ders Programları' },
]

export function isValidPage(p: string): p is PageKey {
  return (
    p === 'okul' ||
    p === 'dersler' ||
    p === 'ogretmenler' ||
    p === 'atamalar' ||
    p === 'ders-programlari' ||
    p === 'ogretmen-programlari'
  )
}
