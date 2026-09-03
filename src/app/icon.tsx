import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — Saysells
// navy rounded square + the WhatsApp glyph — matching the sidebar logo
// in `src/components/layout/sidebar.tsx`. Next.js renders this at build
// time and auto-injects <link rel="icon"> into <head>.
//
// The navy is hard-coded on purpose: this is a build-time PNG, it has
// no access to the CSS custom properties, and a favicon can't follow
// the user's accent anyway. It mirrors the brand navy behind
// `--primary` of the `saysells` theme in globals.css.
//
// The glyph is inline path data (no imports, no external assets):
// ImageResponse runs on the edge runtime and can't fetch anything.
// White bubble with the handset knocked out in navy — the real
// WhatsApp mark, only inverted. The outline version of the same mark
// falls apart at 32x32: its ring lands under a pixel wide and the
// handset turns to mush. Verified by rendering at 32 and looking at it.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const NAVY = "#1C2B48";

// Outer silhouette of the speech bubble, tail included.
const BUBBLE =
  "M20.463 3.488A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z";

// The handset inside it.
const HANDSET =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347Z";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: NAVY,
          borderRadius: 6,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d={BUBBLE} fill="#ffffff" />
          <path d={HANDSET} fill={NAVY} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
