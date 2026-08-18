// Öğretmen, ders, atama ya da okul/sınıf yapısı değiştiğinde, daha önce
// oluşturulmuş ders programı artık bu yeni veriyi yansıtmadığından geçersiz
// sayılır ve temizlenir — kullanıcı "Programları Oluştur"u tekrar çalıştırmadan
// eski (ve artık yanlış olabilecek) bir programı doğruymuş gibi görmesin.
//
// lockedCells/lockedTeachers KASITLI OLARAK bu listede DEĞİL: kilitler
// kullanıcının açık talebidir (örn. "A öğretmenin yerini hiçbir şey
// değiştirmesin"), başka bir öğretmenin uygunluğunu düzenlemek gibi ilgisiz
// bir işlem yüzünden sessizce silinmemeli. Silinirse, örneğin B'nin
// uygunluğunu değiştirmek A'nın kilidini de kaldırır ve bir sonraki
// "Programları Oluştur"da A'nın yerleşimi de değişir — kilit anlamsız kalır.
const SCHEDULE_KEYS = ['timetables']

export function invalidateGeneratedSchedule() {
  try {
    for (const key of SCHEDULE_KEYS) localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
