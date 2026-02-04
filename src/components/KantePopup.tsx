type Props = { onClose: () => void }

export default function KantePopup({ onClose }: Props) {
  return (
    <div
      className="glass"
      style={{
        position: 'sticky',
        top: 10,
        zIndex: 50,
        marginBottom: 12,
        padding: 14,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'linear-gradient(135deg, #0b1f3a, #0c2d5c)',
        color: '#e2e8f0',
        boxShadow: '0 18px 40px rgba(0,0,0,0.32)',
        borderRadius: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: '#12274d', display: 'grid', placeItems: 'center', fontWeight: 800, color: '#facc15' }}>
          ⚽️
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Hoş geldin Kante! 💛💙</div>
          <div style={{ fontSize: 13, lineHeight: 1.4, color: '#cbd5e1' }}>
            Yol uzun, biz hazırız 
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>Kapat</button>
      </div>
    </div>
  )
}
