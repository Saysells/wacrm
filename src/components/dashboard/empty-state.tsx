import { BarChart3 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmptyState as SystemEmptyState } from '@/components/ui/empty-state'

/**
 * Vacío de los gráficos del Panel. Desde el rediseño (sesión F2) es el
 * `EmptyState` del sistema (cuadro celeste de 56 px, título y texto, sin
 * recuadro punteado) en su versión compacta; el título por defecto sigue
 * saliendo de `Dashboard.emptyState`.
 */
export function EmptyState({
  title,
  hint,
  icon: Icon = BarChart3,
  className,
}: {
  title?: string
  hint?: string
  icon?: LucideIcon
  className?: string
}) {
  const t = useTranslations('Dashboard.emptyState')
  return (
    <SystemEmptyState
      compact
      icon={Icon}
      title={title || t('title')}
      description={hint}
      className={className}
    />
  )
}
