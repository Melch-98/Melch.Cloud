/**
 * Shared default user_permissions for a role.
 * Used by Team invite (/api/admin/create-user) and onboard create_users.
 */
export type AppRole = 'admin' | 'strategist' | 'founder';

export function rolePermissionDefaults(role: string): {
  can_upload: boolean;
  can_view_pipeline: boolean;
  can_download: boolean;
  can_delete: boolean;
  is_active: boolean;
} {
  switch (role) {
    case 'admin':
      return {
        can_upload: true,
        can_view_pipeline: true,
        can_download: true,
        can_delete: true,
        is_active: true,
      };
    case 'founder':
      return {
        can_upload: true,
        can_view_pipeline: true,
        can_download: true,
        can_delete: false,
        is_active: true,
      };
    case 'strategist':
    default:
      return {
        can_upload: true,
        can_view_pipeline: true,
        can_download: false,
        can_delete: false,
        is_active: true,
      };
  }
}
