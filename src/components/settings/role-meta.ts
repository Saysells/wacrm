import {
  Crown,
  Shield,
  UserCog,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). `variant` drives the token-based <SettingsChip>, que desde el
 * rediseño es el `Badge` del sistema (sesión F2).
 */
export const ROLE_META: Record<AccountRole, { icon: LucideIcon; variant: ChipVariant }> = {
  owner: { icon: Crown, variant: 'owner' },
  admin: { icon: Shield, variant: 'admin' },
  agent: { icon: UserCog, variant: 'muted' },
  viewer: { icon: UserIcon, variant: 'muted' },
};
