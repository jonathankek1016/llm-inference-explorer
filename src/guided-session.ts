import type { GuidedSessionId, WorkspaceDestination, WorkspaceInstanceId } from './workspace.ts';

export interface SessionOwner {
  readonly workspace: 'DEMO' | 'LIVE';
  readonly instanceId: WorkspaceInstanceId;
  readonly label: string;
}
/** Local state and recovery stay in the lab, never copied into the global slot. */
export interface SessionPort {
  incomplete(): boolean;
  detach(): void;
  resume(): void;
  end(): void;
}
export interface GuidedReservation {
  readonly id: GuidedSessionId;
  readonly owner: SessionOwner;
}
export type Admission =
  { allowed: true; reservation: GuidedReservation } | { allowed: false; reservation: GuidedReservation };

export const isIncompleteJourney = (journey: { active: boolean; completed: boolean }) =>
  journey.active && !journey.completed;

/** One in-memory incomplete educational session; no clocks, camera or request state. */
export class GuidedSessions {
  private sequence = 0;
  private slot: GuidedReservation | undefined;
  private readonly ports = new Map<WorkspaceInstanceId, { owner: SessionOwner; port: SessionPort }>();

  register(owner: SessionOwner, port: SessionPort) {
    if (this.ports.has(owner.instanceId)) throw new Error('Workspace instance already registered');
    this.ports.set(owner.instanceId, { owner, port });
  }
  get current(): GuidedReservation | undefined {
    return this.slot;
  }
  /** Replaying the same local experience is allowed; a different owner conflicts. */
  admit(owner: SessionOwner, fresh = false): Admission {
    const registered = this.ports.get(owner.instanceId);
    if (!registered || registered.owner.workspace !== owner.workspace)
      throw new Error('Unknown guided workspace');
    if (this.slot && this.slot.owner.instanceId !== owner.instanceId)
      return { allowed: false, reservation: this.slot };
    if (!this.slot || fresh)
      this.slot = Object.freeze({
        id: `guided:${++this.sequence}` as GuidedSessionId,
        owner: registered.owner,
      });
    return { allowed: true, reservation: this.slot };
  }
  /** Called after a local lifecycle transition; Completed releases only the slot. */
  reconcile(owner: SessionOwner) {
    if (
      this.slot?.owner.instanceId === owner.instanceId &&
      !this.ports.get(owner.instanceId)!.port.incomplete()
    )
      this.slot = undefined;
  }
  browse(destination: WorkspaceDestination) {
    const session = this.slot;
    if (
      session &&
      (destination.workspace !== session.owner.workspace ||
        (destination.instanceId !== undefined && destination.instanceId !== session.owner.instanceId))
    )
      this.ports.get(session.owner.instanceId)!.port.detach();
  }
  returnTo(id: GuidedSessionId, navigate: (destination: WorkspaceDestination) => void) {
    const session = this.slot;
    if (!session || session.id !== id) return;
    navigate(session.owner);
    this.ports.get(session.owner.instanceId)!.port.resume();
  }
  end(id: GuidedSessionId) {
    const session = this.slot;
    if (!session || session.id !== id) return;
    this.ports.get(session.owner.instanceId)!.port.end();
    this.reconcile(session.owner);
  }
}
