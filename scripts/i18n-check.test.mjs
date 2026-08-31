// Pruebas del validador de catálogos i18n. Runner nativo de Node, sin
// dependencias. Correr con: node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { compararCatalogos } from "./i18n-check.mjs";

const referencia = {
  Sidebar: {
    inbox: "Inbox",
    unread: "{count} unread {count, plural, =1 {conversation} other {conversations}}",
  },
  Settings: {
    invite: {
      created: "Join as <bold>{role}</bold>. Valid for <bold>{days} {days, plural, =1 {day} other {days}}</bold>.",
      hint: "Header text (max 60 chars, optional {{1}})",
    },
  },
};

function conCandidato(mutar) {
  const candidato = structuredClone(referencia);
  mutar(candidato);
  return compararCatalogos(referencia, candidato);
}

test("un catálogo idéntico pasa sin diferencias", () => {
  assert.deepEqual(compararCatalogos(referencia, structuredClone(referencia)), []);
});

test("una traducción válida (mismos placeholders, otro texto y orden) pasa", () => {
  const diffs = conCandidato((c) => {
    c.Sidebar.inbox = "Bandeja";
    c.Sidebar.unread = "{count} {count, plural, =1 {conversación} other {conversaciones}} sin leer";
    c.Settings.invite.created =
      "Entrás como <bold>{role}</bold>. Vale por <bold>{days} {days, plural, =1 {día} other {días}}</bold>.";
    c.Settings.invite.hint = "Texto del encabezado (máximo 60 caracteres, {{1}} opcional)";
  });
  assert.deepEqual(diffs, []);
});

test("detecta una clave faltante", () => {
  const diffs = conCandidato((c) => {
    delete c.Sidebar.inbox;
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Sidebar\.inbox: falta/);
});

test("detecta una clave sobrante", () => {
  const diffs = conCandidato((c) => {
    c.Sidebar.extra = "no existe en la referencia";
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Sidebar\.extra: sobra/);
});

test("detecta un placeholder distinto", () => {
  const diffs = conCandidato((c) => {
    c.Settings.invite.created = c.Settings.invite.created.replace("{role}", "{rol}");
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Settings\.invite\.created: placeholders o sintaxis ICU/);
});

test("detecta un plural ICU distinto (rama =1 renombrada)", () => {
  const diffs = conCandidato((c) => {
    c.Sidebar.unread = "{count} unread {count, plural, one {conversation} other {conversations}}";
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Sidebar\.unread: placeholders o sintaxis ICU/);
});

test("detecta una etiqueta HTML distinta", () => {
  const diffs = conCandidato((c) => {
    c.Settings.invite.created = c.Settings.invite.created.replace("<bold>{role}</bold>", "<b>{role}</b>");
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Settings\.invite\.created: etiquetas HTML/);
});

test("detecta un valor vacío", () => {
  const diffs = conCandidato((c) => {
    c.Sidebar.inbox = "   ";
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Sidebar\.inbox: valor vacío/);
});

test("detecta un emoji en el candidato", () => {
  const diffs = conCandidato((c) => {
    c.Sidebar.inbox = "Bandeja ✨";
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Sidebar\.inbox: el candidato contiene un emoji/);
});

test("detecta un mustache {{…}} alterado", () => {
  const diffs = conCandidato((c) => {
    c.Settings.invite.hint = c.Settings.invite.hint.replace("{{1}}", "{{uno}}");
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /^Settings\.invite\.hint: mustaches/);
});

test("detecta estructura anidada rota (string donde había objeto)", () => {
  const diffs = conCandidato((c) => {
    c.Settings.invite = "plano";
  });
  assert.ok(diffs.length >= 1);
  assert.ok(diffs.some((d) => d.startsWith("Settings.invite")));
});
