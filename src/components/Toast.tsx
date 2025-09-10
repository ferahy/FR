import { useEffect, useState } from 'react'
import Portal from '../shared/Portal'

type Toast = { id: string; text: string; kind: 'success' | 'error' }

let pushFn: ((t: Omit<Toast, 'id'>) => void) | null = null

export function pushToast(t: Omit<Toast, 'id'>) {
  pushFn?.(t)
}

export default function Toasts() {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => {
    pushFn = (t) => {
      const id = Math.random().toString(36).slice(2)
      const item: Toast = { id, ...t }
      setItems((prev) => [...prev, item])
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id))
      }, 2000)
    }
    return () => {
      pushFn = null
    }
  }, [])

  if (items.length === 0) return null

  return (
    <Portal>
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Portal>
  )
}

