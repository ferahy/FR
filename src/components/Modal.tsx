import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import Portal from '../shared/Portal'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export default function Modal({ open, onClose, title, children, initialFocusRef }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const titleId = 'dialog-title-' + Math.random().toString(36).slice(2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', onKey)
      const body = document.body
      const prev = body.style.overflow
      body.style.overflow = 'hidden'
      if (initialFocusRef?.current) initialFocusRef.current.focus()
      return () => {
        document.removeEventListener('keydown', onKey)
        body.style.overflow = prev
      }
    }
  }, [open, onClose, initialFocusRef])

  if (!open) return null

  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <Portal>
      <div ref={overlayRef} className="modal-overlay" onMouseDown={onOverlayClick}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="modal-head">
            <h3 id={titleId} className="modal-title">{title}</h3>
            <button className="close" aria-label="Kapat" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </Portal>
  )
}
