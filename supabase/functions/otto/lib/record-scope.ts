import type { ToolContext } from "./types.ts";

const OWNER_KEYS = ["assigned_to", "seller_id", "created_by", "user_id"] as const;

export function recordOwnerId(record: object): string | null {
  for (const key of OWNER_KEYS) {
    const value = Reflect.get(record, key);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function canAccessRecord(ctx: ToolContext, record: object): boolean {
  if (ctx.dataScope === "all") return true;
  const ownerId = recordOwnerId(record);
  return ownerId !== null && ctx.scopeUserIds.has(ownerId);
}

export function filterAccessibleRecords<T extends object>(
  ctx: ToolContext,
  records: readonly T[],
): T[] {
  return records.filter((record) => canAccessRecord(ctx, record));
}

export function canAssignUser(ctx: ToolContext, userId: string): boolean {
  return ctx.dataScope === "all" || ctx.scopeUserIds.has(userId);
}
