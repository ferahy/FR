import './index.css'
import Okul from './pages/Okul'
import Dersler from './pages/Dersler'
import Siniflar from './pages/Siniflar'
import Ogretmenler from './pages/Ogretmenler'
import Atamalar from './pages/Atamalar'
import DersProgramlari from './pages/DersProgramlari'
import OgretmenProgramlari from './pages/OgretmenProgramlari'
import TopNav from './layout/TopNav'
import { useEffect, useRef, useState } from 'react'
import { useHashRoute } from './shared/useHashRoute'
import { saveToCloud, loadFromCloud } from './shared/cloudSync'
import KantePopup from './components/KantePopup'
import fokLogo from './assets/fok.png'

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
      {page === 'siniflar' && <Siniflar />}
      {page === 'ogretmenler' && <Ogretmenler />}
      {page === 'atamalar' && <Atamalar />}
      {page === 'ders-programlari' && <DersProgramlari />}
      {page === 'ogretmen-programlari' && <OgretmenProgramlari />}

      <footer className="site-footer">
        <div className="footer-box p-6 footer-gradient">
          <div className="footer-text">
            Fenerbahçe tüm şahsiyet ve kişilerin üstüdür. Fenerbahçe sonsuza dek yaşayacaktır, yaşlandıkça güzelleşecektir.
          </div>
        </div>
      </footer>
    </div>
  )
}

const LOGIN_BUBBLES = [
  { left: '5%', size: 6, delay: '0s', duration: '9s' },
  { left: '12%', size: 4, delay: '2.1s', duration: '11s' },
  { left: '20%', size: 8, delay: '4.4s', duration: '8.5s' },
  { left: '35%', size: 3, delay: '1.2s', duration: '10s' },
  { left: '64%', size: 5, delay: '3s', duration: '9.5s' },
  { left: '78%', size: 7, delay: '0.6s', duration: '10.5s' },
  { left: '88%', size: 4, delay: '5.2s', duration: '8s' },
  { left: '95%', size: 6, delay: '2.7s', duration: '11.5s' },
]

const LOGIN_SPARKLES = [
  { left: '8%', top: '18%', delay: '0s', duration: '3.2s' },
  { left: '14%', top: '68%', delay: '1.4s', duration: '2.8s' },
  { left: '6%', top: '84%', delay: '2.6s', duration: '3.6s' },
  { left: '22%', top: '38%', delay: '0.9s', duration: '3s' },
  { left: '90%', top: '22%', delay: '0.5s', duration: '3s' },
  { left: '86%', top: '72%', delay: '2s', duration: '3.4s' },
  { left: '93%', top: '48%', delay: '1.1s', duration: '2.6s' },
  { left: '78%', top: '85%', delay: '1.7s', duration: '3.1s' },
]

const LOGIN_ORBS = [
  { className: 'login-orb-1', speed: 0.16, radiusX: 70, radiusY: 46, phase: 0 },
  { className: 'login-orb-2', speed: 0.11, radiusX: 90, radiusY: 60, phase: 2.1 },
  { className: 'login-orb-3', speed: 0.135, radiusX: 60, radiusY: 80, phase: 4.4 },
]

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [shake, setShake] = useState(false)
  const [entering, setEntering] = useState(true)

  const tiltRef = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)
  const orbRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 1000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = (now - start) / 1000
      LOGIN_ORBS.forEach((o, i) => {
        const el = orbRefs.current[i]
        if (!el) return
        const x = Math.sin(t * o.speed + o.phase) * o.radiusX
        const y = Math.cos(t * o.speed * 0.85 + o.phase) * o.radiusY
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (name.trim() === 'rft' && password === 'rft') {
      setError(null)
      onSuccess()
      return
    }
    setError('Kullanıcı adı veya şifre hatalı')
    setShake(true)
    setTimeout(() => setShake(false), 450)
  }

  const handleShellMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const rotateY = (px - 0.5) * 8
    const rotateX = (0.5 - py) * 8
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
    if (glareRef.current) {
      glareRef.current.style.opacity = '1'
      glareRef.current.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, #ffffff48, transparent 62%)`
    }
  }

  const handleCardMouseLeave = () => {
    const el = tiltRef.current
    if (el) el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)'
    if (glareRef.current) glareRef.current.style.opacity = '0'
  }

  return (
    <div className="login-shell" onMouseMove={handleShellMouseMove}>
      <div className="login-orbs" aria-hidden="true">
        {LOGIN_ORBS.map((o, i) => (
          <div key={o.className} className={`login-orb ${o.className}`} ref={(el) => { orbRefs.current[i] = el }} />
        ))}
      </div>
      <div className="login-beam" aria-hidden="true" />
      <div className="login-spotlight" aria-hidden="true" />

      <div className="ocean-bubbles" aria-hidden="true">
        {LOGIN_BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bubble"
            style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }}
          />
        ))}
      </div>

      {LOGIN_SPARKLES.map((s, i) => (
        <span
          key={i}
          className="ocean-sparkle login-sparkle"
          style={{ left: s.left, top: s.top, animationDelay: s.delay, animationDuration: s.duration }}
        />
      ))}

      <div className="ocean-jelly login-jelly login-jelly-1" style={{ top: '14%' }}>
        <JellyfishIconLogin gradId="jelly-grad-login-1" />
      </div>
      <div className="ocean-jelly login-jelly login-jelly-2" style={{ top: '62%', animationDelay: '11s, 1.1s' }}>
        <JellyfishIconLogin gradId="jelly-grad-login-2" />
      </div>

      <div className="login-vignette" aria-hidden="true" />

      <div className="login-content">
        <div className="login-glow-ring" aria-hidden="true" />
        <div
          className="login-tilt"
          ref={tiltRef}
          onMouseMove={handleCardMouseMove}
          onMouseLeave={handleCardMouseLeave}
        >
          <div className={`login-card${entering ? ' entering' : ''}${shake ? ' shake' : ''}`}>
            <div className="login-glare" ref={glareRef} aria-hidden="true" />
            <div className="login-logo-wrap">
              <div className="login-logo-halo">
                <img src={fokLogo} alt="Fok" />
              </div>
              <div>
                <div className="login-title">Hoş geldiniz</div>
                <div className="login-subtitle">Ders programı hazırlamak için giriş yap</div>
              </div>
            </div>
            <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
              <div className="field login-field">
                <span className="field-label">Kullanıcı Adı</span>
                <div className="login-field-inner">
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="username"
                    placeholder="Kullanıcı adınız"
                  />
                </div>
              </div>
              <div className="field login-field">
                <span className="field-label">Şifre</span>
                <div className="login-field-inner" style={{ position: 'relative' }}>
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
              <button className="btn btn-primary login-submit" type="submit" style={{ width: '100%', marginTop: 4 }}>
                Giriş
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function JellyfishIconLogin({ gradId }: { gradId: string }) {
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

function AuthBar({ onLogout }: { onLogout: () => void }) {
  const [syncing, setSyncing] = useState<'idle' | 'up' | 'down'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

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
    const ok = window.confirm('Buluttaki veri, bu cihazdaki henüz buluta kaydedilmemiş değişikliklerin üzerine yazacak. Devam edilsin mi?')
    if (!ok) return
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
    <>
      <div className="glass p-4" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="pill">rft olarak giriş yapıldı</div>
          {message && <span className="muted">{message}</span>}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowGuide(v => !v)}>{showGuide ? 'Kılavuzu Gizle' : '📘 Kullanım Kılavuzu'}</button>
          <button className="btn btn-outline btn-sm" onClick={doSave} disabled={syncing !== 'idle'}>💾 Buluta Kaydet</button>
          <button className="btn btn-outline btn-sm" onClick={doLoad} disabled={syncing !== 'idle'}>☁️ Buluttan Çek</button>
          <button className="btn btn-danger btn-sm" onClick={doReset} disabled={syncing !== 'idle'}>Sıfırla</button>
          <button className="btn btn-outline btn-sm" onClick={onLogout}>Çıkış</button>
        </div>
      </div>
      {showGuide && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'grid',
          placeItems: 'center',
          padding: 16
        }}>
          <div className="glass" style={{
            maxWidth: 760,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 20,
            border: '1px solid rgba(148,163,184,0.2)',
            boxShadow: '0 18px 40px rgba(0,0,0,0.25)',
            position: 'relative'
          }}>
            <button
              className="btn btn-outline btn-sm"
              style={{ position: 'absolute', top: 12, right: 12 }}
              onClick={() => setShowGuide(false)}
            >
              Kapat
            </button>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>📘</span>
              Kullanım Kılavuzu
            </div>
            <div style={{ display: 'grid', gap: 12, lineHeight: 1.6 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Okul Bilgisi</div>
                <div>- Okul / Müdür adı ve günlük ders sayısı; otomatik saklanır.</div>
                <div>- Sınıf ve şube ekleyip silin. Yeni bir sınıf eklediğinizde diğer tüm sayfalara (Dersler, Sınıflar, Öğretmenler, Atamalar, Ders Programları) otomatik yansır — ama derslerin o sınıf için haftalık saati olmadan Atamalar'da sütun görünmez, önce Dersler'den saatleri girin.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Dersler</div>
                <div>- Her ders için sınıf seviyesine göre varsayılan haftalık saat tanımlanır.</div>
                <div>- Ders kuralları (günlük üst sınır, blok, ardışık üst sınır, min gün, öncelik) yerleşimde dikkate alınır.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Sınıflar</div>
                <div>- Bir şubenin belirli bir dersten Dersler'deki sınıf varsayılanından farklı (0 dahil) saat alması gerekiyorsa buradan şubeye özel sapma girilir.</div>
                <div>- “Eşitle” ile bir sınıf seviyesindeki tüm şubelerin saatlerini tek bir şubeninkiyle aynı yapabilirsiniz.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Öğretmenler</div>
                <div>- Branş ve tercih sınıfları seçin; uygun olmayan saatleri “Uygunluk” ile işaretleyin.</div>
                <div>- Yoğunluk rozeti (%) o öğretmenin, kilitlenmemiş atamalar uygun öğretmenler arasında eşit paylaştırılırsa alacağı tahmini yükü gösterir — gerçek oluşturulmuş programdaki fiili saat sayısıyla (Öğretmen Programları'ndaki gibi) birebir aynı olması gerekmez, sadece bir tahmindir.</div>
                <div>- “Uygunlukları Sıfırla” ile tüm öğretmenlerin uygunluklarını temizleyebilirsiniz.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Atamalar</div>
                <div>- Bir ders/şube için tek uygun öğretmen varsa otomatik atanır; birden fazla aday varsa elle seçim yapmanız istenir.</div>
                <div>- “Sıfırla” tüm elle yapılmış atamaları temizler (dersler/saatler etkilenmez).</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Ders Programları</div>
                <div>- “Programları Oluştur”, siz “Durdur”a basana ya da en fazla 15 dakika geçene kadar arka planda binlerce kombinasyon dener ve en iyi (en az eksikli) sonucu tutar. İlerleme çubuğu geçen süreyi ve deneme sayısını gösterir.</div>
                <div>- Bir hücreyi sürükleyip bırakarak (veya dokunarak) taşıyabilir, kilit simgesiyle sabitleyebilirsiniz — kilitli dersler yeniden oluşturmada korunur.</div>
                <div>- Her sınıf kartındaki “Zorunlu Dersler” o şubenin haftalık ders saati dağılımını gösterir.</div>
                <div>- Eksik dersler paneli kalanları ve olası nedenlerini (öğretmen uygunluğu/tercih kısıtları) listeler.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Öğretmen Programları</div>
                <div>- Her öğretmenin kendi haftalık programını ve doluluk oranını gösterir.</div>
                <div>- “Kilitle” ile bir öğretmenin programını sabitleyin; program yeniden oluşturulduğunda kilitli öğretmenlerin programı değişmez.</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Bulut</div>
                <div>- 💾 Buluta Kaydet: veriyi Supabase’e yazar.</div>
                <div>- ☁️ Buluttan Çek: son kaydı indirir ve sayfayı yeniler.</div>
                <div>- Sıfırla: yerel veriyi siler (bulut verisine dokunmaz).</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Çıktılar</div>
                <div>- Ders Programları ve Öğretmen Programları sayfalarındaki 📄 EL PDF / 📊 Çarşaf PDF butonlarıyla yazdır/indir.</div>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                İpucu: Öğretmen uygunluklarını adım adım daraltıp her seferinde “Programları Oluştur”u denemek yerleşimi hızlandırır.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
