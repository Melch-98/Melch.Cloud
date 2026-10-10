export type LiveCreativeAccess = 'write' | 'read' | 'none';

/**
 * Mirrors bfcm_goals.
 * Admins read and write every brand.
 * Founders read and write their own brand.
 * Strategists read their own brand.
 */
export function liveCreativeAccess(
  role: string | null | undefined,
  userBrandId: string | null | undefined,
  brandId: string,
): LiveCreativeAccess {
  if (!brandId) return 'none';
  if (role === 'admin') return 'write';
  if (!userBrandId || userBrandId !== brandId) return 'none';
  if (role === 'founder') return 'write';
  if (role === 'strategist') return 'read';
  return 'none';
}
