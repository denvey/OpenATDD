const ADMINS = new Set(["admin-1"]);

export function canManageAccount(actorId, accountId) {
  return actorId === accountId || ADMINS.has(actorId);
}
