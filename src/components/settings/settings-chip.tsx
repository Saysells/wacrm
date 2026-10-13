import type { ReactNode } from 'react';

import { Badge, type badgeVariants } from '@/components/ui/badge';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Chip de estado / rol de Configuración. Desde el rediseño (sesión F2)
 * es el `Badge` del sistema (rectángulo de 5 px, nunca pastilla) con
 * los tonos semánticos: propietario en ámbar (`warning`), administrador
 * en celeste (`selected`), ok en verde (`success`), atención en ámbar y
 * el resto neutro.
 */
export type ChipVariant = 'owner' | 'admin' | 'ok' | 'warn' | 'muted';

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

const VARIANTS: Record<ChipVariant, BadgeVariant> = {
  owner: 'warning',
  admin: 'selected',
  ok: 'success',
  warn: 'warning',
  muted: 'secondary',
};

export function SettingsChip({
  variant = 'muted',
  className,
  children,
}: {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant={VARIANTS[variant]} className={cn('[&_svg]:size-3.5', className)}>
      {children}
    </Badge>
  );
}

/** Punto de estado en vivo (por ejemplo, WhatsApp conectado). */
export function StatusDot({
  tone = 'ok',
  className,
}: {
  tone?: 'ok' | 'muted';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-success' : 'bg-muted-foreground',
        className,
      )}
    />
  );
}
