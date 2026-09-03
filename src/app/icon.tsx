import { ImageResponse } from "next/og";
import {
  WHATSAPP_GLYPH_PATH,
  WHATSAPP_GLYPH_VIEW_BOX,
} from "@/components/brand/whatsapp-glyph";

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
// The glyph comes from `@/components/brand/whatsapp-glyph`, the one
// definition the sidebar and the auth screens also draw from — as raw
// path data, not as the component: ImageResponse renders through
// satori, which has no Tailwind classes and wants explicit width and
// height. It's the real WhatsApp mark, white bubble with the handset
// knocked out so the navy behind shows through. The outline version of
// the same mark falls apart at 32x32 — its ring lands under a pixel
// wide and the handset turns to mush. Verified by rendering at 32 and
// looking at it.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const NAVY = "#1C2B48";

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
        <svg
          width="22"
          height="22"
          viewBox={WHATSAPP_GLYPH_VIEW_BOX}
          fill="#ffffff"
          fillRule="evenodd"
          clipRule="evenodd"
        >
          <path d={WHATSAPP_GLYPH_PATH} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
