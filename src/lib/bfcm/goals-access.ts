export type GoalAccess = 'write' | 'read' | 'none';

/**
 * Admins read and write every brand.
 * Founders read and write their own brand.
 * Strategists read their own brand.
 */
export function goalAccess(
  role: string | null | undefined,
  userBrandId: string | null | undefined,
  brandId: string
): GoalAccess {
  if (!brandId) return 'none';
  if (role === 'admin') return 'write';
  if (!userBrandId || userBrandId !== brandId) return 'none';
  if (role === 'founder') return 'write';
  if (role === 'strategist') return 'read';
  return 'none';
}

export type BackfillAuth = 'cron' | 'admin' | 'unauthorized' | 'forbidden';

export function backfillAuth(input: {
  authorization: string | null;
  cronSecret: string | undefined;
  role: string | null;
}): BackfillAuth {
  const header = input.authorization || '';
  if (input.cronSecret && header === `Bearer ${input.cronSecret}`) return 'cron';
  if (!header.startsWith('Bearer ') || header === 'Bearer ') return 'unauthorized';
  if (input.role === 'admin') return 'admin';
  if (!input.role) return 'unauthorized';
  return 'forbidden';
}
