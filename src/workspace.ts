/** Root navigation identity, independent of journey mode and request source. */
export type WorkspaceId = 'EXPLORE' | 'DEMO' | 'LIVE';

// These identities are deliberately distinct from each other and RunGate's number.
export type WorkspaceInstanceId = string & { readonly workspaceInstance: unique symbol };
export type GuidedSessionId = string & { readonly guidedSession: unique symbol };
export interface WorkspaceDestination {
  workspace: WorkspaceId;
  instanceId?: WorkspaceInstanceId;
}

export const demoCompatibilityHost: WorkspaceDestination = {
  workspace: 'DEMO',
  instanceId: 'demo:compatibility' as WorkspaceInstanceId,
};

export const workspaces: readonly { id: WorkspaceId; label: string }[] = [
  { id: 'EXPLORE', label: 'Explore' },
  { id: 'DEMO', label: 'Demo Lab' },
  { id: 'LIVE', label: 'Live Lab' },
];

/** Temporary Part-1 migration guard, not global session admission. */
export function canSwitchWorkspace(
  current: WorkspaceId,
  destination: WorkspaceId,
  demoJourney: { active: boolean; completed: boolean },
): boolean {
  return current !== 'DEMO' || destination === 'DEMO' || !demoJourney.active || demoJourney.completed;
}
