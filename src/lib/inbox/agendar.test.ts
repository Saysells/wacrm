import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Tag } from "@/types";
import type { InboxConversation } from "./inbox-conversation";
import {
  SLOTS,
  applySchedule,
  busySlots,
  callsNextWeek,
  chosenTime,
  closersOf,
  daysWithCalls,
  defaultScheduleTag,
  initialScheduleDraft,
  isPastDay,
  isPastSlot,
  monthGrid,
  needsReattach,
  canSaveDraft,
  requestFromAction,
  requestFromEstado,
  resolveScheduleTag,
  scheduleModeFor,
  schedulingTags,
  shiftMonth,
  slotTime,
  toggleDay,
} from "./agendar";

let seq = 0;
function tag(name: string, extra: Partial<Tag> = {}): Tag {
  return {
    id: `t${++seq}`,
    user_id: "u",
    name,
    color: "#000",
    grupo: "estado",
    requiere_fecha: false,
    created_at: "2026-01-01",
    ...extra,
  };
}

const NUEVO = tag("Nuevo");
const GESTION = tag("En gestión");
const AG_MANUEL = tag("Agendado a Manuel", { requiere_fecha: true });
const AG_EZE = tag("Agendado a Ezequiel", { requiere_fecha: true });
const AGENDADA = tag("Agendada", { requiere_fecha: true });
const REAGENDADO = tag("Reagendado", { requiere_fecha: true });
const VIP = tag("VIP", { grupo: null });
// Catálogo desordenado a propósito (la base lo trae por nombre).
const SAYSELLS = [VIP, REAGENDADO, NUEVO, AG_EZE, AGENDADA, AG_MANUEL, GESTION];
const SIN_CLOSERS = [VIP, REAGENDADO, NUEVO, AGENDADA, GESTION];
const STAR_ENERGY = [VIP, NUEVO, GESTION];

// Lunes 12 de octubre de 2026, 16:30 local.
const NOW = new Date(2026, 9, 12, 16, 30).getTime();

function conv(
  id: string,
  tags: Tag[],
  fecha: string | null,
  extra: Partial<InboxConversation> = {},
): InboxConversation {
  return {
    id,
    user_id: "u",
    contact_id: `c-${id}`,
    status: "open",
    unread_count: 0,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    last_sender_type: null,
    last_customer_message_at: null,
    contact: {
      id: `c-${id}`,
      user_id: "u",
      account_id: "a",
      phone: "5491100000000",
      created_at: "2026-10-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
      fecha_llamada: fecha,
      tags,
    },
    ...extra,
  };
}

function localIso(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m, d, h, min).toISOString();
}

describe("closers y etiquetas con fecha", () => {
  it("los closers son las 'Agendado a <nombre>' con fecha, en orden de embudo", () => {
    expect(closersOf(SAYSELLS).map((c) => c.name)).toEqual(["Ezequiel", "Manuel"]);
    // Los closers conocidos del embudo conservan su orden; el resto, alfabético.
    const kosmo = [tag("Agendado a Gustavo", { requiere_fecha: true }), tag("Agendado a Paola", { requiere_fecha: true })];
    expect(closersOf(kosmo).map((c) => c.name)).toEqual(["Paola", "Gustavo"]);
    expect(closersOf(SIN_CLOSERS)).toEqual([]);
  });

  it("schedulingTags trae todas las de estado con fecha, en orden de embudo (los closers de ARG antes de Agendada desde el 16/10/2026); sin ninguna no se agenda", () => {
    expect(schedulingTags(SAYSELLS).map((t) => t.name)).toEqual([
      "Agendado a Ezequiel",
      "Agendado a Manuel",
      "Agendada",
      "Reagendado",
    ]);
    expect(schedulingTags(STAR_ENERGY)).toEqual([]);
    expect(defaultScheduleTag(STAR_ENERGY)).toBeNull();
  });

  it("sin closers, la etiqueta por defecto es la con fecha que no es Reagendado", () => {
    expect(defaultScheduleTag(SIN_CLOSERS)?.name).toBe("Agendada");
  });
});

describe("resolveScheduleTag", () => {
  const base = { accountTags: SAYSELLS, currentEstado: null, currentCloser: null, fixedTag: null };

  it("regla 1: agendar aplica 'Agendado a <closer elegido>'", () => {
    expect(resolveScheduleTag({ ...base, mode: "new", chosenCloser: "Ezequiel" })?.id).toBe(AG_EZE.id);
  });

  it("regla 1: sin closers en la cuenta aplica la con fecha que no es Reagendado", () => {
    expect(
      resolveScheduleTag({ ...base, accountTags: SIN_CLOSERS, mode: "new", chosenCloser: null })?.id,
    ).toBe(AGENDADA.id);
  });

  it("regla 2: reagendar con el mismo closer aplica Reagendado", () => {
    expect(
      resolveScheduleTag({
        ...base,
        mode: "re",
        currentEstado: AG_MANUEL,
        currentCloser: "Manuel",
        chosenCloser: "Manuel",
      })?.id,
    ).toBe(REAGENDADO.id);
  });

  it("regla 2: reagendar con otro closer aplica 'Agendado a <nuevo>'", () => {
    expect(
      resolveScheduleTag({
        ...base,
        mode: "re",
        currentEstado: AG_MANUEL,
        currentCloser: "Manuel",
        chosenCloser: "Ezequiel",
      })?.id,
    ).toBe(AG_EZE.id);
  });

  it("regla 2: sin 'Reagendado' en la cuenta, la que corresponde es la actual", () => {
    const sinRe = SAYSELLS.filter((t) => t.id !== REAGENDADO.id);
    expect(
      resolveScheduleTag({
        ...base,
        accountTags: sinRe,
        mode: "re",
        currentEstado: AG_MANUEL,
        currentCloser: "Manuel",
        chosenCloser: "Manuel",
      })?.id,
    ).toBe(AG_MANUEL.id);
  });

  it("regla 4 (Agendada sin closer): reagendar sin elegir closer aplica Reagendado; eligiendo uno, la de ese closer", () => {
    expect(
      resolveScheduleTag({ ...base, mode: "re", currentEstado: AGENDADA, currentCloser: null, chosenCloser: null })?.id,
    ).toBe(REAGENDADO.id);
    expect(
      resolveScheduleTag({ ...base, mode: "re", currentEstado: AGENDADA, currentCloser: null, chosenCloser: "Manuel" })?.id,
    ).toBe(AG_MANUEL.id);
  });

  it("regla 3: una etiqueta fija (Agendada / Reagendado desde Estado) se aplica tal cual", () => {
    expect(
      resolveScheduleTag({ ...base, mode: "new", chosenCloser: "Manuel", fixedTag: AGENDADA })?.id,
    ).toBe(AGENDADA.id);
  });

  it("sin ninguna etiqueta con fecha devuelve null", () => {
    expect(resolveScheduleTag({ ...base, accountTags: STAR_ENERGY, mode: "new", chosenCloser: null })).toBeNull();
  });
});

describe("requestFromAction / requestFromEstado", () => {
  const call = { closer: "Manuel", at: NOW + 24 * 3600 * 1000 };

  it("Agendar sin llamada vigente; Cambiar con ella marca el closer actual", () => {
    expect(requestFromAction(null)).toEqual({ mode: "new", presetCloser: null, fixedTag: null });
    expect(requestFromAction(call)).toEqual({ mode: "re", presetCloser: "Manuel", fixedTag: null });
  });

  it("elegir el estado actual con fecha abre Reagendar", () => {
    expect(requestFromEstado(AG_MANUEL, AG_MANUEL, call)).toEqual({
      mode: "re",
      presetCloser: "Manuel",
      fixedTag: null,
    });
  });

  it("elegir 'Agendado a X' abre Agendar con X marcado", () => {
    expect(requestFromEstado(AG_EZE, AG_MANUEL, call)).toEqual({
      mode: "new",
      presetCloser: "Ezequiel",
      fixedTag: null,
    });
    expect(requestFromEstado(AG_EZE, NUEVO, null).presetCloser).toBe("Ezequiel");
  });

  it("elegir Agendada o Reagendado fija esa etiqueta, sin lista de closers", () => {
    expect(requestFromEstado(AGENDADA, NUEVO, null)).toEqual({
      mode: "new",
      presetCloser: null,
      fixedTag: AGENDADA,
    });
    expect(requestFromEstado(REAGENDADO, AG_MANUEL, call)).toEqual({
      mode: "re",
      presetCloser: "Manuel",
      fixedTag: REAGENDADO,
    });
  });
});

describe("needsReattach", () => {
  it("solo si el contacto ya tiene esa etiqueta", () => {
    expect(needsReattach([AG_MANUEL, VIP], AG_MANUEL)).toBe(true);
    expect(needsReattach([AGENDADA, VIP], AG_MANUEL)).toBe(false);
  });
});

describe("ocupados y puntos del calendario", () => {
  // Jueves 15 de octubre de 2026.
  const day15 = new Date(2026, 9, 15).getTime();
  const convs = [
    conv("a", [AG_MANUEL], localIso(2026, 9, 15, 17, 30)),
    conv("b", [AG_MANUEL], localIso(2026, 9, 15, 10, 0)),
    conv("c", [AG_EZE], localIso(2026, 9, 15, 17, 30)), // otro closer
    conv("d", [AG_MANUEL], localIso(2026, 9, 16, 17, 30)), // otro día
    conv("e", [AG_MANUEL], localIso(2026, 9, 15, 11, 0), { status: "closed" }), // cerrada
    conv("f", [AGENDADA], localIso(2026, 9, 15, 12, 0)), // sin closer
    conv("g", [NUEVO], localIso(2026, 9, 15, 14, 0)), // sin estado con fecha
    conv("h", [AG_MANUEL], null), // agendada sin fecha: no ocupa nada
  ];

  it("ocupado = mismo closer, mismo día, misma hora y minuto; la propia conversación no cuenta", () => {
    expect([...busySlots(convs, "Manuel", day15, null)].sort()).toEqual(["10:00", "17:30"]);
    expect([...busySlots(convs, "Manuel", day15, "a")]).toEqual(["10:00"]);
    expect([...busySlots(convs, "manuel", day15, null)].sort()).toEqual(["10:00", "17:30"]);
  });

  it("sin closer (Agendada / Reagendado) cuentan solo las que no nombran a nadie", () => {
    expect([...busySlots(convs, null, day15, null)]).toEqual(["12:00"]);
  });

  it("una llamada sin fecha no ocupa horarios, ni marca días, ni cuenta en la semana", () => {
    const only = [conv("h", [AG_MANUEL], null)];
    expect(busySlots(only, "Manuel", day15, null).size).toBe(0);
    expect(daysWithCalls(only, "Manuel", 2026, 9, null).size).toBe(0);
    expect(callsNextWeek(only, "Manuel", NOW)).toBe(0);
  });

  it("los puntos marcan los días del mes con llamadas del closer", () => {
    expect([...daysWithCalls(convs, "Manuel", 2026, 9, null)].sort()).toEqual([15, 16]);
    expect([...daysWithCalls(convs, "Manuel", 2026, 9, "d")]).toEqual([15]);
    expect(daysWithCalls(convs, "Manuel", 2026, 10, null).size).toBe(0);
  });

  it("cuenta las llamadas de los próximos 7 días desde el inicio de hoy", () => {
    const soon = [
      conv("x", [AG_MANUEL], localIso(2026, 9, 12, 9, 0)), // hoy, ya pasó: cuenta igual (es de hoy)
      conv("y", [AG_MANUEL], localIso(2026, 9, 18, 9, 0)), // día 6
      conv("z", [AG_MANUEL], localIso(2026, 9, 19, 9, 0)), // día 7: afuera
      conv("w", [AG_EZE], localIso(2026, 9, 13, 9, 0)),
    ];
    expect(callsNextWeek(soon, "Manuel", NOW)).toBe(2);
    expect(callsNextWeek(soon, "Ezequiel", NOW)).toBe(1);
  });
});

describe("calendario", () => {
  it("octubre de 2026 arranca jueves: tres celdas vacías antes del 1 y 31 días", () => {
    expect(monthGrid(2026, 9)).toEqual({ offset: 3, days: 31 });
    // Febrero de 2027 arranca lunes.
    expect(monthGrid(2027, 1)).toEqual({ offset: 0, days: 28 });
  });

  it("sin llamada vigente abre en el mes de pasado mañana, sin día ni horario", () => {
    expect(initialScheduleDraft(null, new Date(2026, 9, 30, 12, 0).getTime())).toEqual({
      year: 2026,
      month: 10,
      day: null,
      slot: null,
    });
  });

  it("una llamada sin fecha abre como Agendar: sin día ni horario, en el mes de pasado mañana", () => {
    const draft = initialScheduleDraft({ closer: "Manuel", at: null }, NOW);
    expect(draft).toEqual({ year: 2026, month: 9, day: null, slot: null });
    expect(scheduleModeFor({ closer: "Manuel", at: null })).toBe("new");
    expect(scheduleModeFor({ closer: "Manuel", at: NOW })).toBe("re");
    expect(scheduleModeFor(null)).toBe("new");
  });

  it("ponerle fecha a una llamada sin fecha es agendar, no reagendar: no pasa a Reagendado", () => {
    const req = requestFromAction({ closer: "Manuel", at: null });
    expect(req).toEqual({ mode: "new", presetCloser: "Manuel", fixedTag: null });
    const tag = resolveScheduleTag({
      mode: req.mode,
      accountTags: SAYSELLS,
      currentEstado: AG_MANUEL,
      currentCloser: "Manuel",
      chosenCloser: "Manuel",
      fixedTag: null,
    });
    expect(tag?.id).toBe(AG_MANUEL.id);
    // Y desde Estado, elegir la etiqueta actual sin fecha también abre Agendar.
    expect(requestFromEstado(AG_MANUEL, AG_MANUEL, { closer: "Manuel", at: null }).mode).toBe("new");
  });

  it("toggleDay destilda el día ya elegido (para agendar sin fecha) y canSaveDraft decide el botón", () => {
    const day = new Date(2026, 9, 15).getTime();
    const empty = { year: 2026, month: 9, day: null, slot: null };
    const withDay = toggleDay(empty, day);
    expect(withDay).toEqual({ ...empty, day, slot: null });
    expect(toggleDay({ ...withDay, slot: "10:00" }, day)).toEqual(empty);
    expect(toggleDay(withDay, day + 24 * 60 * 60 * 1000).day).toBe(day + 24 * 60 * 60 * 1000);
    // Agendar: sin fecha sí; día sin horario no; día y horario sí.
    expect(canSaveDraft(empty, "new")).toBe(true);
    expect(canSaveDraft(withDay, "new")).toBe(false);
    expect(canSaveDraft({ ...withDay, slot: "10:00" }, "new")).toBe(true);
    // Reagendar: siempre con día y horario.
    expect(canSaveDraft(empty, "re")).toBe(false);
    expect(canSaveDraft(withDay, "re")).toBe(false);
    expect(canSaveDraft({ ...withDay, slot: "10:00" }, "re")).toBe(true);
  });

  it("con llamada vigente abre con su día y horario marcados", () => {
    const at = new Date(2026, 9, 15, 17, 30).getTime();
    expect(initialScheduleDraft({ closer: "Manuel", at }, NOW)).toEqual({
      year: 2026,
      month: 9,
      day: new Date(2026, 9, 15).getTime(),
      slot: "17:30",
    });
  });

  it("cambiar de mes pasa de año", () => {
    const d = { year: 2026, month: 11, day: null, slot: null };
    expect(shiftMonth(d, 1)).toMatchObject({ year: 2027, month: 0 });
    expect(shiftMonth({ ...d, month: 0 }, -1)).toMatchObject({ year: 2025, month: 11 });
  });

  it("días y horarios pasados no se eligen", () => {
    const today = new Date(2026, 9, 12).getTime();
    expect(isPastDay(today, NOW)).toBe(false);
    expect(isPastDay(new Date(2026, 9, 11).getTime(), NOW)).toBe(true);
    expect(isPastSlot(today, "16:00", NOW)).toBe(true);
    expect(isPastSlot(today, "17:00", NOW)).toBe(false);
  });

  it("los horarios son los del prototipo y slotTime los ubica en el día", () => {
    expect(SLOTS[0]).toBe("09:00");
    expect(SLOTS[7]).toBe("12:30");
    expect(SLOTS[8]).toBe("14:00");
    expect(SLOTS.at(-1)).toBe("18:30");
    expect(SLOTS).toHaveLength(18);
    const day = new Date(2026, 9, 15).getTime();
    expect(new Date(slotTime(day, "17:30")).getHours()).toBe(17);
    expect(chosenTime({ year: 2026, month: 9, day, slot: "17:30" })).toBe(slotTime(day, "17:30"));
    expect(chosenTime({ year: 2026, month: 9, day, slot: null })).toBeNull();
  });
});

describe("applySchedule (orden fecha → etiqueta)", () => {
  const calls: string[] = [];

  function makeDb() {
    return {
      from: (table: string) => ({
        update: () => ({
          eq: () => {
            calls.push(`update:${table}`);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"}:${(init?.body as string) ?? ""}`);
        return new Response(JSON.stringify({ added: true }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda la fecha y recién después aplica la etiqueta", async () => {
    const result = await applySchedule({
      db: makeDb(),
      contactId: "c1",
      tag: AG_MANUEL,
      fecha: new Date(2026, 9, 15, 17, 30),
      attached: [NUEVO, VIP],
    });
    expect(calls).toEqual(["update:contacts", `POST:${JSON.stringify({ tag_id: AG_MANUEL.id })}`]);
    expect(result.attached.map((t) => t.id)).toEqual([VIP.id, AG_MANUEL.id]);
    expect(result.fechaLlamada).toBe(new Date(2026, 9, 15, 17, 30).toISOString());
  });

  it("si el contacto ya tiene la etiqueta, la saca y la vuelve a poner después de la fecha", async () => {
    const result = await applySchedule({
      db: makeDb(),
      contactId: "c1",
      tag: AG_MANUEL,
      fecha: new Date(2026, 9, 16, 10, 0),
      attached: [AG_MANUEL, VIP],
    });
    expect(calls).toEqual([
      "update:contacts",
      `DELETE:${JSON.stringify({ tag_id: AG_MANUEL.id })}`,
      `POST:${JSON.stringify({ tag_id: AG_MANUEL.id })}`,
    ]);
    expect(result.attached.map((t) => t.id)).toEqual([VIP.id, AG_MANUEL.id]);
  });

  it("sin fecha aplica solo la etiqueta: no toca contacts.fecha_llamada ni la reaplica", async () => {
    const result = await applySchedule({
      db: makeDb(),
      contactId: "c1",
      tag: AG_MANUEL,
      fecha: null,
      attached: [AG_MANUEL, VIP],
    });
    expect(calls).toEqual([`POST:${JSON.stringify({ tag_id: AG_MANUEL.id })}`]);
    expect(result.fechaLlamada).toBeNull();
    // Ya la tenía: queda donde estaba (no se saca ni se vuelve a poner).
    expect(result.attached.map((t) => t.id)).toEqual([AG_MANUEL.id, VIP.id]);
  });

  it("si guardar la fecha falla, no toca ninguna etiqueta", async () => {
    const db = {
      from: () => ({
        update: () => ({ eq: () => Promise.resolve({ error: { message: "rls" } }) }),
      }),
    } as unknown as SupabaseClient;
    await expect(
      applySchedule({ db, contactId: "c1", tag: AG_MANUEL, fecha: new Date(), attached: [AG_MANUEL] }),
    ).rejects.toThrow("rls");
    expect(calls).toEqual([]);
  });
});
