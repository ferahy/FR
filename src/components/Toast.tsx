import { useEffect, useState } from 'react'
import Portal from '../shared/Portal'

type ToastAction = { label: string; onClick: () => void }
type Toast = { id: string; text: string; kind: 'success' | 'error'; action?: ToastAction; durationMs?: number }

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
      }, t.durationMs ?? 2000)
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
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.onClick()
                  setItems((prev) => prev.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Portal>
  )
}
