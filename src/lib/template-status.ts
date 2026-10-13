/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION). Desde el rediseño
 * (sesión F2) la UI lo lleva a una variante del `Badge` del sistema y a
 * una clave de i18n (`Settings.templates.status.<STATUS>`); el texto ya
 * no vive acá.
 */

import type { MessageTemplateStatus } from '@/types';

export type TemplateStatusVariant =
  | 'secondary'
  | 'warning'
  | 'success'
  | 'danger'
  | 'info'
  | 'selected';

export const templateStatusVariant: Record<MessageTemplateStatus, TemplateStatusVariant> = {
  DRAFT: 'secondary',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  PAUSED: 'warning',
  DISABLED: 'danger',
  IN_APPEAL: 'info',
  PENDING_DELETION: 'secondary',
};
