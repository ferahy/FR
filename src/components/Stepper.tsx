export default function Stepper({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        aria-label={`${label} saatini azalt`}
        onClick={() => onChange(Math.max(0, value - 1))}
        style={{
          height: 26, width: 26, borderRadius: 8, border: '1px solid #ffffff2e',
          background: '#ffffff12', color: 'inherit', cursor: 'pointer', lineHeight: 1
        }}
      >
        −
      </button>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', minWidth: 44, textAlign: 'center' }}>
        {value} saat
      </span>
      <button
        type="button"
        aria-label={`${label} saatini arttır`}
        onClick={() => onChange(value + 1)}
        style={{
          height: 26, width: 26, borderRadius: 8, border: '1px solid #ffffff2e',
          background: '#ffffff12', color: 'inherit', cursor: 'pointer', lineHeight: 1
        }}
      >
        +
      </button>
    </div>
  )
}
