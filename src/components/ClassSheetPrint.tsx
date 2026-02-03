import type { Subject, Teacher, Day } from '../shared/types'

type Cell = { subjectId?: string; teacherId?: string }

type Props = {
  tables: Record<string, Record<Day, Cell[]>>
  subjects: Subject[]
  teachers: Teacher[]
  classes: Array<{ key: string; grade: string; section: string }>
  school: { schoolName?: string }
  slots: string[]
}

// Placeholder sheet printer; previously removed. Keeps build happy.
export default function ClassSheetPrint(_props: Props) {
  return null
}
