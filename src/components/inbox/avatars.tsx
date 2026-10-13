"use client";

import { User } from "lucide-react";

import { avatarColors, initialsOf } from "@/lib/inbox/vistas";
import { cn } from "@/lib/utils";

// ============================================================
// Avatares del prototipo (`av(name, s)`, `mini(name)` y `FREE`),
// compartidos por Contactos y Notificaciones (sesión F1): iniciales
// sobre el color por hash del nombre, el mini de 22 px para el setter,
// y el círculo punteado de "Sin tomar".
// ============================================================

interface AvatarProps {
  name: string;
  /** Lado en px (prototipo: 42 en la lista, 28 en Contactos, 22 el mini). */
  size: number;
  className?: string;
}

/** `av(name, size)`: círculo con iniciales; la fuente escala con el lado. */
export function NameAvatar({ name, size, className }: AvatarProps) {
  const safe = name.trim() || "?";
  const [bg, ink] = avatarColors(safe);
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", className)}
      style={{ width: size, height: size, background: bg, color: ink, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(safe)}
    </span>
  );
}

/** `mini(name)`: 22 px, para el setter de una fila. */
export function MiniAvatar({ name, className }: { name: string; className?: string }) {
  return <NameAvatar name={name} size={22} className={cn("text-[8px]", className)} />;
}

/** `FREE`: círculo punteado de 22 px con la silueta, "Sin tomar". */
export function UnassignedMark({ label, className }: { label: string; className?: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-[#9AA6B8] text-[#7A8699]",
        className,
      )}
    >
      <User className="size-3" />
    </span>
  );
}
