import type { WorkspaceEvent } from '../shared/contracts.ts'

export class WorkspaceEventBus {
  private readonly listeners = new Set<(event: WorkspaceEvent) => void>()

  emit(event: WorkspaceEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: (event: WorkspaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
