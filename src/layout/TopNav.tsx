import { PAGES } from '../shared/useHashRoute'
import type { PageKey } from '../shared/useHashRoute'
import fokLogo from '../assets/fok.png'

type Props = {
  current: PageKey
  onNavigate: (p: PageKey) => void
}

const BUBBLES = [
  { left: '6%', size: 5, delay: '0s', duration: '6.5s' },
  { left: '14%', size: 3, delay: '1.4s', duration: '7.5s' },
  { left: '23%', size: 6, delay: '3.1s', duration: '6s' },
  { left: '68%', size: 4, delay: '0.6s', duration: '8s' },
  { left: '78%', size: 3, delay: '2.5s', duration: '6.8s' },
  { left: '90%', size: 5, delay: '4s', duration: '7.2s' },
]

const SPARKLES = [
  { left: '30%', delay: '0s', duration: '2.4s' },
  { left: '45%', delay: '0.9s', duration: '3s' },
  { left: '58%', delay: '1.7s', duration: '2.2s' },
  { left: '72%', delay: '0.4s', duration: '2.8s' },
]

function JellyfishIcon({ gradId }: { gradId: string }) {
  return (
    <svg viewBox="0 0 24 30" width="100%" height="100%">
      <path d="M2,12 C2,5 7,1 12,1 C17,1 22,5 22,12 C22,15.5 19,17 12,17 C5,17 2,15.5 2,12 Z" fill={`url(#${gradId})`} />
      <path d="M6,17 C6,21 5,23 6,27" stroke="#e0f9ffb0" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M12,17 C12,22 13,24 12,29" stroke="#e0f9ffb0" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M18,17 C18,21 19,23 18,27" stroke="#e0f9ffb0" strokeWidth="1" fill="none" strokeLinecap="round" />
      <defs>
        <radialGradient id={gradId} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f5f3ffdd" />
          <stop offset="100%" stopColor="#c4b5fd77" />
        </radialGradient>
      </defs>
    </svg>
  )
}

function spawnRipple(e: React.MouseEvent<HTMLButtonElement>) {
  const btn = e.currentTarget
  const rect = btn.getBoundingClientRect()
  const ripple = document.createElement('span')
  ripple.className = 'tab-ripple'
  ripple.style.left = `${e.clientX - rect.left}px`
  ripple.style.top = `${e.clientY - rect.top}px`
  btn.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove())
}

export default function TopNav({ current, onNavigate }: Props) {
  return (
    <div className="topbar glass ocean-topbar">
      <div className="ocean-bubbles" aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bubble"
            style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }}
          />
        ))}
      </div>
      <div className="ocean-waves" aria-hidden="true">
        <svg className="wave wave-back" viewBox="0 0 2400 60" preserveAspectRatio="none">
          <path d="M0,30 C150,55 300,5 600,30 C900,55 1050,5 1200,30 C1350,55 1500,5 1800,30 C2100,55 2250,5 2400,30 L2400,60 L0,60 Z" />
        </svg>
        <svg className="wave wave-front" viewBox="0 0 2400 60" preserveAspectRatio="none">
          <path d="M0,20 C200,45 400,-5 600,20 C800,45 1000,-5 1200,20 C1400,45 1600,-5 1800,20 C2000,45 2200,-5 2400,20 L2400,60 L0,60 Z" />
        </svg>
        <div className="ocean-jelly" style={{ top: 2 }}>
          <JellyfishIcon gradId="jelly-grad-1" />
        </div>
        {SPARKLES.map((s, i) => (
          <span
            key={i}
            className="ocean-sparkle"
            style={{ left: s.left, animationDelay: s.delay, animationDuration: s.duration }}
          />
        ))}
      </div>

      <div className="brand">
        <div className="ocean-ring">
          <img src={fokLogo} alt="Fok" />
          <img src={fokLogo} alt="" aria-hidden="true" className="ocean-reflection" />
        </div>
      </div>

      <div className="nav-wrap" style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center' }}>
        <div className="tabs">
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`tab ocean-tab ${current === p.key ? 'active' : ''}`}
              onClick={(e) => { spawnRipple(e); onNavigate(p.key) }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <select
          className="select dropdown-nav"
          value={current}
          aria-label="Sayfayı seç"
          onChange={(e) => onNavigate(e.target.value as PageKey)}
        >
          {PAGES.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
