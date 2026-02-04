import type { Subject, Teacher, Day } from './types'
import type { TeacherSchedule } from './pdfUtils'

type ClassSchedule = Record<Day, Array<{ subjectId?: string; teacherId?: string }>>

const DAYS: Day[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']
const LESSON_TIMES = ['08:40', '09:35', '10:35', '11:30', '13:10', '14:05', '15:00']

function getSubjectAbbr(name: string): string {
  const upper = name.trim().toLocaleUpperCase('tr-TR')
  if (!upper) return ''

  // Seçmeli dersler (önce kontrol et)
  if (upper.startsWith('S.') || upper.startsWith('SEÇMELİ')) {
    if (upper.includes('İNGİLİZCE')) return 'S.İNG'
    if (upper.includes('MASAL')) return 'SMD'
    if (upper.includes('PEYGAMBER')) return 'S.P.H'
    if (upper.includes('KÜLTÜR')) return 'S.KMY'
    if (upper.includes('KUR') && upper.includes('AN')) return 'S.KUR'
    if (upper.includes('MATEMATİK')) return 'S.M.B'
    if (upper.includes('AFET')) return 'S.A.B'
    if (upper.includes('OYUN')) return 'S.O.E'
    if (upper.includes('ÇEVRİ')) return 'S.ÇİD'
    if (upper.includes('MEDYA')) return 'MED'
  }

  // Özel eğitim dersleri
  if (upper.startsWith('ÖE') || upper.includes('ÖZEL EĞİTİM')) {
    if (upper.includes('DİN') || upper.includes('KÜLT')) return 'ÖEDK'
    if (upper.includes('GÖRSEL')) return 'ÖEGS'
    if (upper.includes('BEDEN')) return 'ÖEBDN'
    if (upper.includes('MÜZ')) return 'ÖEM'
    return 'ÖE'
  }

  // Normal dersler
  if (upper.includes('MATEMATİK')) return 'MAT'
  if (upper.includes('TÜRKÇE')) return 'TURKC'
  if (upper.includes('FEN')) return 'FEN B'
  if (upper.includes('İNGİLİZCE')) return 'İNG.'
  if (upper.includes('SOSYAL')) {
    // SOS7 veya SOS B olabilir
    return upper.includes('7') ? 'SOS7' : 'SOS B'
  }
  if (upper.includes('DİN') || upper.includes('KÜLT')) return 'DİN'
  if (upper.includes('BEDEN')) {
    // BED, BEDN veya BDN olabilir
    if (upper.includes('BEDN')) return 'BEDN'
    if (upper.includes('BDN')) return 'BDN'
    return 'BED'
  }
  if (upper.includes('MÜZİK')) return 'MÜZ'
  if (upper.includes('GÖRSEL')) return 'GÖRSE'
  if (upper.includes('BİLİŞİM')) {
    return upper.includes('TEKNOLOJ') ? 'BTK' : 'BİL.T'
  }
  if (upper.includes('TEKNOLOJ')) {
    if (upper.includes('TASARIM')) return 'TTAS'
    if (upper.includes('TEKTA')) return 'TEKTA'
    return 'TEKNO'
  }
  if (upper.includes('REHBERLİK')) return 'REH'
  if (upper.includes('İNKILAP') || upper.includes('İNK')) {
    return upper.includes('8') ? 'İNK8' : 'İNK'
  }

  // Varsayılan: ilk 6 karakter
  return upper.slice(0, 6)
}

function getTeacherAbbr(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((p) => p.toLocaleUpperCase('tr-TR'))
    .filter(Boolean)

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 3)
  return parts.map(p => p[0]).join('.') + '.'
}

export function generateClassHandbookHTML(
  classKey: string,
  schedule: ClassSchedule,
  subjects: Subject[],
  teachers: Teacher[],
  schoolNameFromProps: string,
  principalNameFromSchool?: string
): string {
  const [grade, section] = classKey.split('-')
  const today = new Date().toLocaleDateString('tr-TR')
  const principalName = principalNameFromSchool && principalNameFromSchool.trim() ? principalNameFromSchool : 'Nurten HOYRAZLI'
  const schoolNameSafe = schoolNameFromProps && schoolNameFromProps.trim() ? schoolNameFromProps : 'Hasyurt Ortaokulu'

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

  const maxNameLength = subjectList.reduce((max, item) => Math.max(max, item.name.length), 0)
  const col1Width = Math.min(Math.max(maxNameLength * 2.0, 60), 110)

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
      width: 135mm;
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
      width: 35mm;
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
      width: auto;
      max-width: 170mm;
      margin: 0 auto;
      font-size: 10pt;
      display: flex;
      flex-direction: column;
      gap: 1mm;
    }

    .summary-header,
    .summary-row {
      display: grid;
      grid-template-columns: var(--col1-width, 90mm) 12mm 55mm 10mm;
      column-gap: 1.5mm;
      align-items: center;
      padding: 0 1mm;
      line-height: 1.2;
    }

    .summary-header {
      font-weight: bold;
      margin-bottom: 1mm;
    }

    .summary-header .col2,
    .summary-row .col2,
    .summary-header .col4,
    .summary-row .col4 {
      text-align: center;
    }

    .summary-row .col3 {
      text-transform: uppercase;
    }

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
      <div>${schoolNameSafe}</div>
    </div>

    <!-- SINIF BİLGİ -->
    <div class="class-info">
      <div><strong>Sınıfın Adı</strong> : ${grade}/${section}</div>
      <div><strong>Sınıf Öğretmeni</strong> :</div>
    </div>

    <!-- AÇIKLAMA + MÜDÜR -->
    <div class="message-block">
      <div class="message">
        <p>2025 - 2026 Öğretim Yılında ${today} tarihinden itibaren uygulanacak programınız aşağıya çıkartılmıştır.</p>
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
    <div class="summary" style="--col1-width: ${col1Width}mm">
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

export function generateTeacherHandbookHTML(
  teacher: Teacher,
  schedule: TeacherSchedule,
  _subjects: Subject[],
  schoolNameFromProps: string,
  principalNameFromSchool?: string,
  slotTimes?: string[]
): string {
  const today = new Date().toLocaleDateString('tr-TR')
  const principalName = principalNameFromSchool && principalNameFromSchool.trim() ? principalNameFromSchool : 'Nurten HOYRAZLI'
  const schoolNameSafe = schoolNameFromProps && schoolNameFromProps.trim() ? schoolNameFromProps : 'Hasyurt Ortaokulu'
  const times = slotTimes && slotTimes.length ? slotTimes : LESSON_TIMES
  let totalHours = 0
  DAYS.forEach(day => {
    schedule[day]?.forEach(cell => {
      if (cell.subjectId) totalHours++
    })
  })

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${teacher.name} Ders Programı</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; background: white; }

    .page { width: 210mm; min-height: 297mm; padding: 12mm; box-sizing: border-box; }

    .header { height: 20mm; text-align: center; font-weight: bold; font-size: 12pt; line-height: 1.3; }
    .header div { margin: 1mm 0; }
    .header-date { text-align: right; font-weight: normal; font-size: 10pt; }

    .teacher-info { margin: 4mm 0 8mm 0; font-size: 10pt; }
    .teacher-info div { margin: 1mm 0; }

    .message-block { min-height: 28mm; display: flex; justify-content: space-between; align-items: stretch; margin-bottom: 6mm; }
    .message { width: 135mm; font-size: 10.5pt; line-height: 1.2; text-align: justify; }
    .message p { margin: 1mm 0; white-space: nowrap; letter-spacing: 0.1px; }
    .signature { width: 35mm; text-align: right; font-weight: bold; font-size: 10.5pt; line-height: 1.3; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end; }

    .main-table { width: 170mm; border-collapse: collapse; margin: 0 auto 8mm auto; }
    .main-table th, .main-table td { border: 0.3mm solid #000; text-align: center; vertical-align: middle; }
    .main-table thead th { padding: 2mm 0; }
    .main-table .day-col { width: 28mm; font-weight: bold; font-size: 10pt; }
    .main-table .lesson-col { width: 20mm; height: 10mm; }
    .cell-subject { font-weight: bold; font-size: 10pt; line-height: 1.1; }
    .cell-class { font-size: 9pt; line-height: 1.1; margin-top: 0.5mm; }

    .pay-row { width: 170mm; margin: 0 auto 4mm auto; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 6mm; font-size: 10pt; }
    .pay-item { display: flex; align-items: center; gap: 4mm; }
    .pay-label { font-weight: bold; white-space: nowrap; }

    .meta-row { width: 170mm; margin: 0 auto 4mm auto; display: grid; grid-template-columns: auto 1fr auto 1fr; column-gap: 4mm; font-size: 10pt; align-items: center; }
    .meta-label { font-weight: bold; white-space: nowrap; }
    .meta-line { border-bottom: 0.3mm solid #000; height: 0; min-width: 30mm; }

    .duty-row { width: 170mm; margin: 0 auto 8mm auto; display: flex; align-items: flex-end; gap: 4mm; font-size: 10pt; }
    .duty-label { font-weight: bold; }
    .duty-line { flex: 1; border-bottom: 0.3mm solid #000; height: 0; min-width: 80mm; margin-bottom: -1mm; }

    .receipt { width: 170mm; margin: 0 auto; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end; font-size: 10pt; gap: 1mm; padding-top: 4mm; }
    .receipt-title { font-weight: bold; }
    .receipt-date { white-space: nowrap; }

    @media print { body { background: white; } .page { margin: 0; padding: 12mm; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-date">${today}</div>
      <div>T.C.</div>
      <div>FİNİKE KAYMAKAMLIĞI</div>
      <div>${schoolNameSafe}</div>
    </div>

    <div class="teacher-info">
      <div><strong>Öğretmenin Adı</strong> : ${teacher.name.toUpperCase()}</div>
      <div><strong>Konu</strong> : Haftalık Ders Programı</div>
    </div>

    <div class="message-block">
      <div class="message">
        <p>2025 - 2026 Öğretim Yılında ${today} tarihinden itibaren uygulanacak programınız aşağıya çıkartılmıştır.</p>
        <p>Bilgilerinizi ve gereğini rica eder. Başarılar dilerim.</p>
      </div>
      <div class="signature">
        <div>${principalName}</div>
        <div>Müdür</div>
      </div>
    </div>

    <table class="main-table">
      <thead>
        <tr>
          <th class="day-col"></th>
          ${times.map((t, idx) => `<th class="lesson-col">${idx + 1}<br>${t}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${DAYS.map(day => `
        <tr>
          <td class="day-col">${day}</td>
          ${times.map((_, idx) => {
            const cell = schedule[day]?.[idx]
            if (!cell?.subjectId) return '<td class="lesson-col">—</td>'
            return `<td class="lesson-col">
              <div class="cell-subject">${getSubjectAbbr(cell.subjectName || '')}</div>
              <div class="cell-class">${cell.className || ''}</div>
            </td>`
          }).join('')}
        </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="pay-row">
      <div class="pay-item">
        <span class="pay-label">MAAŞ :</span>
        <span>${totalHours || ''}</span>
      </div>
      <div class="pay-item">
        <span class="pay-label">ÜCRET :</span>
        <span class="pay-line"></span>
      </div>
      <div class="pay-item">
        <span class="pay-label">TOPLAM :</span>
        <span>${totalHours || ''}</span>
      </div>
    </div>

    <div class="duty-row">
      <span class="duty-label">NÖBET GÜNÜ VE YERİ :</span>
      <span class="duty-line"></span>
    </div>

    <div class="meta-row">
      <span class="meta-label">Sınıf Reh.Öğretmenliği :</span>
      <span class="meta-line"></span>
      <span class="meta-label">Eğitsel Kolu :</span>
      <span class="meta-line"></span>
    </div>

    <div class="receipt">
      <div class="receipt-title">ASLINI ALDIM</div>
      <div class="receipt-date">TARİH : __/__/____</div>
    </div>
  </div>
</body>
</html>`
}

export function generateClassSheetHTML(
  tables: Record<string, ClassSchedule>,
  subjects: Subject[],
  teachers: Teacher[],
  classes: Array<{ key: string; grade: string; section: string }>,
  schoolNameFromProps: string,
  slots: string[]
): string {
  const schoolNameSafe = schoolNameFromProps && schoolNameFromProps.trim() ? schoolNameFromProps : 'Hasyurt Ortaokulu'

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Sınıf Çarşaf - ${schoolNameSafe}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm 6mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 5pt;
      color: #000;
      background: white;
    }

    .page {
      width: 100%;
      background: white;
    }

    .header {
      text-align: center;
      margin-bottom: 6mm;
    }

    .header h1 {
      font-size: 11pt;
      font-weight: bold;
      margin: 0;
    }

    .carsaf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 5pt;
      table-layout: fixed;
    }

    .carsaf-table th,
    .carsaf-table td {
      border: 0.3mm solid #000;
      padding: 0.8mm;
      text-align: center;
      vertical-align: middle;
    }

    .carsaf-table th {
      background: #f0f0f0;
      font-weight: bold;
    }

    .carsaf-table .class-col {
      width: 15mm;
      font-weight: bold;
      background: #f8f8f8;
      font-size: 6pt;
    }

    .carsaf-table .day-header {
      font-size: 7pt;
      padding: 1.5mm 0.8mm;
    }

    .carsaf-table .slot-header {
      font-size: 5pt;
      padding: 0.8mm;
    }

    .cell-content {
      display: flex;
      flex-direction: column;
      gap: 0.3mm;
      align-items: center;
      justify-content: center;
      line-height: 1.05;
    }

    .cell-subject {
      font-weight: bold;
      font-size: 6pt;
    }

    .cell-teacher {
      font-size: 5pt;
      opacity: 0.8;
    }

    @media print {
      body {
        background: white;
      }
      .page {
        margin: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${schoolNameSafe} - SINIFLARIN HAFTALIK DERS PROGRAMI</h1>
    </div>

    <table class="carsaf-table">
      <thead>
        <tr>
          <th rowspan="2" class="class-col">Sınıf</th>
          ${DAYS.map(day => `
            <th colspan="${slots.length}" class="day-header">${day}</th>
          `).join('')}
        </tr>
        <tr>
          ${DAYS.map(() =>
            slots.map((_, idx) => `
              <th class="slot-header">${idx + 1}</th>
            `).join('')
          ).join('')}
        </tr>
      </thead>
      <tbody>
        ${classes.map(classItem => {
          const schedule = tables[classItem.key]
          if (!schedule) return ''

          return `
            <tr>
              <td class="class-col">${classItem.grade}/${classItem.section}</td>
              ${DAYS.map(day =>
                slots.map((_, slotIndex) => {
                  const cell = schedule[day]?.[slotIndex]
                  if (!cell?.subjectId) {
                    return '<td></td>'
                  }
                  const subject = subjects.find(s => s.id === cell.subjectId)
                  const teacher = teachers.find(t => t.id === cell.teacherId)

                  return `
                    <td>
                      <div class="cell-content">
                        <span class="cell-subject">${subject ? getSubjectAbbr(subject.name) : '—'}</span>
                        ${teacher ? `<span class="cell-teacher">${getTeacherAbbr(teacher.name)}</span>` : ''}
                      </div>
                    </td>
                  `
                }).join('')
              ).join('')}
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`
}

export function generateTeacherSheetHTML(
  teacherSchedules: Record<string, TeacherSchedule>,
  teachers: Teacher[],
  _subjects: Subject[],
  schoolNameFromProps: string,
  slots: string[]
): string {
  const schoolNameSafe = schoolNameFromProps && schoolNameFromProps.trim() ? schoolNameFromProps : 'Hasyurt Ortaokulu'

  // Calculate total hours for each teacher
  const teacherHours = new Map<string, number>()
  teachers.forEach(teacher => {
    let total = 0
    const schedule = teacherSchedules[teacher.id]
    if (schedule) {
      DAYS.forEach(day => {
        schedule[day]?.forEach(cell => {
          if (cell.classKey) total++
        })
      })
    }
    teacherHours.set(teacher.id, total)
  })

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Öğretmen Çarşaf - ${schoolNameSafe}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm 6mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 5pt;
      color: #000;
      background: white;
    }

    .page {
      width: 100%;
      background: white;
    }

    .header {
      text-align: center;
      margin-bottom: 6mm;
    }

    .header h1 {
      font-size: 11pt;
      font-weight: bold;
      margin: 0;
    }

    .carsaf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 5pt;
      table-layout: fixed;
    }

    .carsaf-table th,
    .carsaf-table td {
      border: 0.3mm solid #000;
      padding: 0.8mm;
      text-align: center;
      vertical-align: middle;
    }

    .carsaf-table th {
      background: #f0f0f0;
      font-weight: bold;
    }

    .carsaf-table .teacher-col {
      width: 40mm;
      font-weight: bold;
      background: #f8f8f8;
      font-size: 5.5pt;
      text-align: left;
      padding-left: 1.5mm;
    }

    .carsaf-table .day-header {
      font-size: 7pt;
      padding: 1.5mm 0.8mm;
    }

    .carsaf-table .slot-header {
      font-size: 5pt;
      padding: 0.8mm;
    }

    .cell-content {
      display: flex;
      flex-direction: column;
      gap: 0.3mm;
      align-items: center;
      justify-content: center;
      line-height: 1.05;
    }

    .cell-class {
      font-weight: bold;
      font-size: 6pt;
    }

    .cell-subject {
      font-size: 5pt;
      opacity: 0.8;
    }

    @media print {
      body {
        background: white;
      }
      .page {
        margin: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${schoolNameSafe} - ÖĞRETMENLERİN HAFTALIK DERS PROGRAMI</h1>
    </div>

    <table class="carsaf-table">
      <thead>
        <tr>
          <th rowspan="2" class="teacher-col"></th>
          ${DAYS.map(day => `
            <th colspan="${slots.length}" class="day-header">${day}</th>
          `).join('')}
        </tr>
        <tr>
          ${DAYS.map(() =>
            slots.map((_, idx) => `
              <th class="slot-header">${idx + 1}</th>
            `).join('')
          ).join('')}
        </tr>
      </thead>
      <tbody>
        ${teachers.map((teacher, index) => {
          const schedule = teacherSchedules[teacher.id]
          if (!schedule) return ''
          const totalHours = teacherHours.get(teacher.id) || 0

          return `
            <tr>
              <td class="teacher-col">${index + 1}- ${teacher.name.toUpperCase()} ${totalHours > 0 ? totalHours : ''}</td>
              ${DAYS.map(day =>
                slots.map((_, slotIndex) => {
                  const cell = schedule[day]?.[slotIndex]
                  if (!cell?.classKey) {
                    return '<td></td>'
                  }

                  return `
                    <td>
                      <div class="cell-content">
                        <span class="cell-class">${cell.className || ''}</span>
                        <span class="cell-subject">${cell.subjectName ? getSubjectAbbr(cell.subjectName) : ''}</span>
                      </div>
                    </td>
                  `
                }).join('')
              ).join('')}
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`
}
