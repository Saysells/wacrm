// ============================================================
// Paleta de las etiquetas de contacto.
//
// Vivia adentro de tag-manager.tsx (Configuracion → Campos y
// etiquetas). Se extrajo cuando la Bandeja sumo su propio
// mini-formulario de creacion: los dos lugares donde se crea una
// etiqueta tienen que ofrecer exactamente los mismos colores, asi
// que hay una sola lista y ninguno la copia.
//
// Las claves de i18n de los colores (`Settings.tagsAndFields.colors.*`)
// se derivan de `name`, no lo cambies sin tocar los catalogos.
// ============================================================

export interface PresetColor {
  name: string;
  value: string;
}

export const PRESET_COLORS: readonly PresetColor[] = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'emerald', value: '#10b981' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'violet', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
];

/** El verde, el default historico del formulario de Configuracion. */
export const DEFAULT_TAG_COLOR = PRESET_COLORS[3].value;
