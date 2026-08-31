"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  PERMISSION_KEYS,
  effectivePermission,
  type PermissionKey,
  type PermissionOverrides,
} from "@/lib/auth/permissions";
import type { AccountRole } from "@/lib/auth/roles";

// Panel de las 10 claves para una fila de Miembros. Presentacional a
// propósito: recibe rol + overrides y muestra el valor EFECTIVO de
// cada permiso (lo que la persona realmente puede hacer hoy), no si
// existe o no un override — esa es la decisión de producto: el admin
// tilda "qué puede hacer", no "qué está overrideado". Las etiquetas
// llegan por props (el parent las arma con next-intl) para que el
// componente se pueda testear sin proveedor de i18n.
//
// `data-permission-row` / `data-effective` son ganchos de test
// estables: el test estático (sin DOM interactivo) verifica que cada
// tilde refleja el permiso efectivo.

interface MemberPermissionsPanelProps {
  role: AccountRole;
  overrides: PermissionOverrides | null;
  labels: Record<PermissionKey, string>;
  hint: string;
  /** Clave con un PATCH en vuelo — su checkbox queda deshabilitado. */
  busyKey: PermissionKey | null;
  /** Tocar un tilde. El parent calcula el próximo valor con
   *  `nextOverrideValue` y lo persiste. */
  onToggle: (key: PermissionKey) => void;
}

export function MemberPermissionsPanel({
  role,
  overrides,
  labels,
  hint,
  busyKey,
  onToggle,
}: MemberPermissionsPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {PERMISSION_KEYS.map((key) => {
          const effective = effectivePermission(role, overrides, key);
          return (
            <label
              key={key}
              data-permission-row={key}
              data-effective={effective}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-muted"
            >
              <Checkbox
                checked={effective}
                disabled={busyKey === key}
                onCheckedChange={() => onToggle(key)}
              />
              {labels[key]}
            </label>
          );
        })}
      </div>
    </div>
  );
}
