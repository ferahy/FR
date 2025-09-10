import './index.css'
import Okul from './pages/Okul'
import Dersler from './pages/Dersler'
import Ogretmenler from './pages/Ogretmenler'
import DersProgramlari from './pages/DersProgramlari'
import OgretmenProgramlari from './pages/OgretmenProgramlari'
import TopNav from './layout/TopNav'
import { useEffect } from 'react'
import { useHashRoute } from './shared/useHashRoute'

export default function App() {
  const { page, navigate } = useHashRoute('okul')

  useEffect(() => {
    if (!location.hash) {
      location.hash = '#/okul'
    }
  }, [])

  return (
    <div className="page container-narrow">
      <TopNav current={page} onNavigate={navigate} />

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
