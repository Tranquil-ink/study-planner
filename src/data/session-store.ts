import type { Snapshot } from '../domain/model'
// Shared guard for late requests. Scope invalidation happens on auth changes.
export class SnapshotGuard {
  private epoch = 0
  private revision = -1
  ticket() { return this.epoch }
  invalidate() { this.epoch++; this.revision = -1 }
  accept(ticket: number, snapshot: Snapshot) {
    if (ticket !== this.epoch || snapshot.revision < this.revision) return false
    this.revision = snapshot.revision
    return true
  }
}
