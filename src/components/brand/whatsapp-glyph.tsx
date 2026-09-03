/**
 * The WhatsApp mark, single source of truth for the whole app.
 *
 * Used by the sidebar logo, the auth screens (login / signup / forgot
 * password) and — through the exported path constant — the favicon in
 * `src/app/icon.tsx`. Before this module the favicon and the sidebar
 * each drew their own generic chat glyph and drifted apart.
 *
 * ONE COLOR, ON PURPOSE. The bubble is painted in `currentColor` and
 * the handset is knocked out of it with `fill-rule: evenodd`, so the
 * handset is a hole that shows whatever sits behind the glyph. That's
 * what lets the same markup work on the sidebar's `bg-primary` square,
 * on the auth screens' `bg-primary/10` tint and on the favicon's flat
 * navy without ever naming a color here — the theme decides, per
 * rule "brand colors live in the theme variables".
 *
 * The paths are the real WhatsApp mark (bubble with the tail plus the
 * handset), not a generic speech bubble. Kept as inline data with no
 * imports and no external assets because `icon.tsx` renders on the
 * edge runtime, where nothing can be fetched.
 */

// Outer silhouette of the speech bubble, tail included.
const BUBBLE =
  "M20.463 3.488A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z";

// The handset inside it.
const HANDSET =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347Z";

/**
 * Bubble and handset in one `d`, so `fill-rule: evenodd` can knock the
 * second out of the first. Exported for `icon.tsx`, which can't use the
 * component below: `ImageResponse` renders through satori, which has no
 * Tailwind classes and needs explicit width/height attributes.
 */
export const WHATSAPP_GLYPH_PATH = `${BUBBLE}${HANDSET}`;

export const WHATSAPP_GLYPH_VIEW_BOX = "0 0 24 24";

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox={WHATSAPP_GLYPH_VIEW_BOX}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      className={className}
      aria-hidden="true"
    >
      <path d={WHATSAPP_GLYPH_PATH} />
    </svg>
  );
}
