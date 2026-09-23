import { ROLES } from '../../db/schema';

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'wo.read',
  'wo.create',
  'wo.transition',
  'sr.read',
  'sr.create',
  'sr.transition',
  'assets.read',
  'finding.read',
  'finding.create',
  'finding.dismiss',
  'inventory.read',
  'inventory.mutate',
  'po.read',
  'po.approve',
  'vendors.read',
  'vendors.manage',
  'facilities.read',
  'facilities.manage',
  'reports.read',
  'audit.read',
  'org.read',
  'org.manage',
  'settings.manage',
  'shifts.read',
  'shifts.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: readonly Permission[] = [
  'wo.read',
  'sr.read',
  'assets.read',
  'finding.read',
  'inventory.read',
  'po.read',
  'vendors.read',
  'reports.read',
  'audit.read',
  'org.read',
  'facilities.read',
  'shifts.read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly (Permission | '*')[]> = {
  'Enterprise Admin': ['*'],
  'Facility Director': [
    ...READ_ALL,
    'wo.create',
    'wo.transition',
    'sr.create',
    'sr.transition',
    'finding.create',
    'finding.dismiss',
    'inventory.mutate',
    'po.approve',
    'vendors.manage',
    'org.manage',
    'facilities.manage',
    'shifts.manage',
  ],
  'Engineering Lead': [
    ...READ_ALL,
    'wo.create',
    'wo.transition',
    'sr.create',
    'sr.transition',
    'finding.create',
    'finding.dismiss',
    'inventory.mutate',
    'vendors.manage',
    'facilities.manage',
    'shifts.manage',
  ],
  'Senior Field Tech': ['wo.read', 'wo.transition', 'sr.read', 'sr.create', 'assets.read', 'finding.read', 'finding.create', 'finding.dismiss', 'inventory.read', 'vendors.read'],
  'Vendor Partner Tech': ['wo.read'],
  'Read-Only Auditor': READ_ALL,
};

export function can(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*' as Permission) || (perms as readonly Permission[]).includes(permission);
}
