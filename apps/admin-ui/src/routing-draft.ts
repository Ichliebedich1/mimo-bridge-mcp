import type { RoutingProfiles } from './types';

export function shouldSyncRoutingDraftFromServer({
  isDirty,
  serverProfiles,
  draft,
}: {
  isDirty: boolean;
  serverProfiles: RoutingProfiles | null;
  draft: RoutingProfiles | null;
}): boolean {
  if (!serverProfiles) {
    return draft !== null;
  }
  return !isDirty;
}

