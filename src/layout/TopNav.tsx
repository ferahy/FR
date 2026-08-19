import { PAGES } from '../shared/useHashRoute'
import type { PageKey } from '../shared/useHashRoute'
import fokLogo from '../assets/fok.png'

type Props = {
  current: PageKey
  onNavigate: (p: PageKey) => void
}

export default function TopNav({ current, onNavigate }: Props) {
  return (
    <div className="topbar glass">
      <div className="brand">
        <img src={fokLogo} alt="Fok" style={{ height: 36, width: 36, objectFit: 'contain' }} />
      </div>

      <div className="nav-wrap" style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center' }}>
        <div className="tabs">
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`tab ${current === p.key ? 'active' : ''}`}
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
