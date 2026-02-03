import type { Subject, Teacher, Day } from './types'

type ClassSchedule = Record<Day, Array<{ subjectId?: string; teacherId?: string }>>

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']
const LESSON_TIMES = ['08:40', '09:35', '10:35', '11:30', '13:10', '14:05', '15:00']

function getSubjectAbbr(name: string): string {
  const upper = name.toUpperCase()
  if (upper.includes('MATEMATİK')) return 'MAT'
  if (upper.includes('TÜRKÇE')) return 'TURKC'
  if (upper.includes('FEN')) return 'FEN B'
  if (upper.includes('İNGİLİZCE')) return 'İNG.'
  if (upper.includes('SOSYAL')) return 'SOS7'
  if (upper.includes('DİN')) return 'DİN'
  if (upper.includes('BEDEN')) return 'BED'
  if (upper.includes('MÜZİK')) return 'MÜZ'
  if (upper.includes('GÖRSEL')) return 'GÖRSE'
  if (upper.includes('BİLİŞİM')) return 'BİL.T'
  if (upper.includes('TEKNOLOJ')) return 'TTAS'
  if (upper.includes('REHBERLİK')) return 'REH'
  if (name.startsWith('S.')) {
    if (upper.includes('İNGİLİZCE')) return 'S.İNG'
    if (upper.includes('MASAL')) return 'SMD'
    if (upper.includes('PEYGAMBER')) return 'S.P.H'
    if (upper.includes('KÜLTÜR')) return 'S.KMY'
    if (upper.includes('KURAN')) return 'S.KUR'
    if (upper.includes('MATEMATİK')) return 'S.M.B'
    if (upper.includes('AFET')) return 'S.A.B'
    if (upper.includes('OYUN')) return 'S.O.E'
    if (upper.includes('MEDYA')) return 'MED'
  }
  return name.slice(0, 6).toUpperCase()
}

function getTeacherAbbr(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return parts.map(p => p[0].toUpperCase()).join('.')
}

export function generateClassHandbookHTML(
  classKey: string,
  schedule: ClassSchedule,
  subjects: Subject[],
  teachers: Teacher[],
  schoolName: string
): string {
  const [grade, section] = classKey.split('-')
  const today = new Date().toLocaleDateString('tr-TR')
  const principalName = 'Nurten HOYRAZLI'

  // Calculate subject counts
  const subjectCounts = new Map<string, { name: string; hours: number; teacherName: string }>()

  DAYS.forEach(day => {
    const daySchedule = schedule[day]
    if (!daySchedule) return

    daySchedule.forEach(cell => {
      if (cell.subjectId) {
        const subject = subjects.find(s => s.id === cell.subjectId)
        const teacher = teachers.find(t => t.id === cell.teacherId)

        if (!subjectCounts.has(cell.subjectId)) {
          subjectCounts.set(cell.subjectId, {
            name: subject?.name || '',
            hours: 0,
            teacherName: teacher?.name || ''
          })
        }
        const entry = subjectCounts.get(cell.subjectId)!
        entry.hours++
      }
    })
  })

  const subjectList = Array.from(subjectCounts.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${grade}/${section} Sınıfı Ders Programı</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; background: white; }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 12mm;
      box-sizing: border-box;
      background: white;
    }

    /* ÜST BAŞLIK - 20mm */
    .header {
      height: 20mm;
      text-align: center;
      font-weight: bold;
      font-size: 12pt;
      line-height: 1.1;
      position: relative;
      margin-bottom: 6mm;
    }

    .header-date {
      position: absolute;
      top: 0;
      right: 0;
      font-size: 11pt;
      font-weight: normal;
    }

    /* SINIF BİLGİ - 12mm */
    .class-info {
      height: 12mm;
      width: 95mm;
      font-size: 10.5pt;
      line-height: 1.3;
      margin-bottom: 4mm;
    }

    /* AÇIKLAMA + MÜDÜR - 20mm */
    .message-block {
      min-height: 28mm;
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      margin-bottom: 6mm;
    }

    .message {
      width: 140mm;
      font-size: 10.5pt;
      line-height: 1.2;
      text-align: justify;
    }

    .message p {
      margin: 1mm 0;
      white-space: nowrap;
      letter-spacing: 0.1px;
    }

    .signature {
      width: 40mm;
      text-align: right;
      font-weight: bold;
      font-size: 10.5pt;
      line-height: 1.3;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: flex-end;
    }

    /* ANA TABLO - 170mm x 62mm */
    .main-table {
      width: 170mm;
      height: 62mm;
      border-collapse: collapse;
      margin: 0 auto 10mm auto;
      border: 0.3mm solid #000;
    }

    .main-table th,
    .main-table td {
      border: 0.3mm solid #000;
      text-align: center;
      vertical-align: middle;
      padding: 1.2mm;
    }

    /* Başlık satırı - 14mm */
    .main-table thead tr {
      height: 14mm;
    }

    /* Gün sütunu - 28mm */
    .main-table .day-col {
      width: 28mm;
      font-weight: bold;
      font-size: 10pt;
    }

    /* Ders sütunları - 20.285mm */
    .main-table .lesson-col {
      width: 20.285mm;
    }

    .main-table thead .lesson-header {
      font-size: 10pt;
      font-weight: bold;
      line-height: 1.2;
    }

    /* Gün satırları - 9.6mm */
    .main-table tbody tr {
      height: 9.6mm;
    }

    .cell-subject {
      font-weight: bold;
      font-size: 10pt;
      line-height: 1.1;
    }

    .cell-teacher {
      font-size: 9pt;
      line-height: 1.1;
      margin-top: 0.5mm;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ALT LİSTE - 170mm */
    .summary {
      width: 170mm;
      margin: 0 auto;
    }

    .summary-header {
      font-weight: bold;
      font-size: 10.5pt;
      margin-bottom: 2mm;
      display: flex;
      padding: 0 2mm;
    }

    .summary-header .col1 { width: 90mm; }
    .summary-header .col2 { width: 12mm; text-align: center; }
    .summary-header .col3 { width: 58mm; }
    .summary-header .col4 { width: 10mm; }

    .summary-row {
      display: flex;
      font-size: 10.5pt;
      line-height: 5.5mm;
      height: 5.5mm;
      align-items: center;
      padding: 0 2mm;
    }

    .summary-row .col1 { width: 90mm; }
    .summary-row .col2 { width: 12mm; text-align: center; }
    .summary-row .col3 { width: 58mm; text-transform: uppercase; }
    .summary-row .col4 { width: 10mm; }

    @media print {
      body { background: white; }
      .page { margin: 0; padding: 12mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- ÜST BAŞLIK -->
    <div class="header">
      <div class="header-date">${today}</div>
      <div>T.C.</div>
      <div>FİNİKE KAYMAKAMLIĞI</div>
      <div>${schoolName || 'Hasyurt Ortaokulu'}</div>
    </div>

    <!-- SINIF BİLGİ -->
    <div class="class-info">
      <div><strong>Sınıfın Adı</strong> : ${grade}/${section}</div>
      <div><strong>Sınıf Öğretmeni</strong> :</div>
    </div>

    <!-- AÇIKLAMA + MÜDÜR -->
    <div class="message-block">
      <div class="message">
        <p>2025 - 2026 Öğretim Yılında 12.12.2025 tarihinden itibaren uygulanacak programınız aşağıya çıkartılmıştır.</p>
        <p>Bilgilerinizi ve gereğini rica eder. Başarılar dilerim.</p>
      </div>
      <div class="signature">
        <div>${principalName}</div>
        <div>Müdür</div>
      </div>
    </div>

    <!-- ANA TABLO -->
    <table class="main-table">
      <thead>
        <tr>
          <th class="day-col"></th>
          ${LESSON_TIMES.map((time, idx) => `
            <th class="lesson-col lesson-header">
              ${idx + 1}<br>${time}
            </th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${DAYS.map(day => `
        <tr>
          <td class="day-col">${day}</td>
          ${LESSON_TIMES.map((_, idx) => {
            const cell = schedule[day]?.[idx]
            if (!cell?.subjectId) {
              return '<td class="lesson-col">—</td>'
            }
            const subject = subjects.find(s => s.id === cell.subjectId)
            const teacher = teachers.find(t => t.id === cell.teacherId)
            return `<td class="lesson-col">
              <div class="cell-subject">${subject ? getSubjectAbbr(subject.name) : '—'}</div>
              <div class="cell-teacher">${teacher ? getTeacherAbbr(teacher.name) : ''}</div>
            </td>`
          }).join('')}
        </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- ALT LİSTE -->
    <div class="summary">
      <div class="summary-header">
        <div class="col1">Dersin Adı</div>
        <div class="col2">HDS</div>
        <div class="col3">Öğretmenin Adı</div>
        <div class="col4">Derslik</div>
      </div>
      ${subjectList.map(item => `
      <div class="summary-row">
        <div class="col1">${item.name}</div>
        <div class="col2">${item.hours}</div>
        <div class="col3">${item.teacherName}</div>
        <div class="col4"></div>
      </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`
}
