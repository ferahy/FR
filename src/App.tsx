import './index.css'
import Okul from './pages/Okul'
import Dersler from './pages/Dersler'
import Ogretmenler from './pages/Ogretmenler'
import DersProgramlari from './pages/DersProgramlari'
import OgretmenProgramlari from './pages/OgretmenProgramlari'
import TopNav from './layout/TopNav'
import { useEffect, useState } from 'react'
import { useHashRoute } from './shared/useHashRoute'
import { saveToCloud, loadFromCloud } from './shared/cloudSync'
import KantePopup from './components/KantePopup'

export default function App() {
  const { page, navigate } = useHashRoute('okul')
  const [authed, setAuthed] = useState(() => {
    try {
      return localStorage.getItem('authSession') === 'ok'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (!location.hash) {
      location.hash = '#/okul'
    }
  }, [])

  useEffect(() => {
    try {
      if (authed) localStorage.setItem('authSession', 'ok')
      else localStorage.removeItem('authSession')
    } catch {
      // ignore
    }
  }, [authed])

  const [showKante, setShowKante] = useState(false)

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />
  }

  return (
    <div className="page container-narrow">
      <AuthBar onLogout={() => setAuthed(false)} />
      <TopNav current={page} onNavigate={navigate} />

      {showKante && <KantePopup onClose={() => setShowKante(false)} />}

      {page === 'okul' && <Okul />}
      {page === 'dersler' && <Dersler />}
      {page === 'ogretmenler' && <Ogretmenler />}
      {page === 'ders-programlari' && <DersProgramlari />}
      {page === 'ogretmen-programlari' && <OgretmenProgramlari />}

      <footer className="site-footer">
        <div className="footer-box glass p-6 footer-gradient">
          <div className="footer-text">
            Fenerbahçe tüm şahsiyet ve kişilerin üstüdür. Fenerbahçe sonsuza dek yaşayacaktır, yaşlandıkça güzelleşecektir.
          </div>
        </div>
      </footer>
    </div>
  )
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (name.trim() === 'ferah' && password === '1907') {
      setError(null)
      onSuccess()
      return
    }
    setError('Kullanıcı adı veya şifre hatalı')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at 20% 20%, rgba(79,70,229,0.16), transparent 35%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.18), transparent 32%), #0f172a',
      padding: 24
    }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div className="glass" style={{ padding: 32, background: 'rgba(15,23,42,0.82)', border: '1px solid rgba(255,255,255,0.04)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#14b8a6)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>
              RFT
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>✨</div>
              <div style={{ color: '#94a3b8', fontSize: 14 }}>Ders programı hazırlamak için giriş yap</div>
            </div>
          </div>
          <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <span className="field-label">Kullanıcı Adı</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
                placeholder="Kullanıcı adınız"
              />
            </div>
            <div className="field">
              <span className="field-label">Şifre</span>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Şifreniz"
                  style={{ paddingRight: 80 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="btn btn-outline btn-sm"
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}
                >
                  {showPassword ? 'Gizle' : 'Göster'}
                </button>
              </div>
            </div>
            {error && <div className="error-text" style={{ marginTop: 2 }}>{error}</div>}
            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 4 }}>
              Giriş
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function AuthBar({ onLogout }: { onLogout: () => void }) {
  const [syncing, setSyncing] = useState<'idle' | 'up' | 'down'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    // Otomatik ilk yükleme (sadece bu sekmede bir kez)
    const skip = sessionStorage.getItem('skipCloudLoad')
    const loaded = sessionStorage.getItem('cloudLoadedOnce')
    if (skip === '1' || loaded === '1') return
    ;(async () => {
      setSyncing('down')
      const res = await loadFromCloud()
      setSyncing('idle')
      if (res.ok) {
        sessionStorage.setItem('cloudLoadedOnce', '1')
        window.location.reload()
      } else {
        setMessage(`Hata: ${res.error}`)
      }
    })()
  }, [])

  const doSave = async () => {
    setMessage(null)
    setSyncing('up')
    const res = await saveToCloud()
    setSyncing('idle')
    setMessage(res.ok ? 'Buluta kaydedildi' : `Hata: ${res.error}`)
  }

  const doLoad = async () => {
    setMessage(null)
    setSyncing('down')
    const res = await loadFromCloud()
    setSyncing('idle')
    if (res.ok) {
      setMessage('Buluttan yüklendi')
      // Yerel state'ler localStorage’dan yeniden okunsun diye sayfayı yenile
      window.location.reload()
    } else {
      setMessage(`Hata: ${res.error}`)
    }
  }

  const doReset = () => {
    const ok = window.confirm('Tüm veriler sıfırlanacak. Emin misiniz?')
    if (!ok) return
    const auth = localStorage.getItem('authSession')
    localStorage.clear()
    if (auth === 'ok') localStorage.setItem('authSession', 'ok')
    sessionStorage.setItem('skipCloudLoad', '1')
    sessionStorage.removeItem('cloudLoadedOnce')
    window.location.reload()
  }

  return (
    <div className="glass p-4" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <div className="pill">ferah olarak giriş yapıldı</div>
        {message && <span className="muted">{message}</span>}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={doSave} disabled={syncing !== 'idle'}>Buluta Kaydet</button>
        <button className="btn btn-outline btn-sm" onClick={doLoad} disabled={syncing !== 'idle'}>Buluttan Yükle</button>
        <button className="btn btn-danger btn-sm" onClick={doReset} disabled={syncing !== 'idle'}>Sıfırla</button>
        <button className="btn btn-outline btn-sm" onClick={onLogout}>Çıkış</button>
      </div>
    </div>
  )
}
