#!/usr/bin/env node
// Compara dos catálogos de mensajes de next-intl (referencia vs candidato)
// y reporta toda diferencia estructural: claves, placeholders, sintaxis ICU,
// etiquetas HTML, valores vacíos y emojis. Sin dependencias: Node 20+.
//
// Uso: node scripts/i18n-check.mjs messages/en.json messages/es.json
// Sale con código 1 si hay diferencias.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Aplanado del catálogo: { "Seccion.sub.clave": "valor" }
// ---------------------------------------------------------------------------

function aplanar(nodo, ruta = "", salida = {}) {
  if (nodo !== null && typeof nodo === "object" && !Array.isArray(nodo)) {
    for (const [clave, valor] of Object.entries(nodo)) {
      aplanar(valor, ruta ? `${ruta}.${clave}` : clave, salida);
    }
    return salida;
  }
  salida[ruta] = nodo;
  return salida;
}

// ---------------------------------------------------------------------------
// Firma ICU de un valor.
//
// Un mensaje puede mezclar tres cosas dentro de llaves:
//   {nombre}                        placeholder simple
//   {n, plural, =1 {...} other {...}}  argumento complejo (plural/select)
//   {{1}} / {{ vars.x }}            mustache literal de WhatsApp (no es ICU)
//
// Los mustaches se extraen primero y deben ser idénticos byte a byte.
// Del resto se extraen los grupos de llaves balanceados de primer nivel:
//   - si el grupo es un plural/select, la firma es nombre + tipo + ramas
//     (las ramas se comparan por clave y, recursivamente, por su propia
//     firma; el texto literal de cada rama sí se puede traducir)
//   - si no, el grupo entero es un token atómico que debe coincidir.
// ---------------------------------------------------------------------------

const RE_MUSTACHE = /\{\{[^{}]*\}\}/g;

function extraerMustaches(texto) {
  return (texto.match(RE_MUSTACHE) ?? []).sort();
}

function gruposDeLlaves(texto) {
  // Devuelve el contenido de cada grupo {...} balanceado de primer nivel,
  // o null si las llaves no balancean.
  const grupos = [];
  let profundidad = 0;
  let inicio = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "{") {
      if (profundidad === 0) inicio = i + 1;
      profundidad++;
    } else if (c === "}") {
      profundidad--;
      if (profundidad < 0) return null;
      if (profundidad === 0) grupos.push(texto.slice(inicio, i));
    }
  }
  if (profundidad !== 0) return null;
  return grupos;
}

const RE_COMPLEJO = /^\s*([\w.]+)\s*,\s*(plural|selectordinal|select)\s*,([\s\S]*)$/;

function firmaGrupo(contenido) {
  const complejo = contenido.match(RE_COMPLEJO);
  if (!complejo) return `arg:${contenido.trim()}`;

  const [, nombre, tipo, resto] = complejo;
  // Ramas: clave { texto }  — el texto se firma recursivamente.
  const ramas = [];
  let i = 0;
  while (i < resto.length) {
    const abre = resto.indexOf("{", i);
    if (abre === -1) break;
    const clave = resto.slice(i, abre).trim();
    let profundidad = 0;
    let cierra = -1;
    for (let j = abre; j < resto.length; j++) {
      if (resto[j] === "{") profundidad++;
      else if (resto[j] === "}") {
        profundidad--;
        if (profundidad === 0) {
          cierra = j;
          break;
        }
      }
    }
    if (cierra === -1) return `arg:${contenido.trim()}`; // malformado: token atómico
    ramas.push(`${clave}=>[${firmaICU(resto.slice(abre + 1, cierra)).join("|")}]`);
    i = cierra + 1;
  }
  return `${tipo}:${nombre}(${ramas.sort().join(" ")})`;
}

function firmaICU(texto) {
  const sinMustaches = texto.replace(RE_MUSTACHE, "");
  const grupos = gruposDeLlaves(sinMustaches);
  if (grupos === null) return [`llaves-desbalanceadas:${sinMustaches}`];
  return grupos.map(firmaGrupo).sort();
}

// ---------------------------------------------------------------------------
// Etiquetas HTML y emojis
// ---------------------------------------------------------------------------

function etiquetasHTML(texto) {
  return (texto.match(/<\/?[a-zA-Z][^<>]*>/g) ?? []).sort();
}

const RE_EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{2049}\u{203C}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{23FA}\u{24C2}\u{25AA}-\u{25FE}\u{2934}\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}]/u;

// ---------------------------------------------------------------------------
// Comparación
// ---------------------------------------------------------------------------

function iguales(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function compararCatalogos(referencia, candidato) {
  const diferencias = [];
  const ref = aplanar(referencia);
  const cand = aplanar(candidato);

  for (const clave of Object.keys(ref)) {
    if (!(clave in cand)) diferencias.push(`${clave}: falta en el candidato`);
  }
  for (const clave of Object.keys(cand)) {
    if (!(clave in ref)) diferencias.push(`${clave}: sobra en el candidato (no existe en la referencia)`);
  }

  for (const clave of Object.keys(ref)) {
    if (!(clave in cand)) continue;
    const vRef = ref[clave];
    const vCand = cand[clave];

    if (typeof vRef !== typeof vCand) {
      diferencias.push(`${clave}: tipo distinto (referencia ${typeof vRef}, candidato ${typeof vCand})`);
      continue;
    }
    if (typeof vRef !== "string") continue;

    if (vCand.trim() === "") {
      diferencias.push(`${clave}: valor vacío en el candidato`);
      continue;
    }
    // Una copia literal de la referencia (sección todavía sin traducir, o la
    // referencia comparada contra sí misma) es válida aunque traiga emoji:
    // la regla de "sin emojis" aplica a texto nuevo, no al original en inglés.
    if (vCand === vRef) continue;
    if (RE_EMOJI.test(vCand)) {
      diferencias.push(`${clave}: el candidato contiene un emoji (${JSON.stringify(vCand)})`);
    }
    const mustRef = extraerMustaches(vRef);
    const mustCand = extraerMustaches(vCand);
    if (!iguales(mustRef, mustCand)) {
      diferencias.push(
        `${clave}: mustaches {{…}} distintos (referencia [${mustRef.join(", ")}], candidato [${mustCand.join(", ")}])`,
      );
    }
    const icuRef = firmaICU(vRef);
    const icuCand = firmaICU(vCand);
    if (!iguales(icuRef, icuCand)) {
      diferencias.push(
        `${clave}: placeholders o sintaxis ICU distintos (referencia [${icuRef.join(" · ")}], candidato [${icuCand.join(" · ")}])`,
      );
    }
    const htmlRef = etiquetasHTML(vRef);
    const htmlCand = etiquetasHTML(vCand);
    if (!iguales(htmlRef, htmlCand)) {
      diferencias.push(
        `${clave}: etiquetas HTML distintas (referencia [${htmlRef.join(" ")}], candidato [${htmlCand.join(" ")}])`,
      );
    }
  }

  return diferencias;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const esEjecucionDirecta =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEjecucionDirecta) {
  const [rutaRef, rutaCand] = process.argv.slice(2);
  if (!rutaRef || !rutaCand) {
    console.error("Uso: node scripts/i18n-check.mjs <referencia.json> <candidato.json>");
    process.exit(2);
  }

  let referencia, candidato;
  try {
    referencia = JSON.parse(readFileSync(rutaRef, "utf8"));
  } catch (e) {
    console.error(`No pude leer ${rutaRef}: ${e.message}`);
    process.exit(2);
  }
  try {
    candidato = JSON.parse(readFileSync(rutaCand, "utf8"));
  } catch (e) {
    console.error(`No pude leer ${rutaCand}: ${e.message}`);
    process.exit(2);
  }

  const diferencias = compararCatalogos(referencia, candidato);
  if (diferencias.length === 0) {
    console.log(`OK: ${rutaCand} coincide en estructura con ${rutaRef}`);
    process.exit(0);
  }
  for (const d of diferencias) console.error(d);
  console.error(`\n${diferencias.length} diferencia(s) entre ${rutaRef} y ${rutaCand}`);
  process.exit(1);
}
