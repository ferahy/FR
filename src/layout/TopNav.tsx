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
      </div>

      <div className="brand">
        <div className="ocean-ring">
          <img src={fokLogo} alt="Fok" />
        </div>
      </div>

      <div className="nav-wrap" style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center' }}>
        <div className="tabs">
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`tab ocean-tab ${current === p.key ? 'active' : ''}`}
              onClick={() => onNavigate(p.key)}
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
