import type { Subject, Teacher, Day } from '../shared/types'

type Cell = { subjectId?: string; teacherId?: string }

type Props = {
  tables: Record<string, Record<Day, Cell[]>>
  subjects: Subject[]
  teachers: Teacher[]
  school: { schoolName?: string }
  slots: string[]
}

// Placeholder sheet printer; previously removed. Keeps build happy.
export default function TeacherSheetPrint(_props: Props) {
  return null
}
