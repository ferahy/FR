// Öğretmen, ders, atama ya da okul/sınıf yapısı değiştiğinde, daha önce
// oluşturulmuş ders programı artık bu yeni veriyi yansıtmadığından geçersiz
// sayılır ve temizlenir — kullanıcı "Programları Oluştur"u tekrar çalıştırmadan
// eski (ve artık yanlış olabilecek) bir programı doğruymuş gibi görmesin.
const SCHEDULE_KEYS = ['timetables', 'lockedCells', 'lockedTeachers']

export function invalidateGeneratedSchedule() {
  try {
    for (const key of SCHEDULE_KEYS) localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
