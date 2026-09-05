// ============================================================
// Los iconos de la app movil. SVG inline, cero emojis (regla dura 3).
//
// Los trazos salen tal cual de docs/maquetas/bandeja-app.html: el
// contorno lo pinta `currentColor` y el grosor lo fijan las clases de
// movil.css (.m-tab svg, .m-ibtn svg, .m-fbtn svg…), asi que aca no va
// ni un color ni un tamaño.
//
// No se reusan los de lucide que usa el escritorio a proposito: la
// maqueta define su propio juego y mezclarlos se nota en el grosor.
// ============================================================

export function IconInbox() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.3A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export function IconContacts() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

export function IconFlows() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M10 6.5h4v4M14 17.5h-4v-4" />
    </svg>
  );
}

export function IconPanel() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function IconBack() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconTag() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12l-8 8-9-9V4h7l10 8z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  );
}

export function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/** El boton que abre el sheet de cuenta, en el encabezado de la Bandeja. */
export function IconAccount() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h12M4 7h.01M8 12h12M4 12h.01M8 17h12M4 17h.01" />
    </svg>
  );
}

export function IconSend() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export function IconMic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
    </svg>
  );
}

export function IconAttach() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.6l8.49-8.48" />
    </svg>
  );
}

export function IconQuick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function IconDoubleCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 13l4 4L13 7M9 15l1.5 1.5L21 6" />
    </svg>
  );
}

/** Reloj: el mensaje todavia no llego a Meta (status 'sending'). */
export function IconClock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** El bocadillo de WhatsApp, el mismo glifo de marca del favicon. */
export function IconWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.45L3.5 20.5l1.6-4.75A8.5 8.5 0 1 1 21 11.5z" />
      <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5" />
    </svg>
  );
}

export function IconInstagram() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}
