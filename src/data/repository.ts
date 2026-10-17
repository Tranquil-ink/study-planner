import type { Backup } from './backup'
import type { Operation, Receipt, Snapshot } from '../domain/model'
export interface Repository {
  snapshot(): Promise<Snapshot>
  submit(operation: Operation): Promise<Receipt>
  confirm(requestId: string): Promise<Receipt | null>
  exportBackup(): Promise<Backup>
  restore(backup: Backup, expectedRevision: number, requestId: string): Promise<Receipt>
  migrate(contents: string, expectedRevision: number, requestId: string): Promise<Receipt>
}
