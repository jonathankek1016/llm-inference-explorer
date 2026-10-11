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

/** Destination intent is explicit even when two workspaces show the same concept. */
export type NavigationIntent =
  | { kind: 'local-concept'; conceptId: string }
  | { kind: 'explore-concept'; conceptId: string }
  | { kind: 'workspace'; destination: WorkspaceDestination }
  | { kind: 'return-session'; sessionId: GuidedSessionId };
