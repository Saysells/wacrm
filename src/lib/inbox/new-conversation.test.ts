import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageTemplate } from "@/types";
import {
  canSendNewMessage,
  isSendablePhone,
  lookupConversation,
  nextStepAfterLookup,
  startConversation,
} from "./new-conversation";

const TEMPLATE = {
  id: "tpl-1",
  name: "hello_world",
  language: "es_AR",
  body_text: "Hola {{1}}, te escribimos de {{2}}.",
} as MessageTemplate;

describe("isSendablePhone", () => {
  it("acepta E.164 con o sin separadores", () => {
    expect(isSendablePhone("+14155550123")).toBe(true);
    expect(isSendablePhone("+1 (415) 555-0123")).toBe(true);
  });

  it("rechaza vacio, texto y numeros demasiado cortos", () => {
    expect(isSendablePhone("")).toBe(false);
    expect(isSendablePhone("no-es-un-numero")).toBe(false);
    expect(isSendablePhone("+123")).toBe(false);
  });
});

describe("canSendNewMessage", () => {
  it("sin plantilla elegida no se puede enviar", () => {
    expect(
      canSendNewMessage({ phone: "+14155550123", template: null }),
    ).toBe(false);
  });

  it("con telefono valido y plantilla elegida si", () => {
    expect(
      canSendNewMessage({ phone: "+14155550123", template: TEMPLATE }),
    ).toBe(true);
  });

  it("una plantilla elegida no salva un telefono invalido", () => {
    expect(canSendNewMessage({ phone: "123", template: TEMPLATE })).toBe(false);
  });
});

describe("nextStepAfterLookup", () => {
  it("un telefono con conversacion existente se abre, no ofrece plantillas", () => {
    expect(
      nextStepAfterLookup({
        phone: "14155550123",
        contact_id: "c1",
        conversation_id: "conv-1",
        contact_created: false,
      }),
    ).toEqual({ action: "open", conversationId: "conv-1" });
  });

  it("un contacto sin hilo todavia pasa por plantilla", () => {
    expect(
      nextStepAfterLookup({
        phone: "14155550123",
        contact_id: "c1",
        conversation_id: null,
        contact_created: false,
      }),
    ).toEqual({ action: "template" });
  });

  it("un telefono desconocido pasa por plantilla", () => {
    expect(
      nextStepAfterLookup({
        phone: "14155550123",
        contact_id: null,
        conversation_id: null,
        contact_created: false,
      }),
    ).toEqual({ action: "template" });
  });
});

describe("lookupConversation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("consulta la ruta del dashboard sin pedir creacion", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        phone: "14155550123",
        contact_id: null,
        conversation_id: null,
        contact_created: false,
      }),
    });

    await lookupConversation("+14155550123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/inbox/conversations/resolve");
    expect(JSON.parse(init.body as string)).toEqual({
      phone: "+14155550123",
    });
  });

  it("propaga el error del servidor", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "phone is required" }),
    });

    await expect(lookupConversation("+14155550123")).rejects.toThrow(
      "phone is required",
    );
  });
});

describe("startConversation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
  }

  it("resuelve una sola vez y manda la plantilla a ese mismo hilo", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          phone: "+14155550123",
          contact_id: "c9",
          conversation_id: "conv-9",
          contact_created: true,
        }),
      )
      .mockResolvedValueOnce(okJson({ success: true, message_id: "m1" }));

    const result = await startConversation({
      phone: "+14155550123",
      name: "Jane",
      template: TEMPLATE,
      values: { body: ["Jane", "Saysells"] },
    });

    expect(result).toEqual({ conversationId: "conv-9", contactCreated: true });

    // Un solo resolve => un solo contacto y un solo hilo: el dedupe
    // vive en resolveConversationByPhone y no se lo llama dos veces.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [resolveUrl, resolveInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(resolveUrl).toBe("/api/inbox/conversations/resolve");
    expect(JSON.parse(resolveInit.body as string)).toEqual({
      phone: "+14155550123",
      name: "Jane",
      create: true,
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(sendUrl).toBe("/api/whatsapp/send");
    expect(JSON.parse(sendInit.body as string)).toEqual({
      conversation_id: "conv-9",
      message_type: "template",
      template_name: "hello_world",
      template_language: "es_AR",
      template_message_params: {
        body: ["Jane", "Saysells"],
        headerText: undefined,
        buttonParams: undefined,
      },
      template_params: ["Jane", "Saysells"],
      content_text: "Hola Jane, te escribimos de Saysells.",
    });
  });

  it("si el resolve falla no manda nada", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "WhatsApp not configured." }),
    });

    await expect(
      startConversation({
        phone: "+14155550123",
        template: TEMPLATE,
        values: { body: ["a", "b"] },
      }),
    ).rejects.toThrow("WhatsApp not configured.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propaga el error del envio con el hilo ya creado", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          phone: "+14155550123",
          contact_id: "c9",
          conversation_id: "conv-9",
          contact_created: true,
        }),
      )
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Template not approved" }),
      });

    await expect(
      startConversation({
        phone: "+14155550123",
        template: TEMPLATE,
        values: { body: ["a", "b"] },
      }),
    ).rejects.toThrow("Template not approved");
  });
});
