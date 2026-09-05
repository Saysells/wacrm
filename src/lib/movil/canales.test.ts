import { describe, expect, it } from "vitest";

import {
  CHANNEL_LABEL,
  canalInicial,
  canalesVisibles,
  conversationChannel,
  mostrarSelectorDeCanal,
} from "@/lib/movil/canales";
import type { Channel } from "@/types";

const fila = (channel: Channel, enabled: boolean) => ({ channel, enabled });

// El estado real de las dos cuentas hoy, sembrado por la migracion 055.
const HOY = [fila("whatsapp", true), fila("instagram", false)];

describe("canalesVisibles", () => {
  it("un canal sin fila no se muestra", () => {
    expect(canalesVisibles([fila("whatsapp", true)])).toEqual([
      { channel: "whatsapp", enabled: true },
    ]);
  });

  it("ordena siempre igual, sin importar como venga de la base", () => {
    const alReves = [fila("instagram", false), fila("whatsapp", true)];
    expect(canalesVisibles(alReves).map((c) => c.channel)).toEqual([
      "whatsapp",
      "instagram",
    ]);
  });

  it("el apagado se muestra, apagado", () => {
    expect(canalesVisibles(HOY)).toEqual([
      { channel: "whatsapp", enabled: true },
      { channel: "instagram", enabled: false },
    ]);
  });
});

describe("mostrarSelectorDeCanal", () => {
  it("con un solo canal la fila no se dibuja", () => {
    expect(mostrarSelectorDeCanal([fila("whatsapp", true)])).toBe(false);
  });

  it("con dos se dibuja aunque uno este apagado — el caso de hoy", () => {
    expect(mostrarSelectorDeCanal(HOY)).toBe(true);
  });

  it("sin ninguna fila no se dibuja", () => {
    expect(mostrarSelectorDeCanal([])).toBe(false);
  });
});

describe("canalInicial", () => {
  it("arranca en el primer canal prendido", () => {
    expect(canalInicial(HOY)).toBe("whatsapp");
  });

  it("prender Instagram no pide tocar codigo: alcanza con enabled", () => {
    const conInstagram = [fila("whatsapp", false), fila("instagram", true)];
    expect(canalInicial(conInstagram)).toBe("instagram");
    expect(canalesVisibles(conInstagram)[1]).toEqual({
      channel: "instagram",
      enabled: true,
    });
  });

  it("sin ninguno prendido no filtra por canal", () => {
    expect(canalInicial([fila("whatsapp", false)])).toBeNull();
  });
});

describe("conversationChannel", () => {
  it("lee el canal de la fila", () => {
    expect(conversationChannel({ channel: "instagram" })).toBe("instagram");
  });

  it("cae a whatsapp cuando el objeto no lo trae", () => {
    expect(conversationChannel({})).toBe("whatsapp");
  });
});

describe("CHANNEL_LABEL", () => {
  it("nombra los dos canales", () => {
    expect(CHANNEL_LABEL.whatsapp).toBe("WhatsApp");
    expect(CHANNEL_LABEL.instagram).toBe("Instagram");
  });
});
