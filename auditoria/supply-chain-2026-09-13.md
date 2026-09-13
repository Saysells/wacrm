# Auditoría de cadena de suministro — 2026-09-13

Plugin `supply-chain-risk-auditor@trailofbits` v2.0.2. Alcance: `package.json` y
`package-lock.json`. 33 dependencias directas, más un barrido de advisories sobre los 747
paquetes que el lockfile resuelve. Solo lectura: no se modificó ninguna dependencia.

Commit auditado: `8c3f7b9`. `gh` autenticado, así que los criterios de repositorio
quedaron asequibles.

## Propio vs upstream

**0 propio, 33 upstream.** `package.json` y `package-lock.json` no figuran entre los 175
archivos tocados post-fork: la superficie de dependencias es enteramente decisión de
`ArnasDon/wacrm`. El bloque `overrides` de 10 entradas también es suyo (`78ee4ce`,
"fix(deps): raise nanoid and js-yaml security floors").

Esto cambia quién puede arreglar qué: todo lo de abajo se corrige subiendo una versión en
este fork, o esperando a que upstream lo suba. Nada requiere escribir código.

## Lo que hay que mirar primero

### `next` 16.2.12 — dos CRITICAL de RCE no autenticada

| Advisory | Qué es | Fijado en |
| --- | --- | --- |
| `GHSA-2xp9-vwfh-vxw4` | RCE no autenticada en la Image Optimization API vía archivos AVIF | 16.3.3 |
| `GHSA-p293-qw3h-jr36` | RCE no autenticada en servidores hosteados en Windows | 16.3.3 |

**El segundo no aplica**: el deploy corre en Vercel, sobre Linux.

El primero merece cuidado. La aplicación no usa el componente `next/image` en ningún
lado — la única mención en `src/` es el matcher de `middleware.ts:127`, que excluye
`_next/image` — y `next.config.ts` no declara bloque `images` (sin `remotePatterns`, sin
`domains`, sin `formats`). Eso reduce la superficie, pero **no la elimina**: el endpoint
`/_next/image` lo sirve el framework exista o no un `<Image>` en el código. Determinar si
es alcanzable en esta configuración exige un análisis que esta auditoría no hizo.

**Recomendación: subir hoy.** El destino mínimo es **16.3.3**; `latest` es **16.3.5**.
Es un salto de minor dentro de 16.x, no un major: el coste es bajo y no justifica gastar
horas decidiendo si el endpoint es alcanzable. `eslint-config-next` está pineado a
16.2.12 y conviene moverlo en el mismo paso.

### `vitest` 4.1.10 — una MEDIUM

`GHSA-82fw-gwwq-j7x9`, path traversal / lectura arbitraria de archivos vía el mock de
redirect de `@vitest/mocker`. Fijado en **4.1.11** — un parche. Es build-time: compromete
hosts de CI, no el artefacto servido.

## Advisories transitivos

10 de los 747 paquetes verificados contra el registro cargan advisories en la versión
que el lockfile fija. Siete alcanzan producción:

| Paquete | Versión | Alcance | Advisories |
| --- | --- | --- | --- |
| `fast-uri` | 3.1.5 | producción | 4 |
| `hono` | 4.13.0 | producción | 3 |
| `qs` | 6.15.2 | producción | 2 |
| `browserslist` | 4.28.2 | producción | 2 |
| `js-yaml` | 4.3.1 | producción | 1 |
| `sharp` | 0.35.3 | producción | 1 |
| `postcss-selector-parser` | 7.1.1 | producción | 1 |
| `baseline-browser-mapping` | 2.10.19 | producción | 1 |
| `@humanfs/node` | 0.16.7 | build | 1 |
| `@vitest/mocker` | 4.1.10 | build | 1 |

**Hay que decir algo incómodo sobre esta tabla.** Cuatro de esos paquetes —`fast-uri`,
`hono`, `js-yaml`, `sharp`— están **explícitamente pineados en el bloque `overrides` de
upstream**, con las mismas versiones que aquí aparecen marcadas. Los overrides se
agregaron para levantar pisos de seguridad y las versiones que fijan siguen teniendo
advisories. O el piso quedó viejo, o se eligió la versión equivocada. Es lo primero que
conviene consultarle a upstream.

## Scripts de instalación

**Cero.** El criterio "Install-time script execution" evaluó 33 de 33 dependencias y no
marcó ninguna. Ninguna dependencia directa ejecuta código en `npm install`, así que
`npm ci --ignore-scripts` no haría falta como mitigación. (Para el build sí seguiría
siendo inviable de todos modos: `sharp`, transitivo, depende de binarios por plataforma.)

## Upstreams abandonados o archivados

- **Repositorios archivados: 0** de 33. Evaluado en las 33.
- **Deprecados o retirados: 0** de 33.
- **Actividad de mantenimiento: 1 marcado** — `clsx` 2.1.1, sin push en 2 años
  (último 2024-06-10). Mueve 87,5 M de descargas semanales. Es una librería de ~200 bytes
  cuyo problema está resuelto; quieto no es lo mismo que abandonado. **Anotar, no actuar.**

## Concentración de publishers

11 marcados sobre 15 evaluados; **18 no son evaluables**. Los marcados:

| Paquete | Publisher único | Descargas/sem |
| --- | --- | --- |
| `@types/node`, `@types/react`, `@types/react-dom` | `types` (DefinitelyTyped) | 98 M–316 M |
| `date-fns` | `kossnocorp` | 69,5 M |
| `class-variance-authority` | `joebell93` | 45,3 M |
| `sonner` | `emilkowalski` | 34,9 M |
| `clsx` | `lukeed` | 87,6 M |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | `clauderic` | 18 M c/u |
| `opus-recorder` | `christopherr` | 87,4 K |

**Esto no es accionable y conviene no tratarlo como si lo fuera.** Un publisher único es
la norma en npm para librerías chicas, y las alternativas no son mejores en este eje. Lo
que sí merece registrarse: `opus-recorder` es el de menor volumen del árbol por tres
órdenes de magnitud (87 K/sem contra una mediana de 40 M) y además tiene publisher único
y sin política de seguridad. Es el candidato más plausible a un compromiso que pase
inadvertido. **Anotar.**

Los 18 no evaluables no son un hueco de riesgo: publican desde CI con provenance, así que
el conjunto de publishers efectivo es quien pueda mergear a la rama de release, cosa que
no es observable desde afuera.

## Qué corregir hoy y qué anotar

**Hoy:**

1. `next` 16.2.12 → 16.3.3 o 16.3.5, con `eslint-config-next` en el mismo paso. Dos
   CRITICAL, salto de minor.
2. `vitest` 4.1.10 → 4.1.11. Parche, build-time.

**Anotar y consultar con upstream:**

3. Los cuatro overrides (`fast-uri`, `hono`, `js-yaml`, `sharp`) que fijan versiones que
   siguen marcadas.
4. Los seis transitivos restantes: se mueven solos cuando suba `next`, que es quien
   arrastra la mayoría.
5. `opus-recorder` como el eslabón de menor volumen del árbol.
6. `clsx` quieto desde 2024: sin acción.

## Límites de esta auditoría

- Todo criterio salvo advisories aplica **solo a las 33 dependencias directas**. Los 747
  transitivos se revisaron por advisories y por nada más.
- **2 entradas del lockfile no se pudieron verificar** contra un registro público y no se
  chequearon: `@napi-rs/wasm-runtime` 1.1.4 y `@tybys/wasm-util` 0.10.2, ambas resuelven
  desde un origen no declarado.
- Cobertura floja en `Publisher concentration` (15/33) y en los criterios de Scorecard
  (22-23/33, sin informe para 10 dependencias).
- La auditoría nunca instaló, compiló ni ejecutó nada, y no leyó código de dependencias:
  solo metadata de registro, advisories y repositorio.

## Informe completo del colector

<details>
<summary>Salida de render.py</summary>

# Supply Chain Risk Report — `crm`

**Scanned:** `/Users/emilianoacosta/Desktop/crm-whatsapp-instalador/crm`  
**Commit:** `8c3f7b90cdb9`  
**Manifests read:** `package.json`, `package-lock.json`  
**Scanned at:** 2026-09-13T18:55:58+00:00  
**Direct dependencies:** 33 (npm 33)

## Summary

- **2 of 33 dependencies have known advisories.** See the findings below.
- **10 transitive packages carry known advisories** at the locked versions — see Transitive advisories. 2 entries were unverifiable against a public registry and not checked (see Transitive advisories).
- 15 of 33 dependencies carry at least one finding, 10 of which reach production.
- Weakest coverage: **Publisher concentration**, established for 15 of 33; the Coverage section lists every criterion.

## Production dependencies

22 dependencies are declared as runtime dependencies and ship in the built artifact. Advisory status is given for every one, clean or not.

| Dependency | Version | Advisories | Other findings |
|---|---|---|---|
| `@base-ui/react` | 1.6.0 | none known | — |
| `@dagrejs/dagre` | 3.1.0 | none known | — |
| `@dnd-kit/core` | 6.3.1 | none known | Publisher concentration |
| `@dnd-kit/sortable` | 10.0.0 | none known | Publisher concentration |
| `@dnd-kit/utilities` | 3.2.2 | none known | Publisher concentration |
| `@supabase/ssr` | 0.12.0 | none known | — |
| `@supabase/supabase-js` | 2.108.2 | none known | — |
| `@xyflow/react` | 12.11.2 | none known | — |
| `class-variance-authority` | 0.7.1 | none known | Publisher concentration |
| `clsx` | 2.1.1 | none known | Publisher concentration, Maintenance activity |
| `date-fns` | 4.4.0 | none known | Publisher concentration |
| `lucide-react` | 1.30.0 | none known | — |
| `next` | 16.2.12 | **2 advisories affect the installed 16.2.12** | — |
| `next-intl` | 4.13.5 | none known | — |
| `opus-recorder` | 8.0.5 | none known | Publisher concentration |
| `react` | 19.2.4 | none known | — |
| `react-dom` | 19.2.4 | none known | — |
| `recharts` | 3.10.1 | none known | — |
| `shadcn` | 4.16.2 | none known | — |
| `sonner` | 2.0.7 | none known | Publisher concentration |
| `tailwind-merge` | 3.6.0 | none known | — |
| `tw-animate-css` | 1.4.0 | none known | — |

## Findings

### Reaches production

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `clsx` | 2.1.1 | 87,550,818/wk | no push in 2 years (last 2024-06-10); single human publisher (lukeed) of 1 listed |
| `@dnd-kit/core` | 6.3.1 | 18,507,915/wk | single human publisher (clauderic) of 1 listed |
| `@dnd-kit/sortable` | 10.0.0 | 18,090,607/wk | single human publisher (clauderic) of 1 listed |
| `@dnd-kit/utilities` | 3.2.2 | 18,432,430/wk | single human publisher (clauderic) of 1 listed |
| `class-variance-authority` | 0.7.1 | 45,324,438/wk | single human publisher (joebell93) of 1 listed |
| `date-fns` | 4.4.0 | 69,480,298/wk | single human publisher (kossnocorp) of 1 listed |
| `next` | 16.2.12 | 43,416,095/wk | 2 advisories affect the installed 16.2.12 |
| `opus-recorder` | 8.0.5 | 87,434/wk | single human publisher (christopherr) of 1 listed |
| `sonner` | 2.0.7 | 34,930,481/wk | single human publisher (emilkowalski) of 1 listed |

### Build-time only

Declared as development dependencies. A compromise here reaches build and CI hosts rather than users of the shipped artifact.

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `@types/node` | 26.1.2 | 316,521,424/wk | single human publisher (types) of 1 listed |
| `@types/react` | 19.2.14 | 117,806,483/wk | single human publisher (types) of 1 listed |
| `@types/react-dom` | 19.2.3 | 98,563,754/wk | single human publisher (types) of 1 listed |
| `vitest` | 4.1.10 | 77,062,981/wk | 1 advisory affects the installed 4.1.10 |

## Upstream repository and CI hygiene — OpenSSF Scorecard

These criteria describe each dependency's own repository, not the audited
project. Remediation, where any exists, is upstream.

### Reaches production

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `next` | 16.2.12 | 43,416,095/wk | Binary-Artifacts scores 0/10 (below 10) |
| `next-intl` | 4.13.5 | 4,246,507/wk | Binary-Artifacts scores 9/10 (below 10) |
| `opus-recorder` | 8.0.5 | 87,434/wk | Binary-Artifacts scores 8/10 (below 10) |

### Build-time only

Declared as development dependencies. A compromise here reaches build and CI hosts rather than users of the shipped artifact.

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `eslint-config-next` | 16.2.12 | 24,625,556/wk | Binary-Artifacts scores 0/10 (below 10) |

## Transitive advisories

10 packages of the 747 registry-verified packages beyond the direct set (resolved by `package-lock.json`) carry known advisories at the locked versions. Only advisories were checked at this depth.

| Package | Version | Reaches | Advisories |
|---|---|---|---|
| `@humanfs/node` (npm) | 0.16.7 | build-time only | GHSA-p498-v437-472g |
| `@vitest/mocker` (npm) | 4.1.10 | build-time only | GHSA-82fw-gwwq-j7x9 |
| `baseline-browser-mapping` (npm) | 2.10.19 | production | GHSA-w5vr-8v7q-w6rv |
| `browserslist` (npm) | 4.28.2 | production | GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx |
| `fast-uri` (npm) | 3.1.5 | production | GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp |
| `hono` (npm) | 4.13.0 | production | GHSA-crvj-82cr-hjcx, GHSA-g6gw-c38x-mqfc, GHSA-gqvv-2mrq-wpjv |
| `js-yaml` (npm) | 4.3.1 | production | GHSA-2883-xcg3-v3hh |
| `postcss-selector-parser` (npm) | 7.1.1 | production | GHSA-w9m9-85wc-3x92 |
| `qs` (npm) | 6.15.2 | production | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx |
| `sharp` (npm) | 0.35.3 | production | GHSA-rgj7-g3m4-5g8c |

2 entries in the lockfile could not be verified against a public registry and were not checked for advisories:

- `@napi-rs/wasm-runtime` 1.1.4 (npm) — resolves from an undeclared source, not the npm registry, so registry-keyed advisory data does not apply to it
- `@tybys/wasm-util` 0.10.2 (npm) — resolves from an undeclared source, not the npm registry, so registry-keyed advisory data does not apply to it

## Informational

Measured, not flagged.

- **CI token permissions**: median 0/10 across 22 scored dependencies; 13 score below 6. Not flagged — this measures whether CI workflows declare least-privilege tokens, which tracks project maturity rather than the likelihood of malicious code being published.
- **Changes reviewed by a second person**: median 8/10 across 23 scored dependencies; 11 score below 6. Not flagged — this measures the share of recent commits reviewed by a second person, which is low for most small single-maintainer projects and largely restates publisher concentration.
- **Publish provenance**: 18 of 33 publish with build provenance.
  Without: `@dagrejs/dagre`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@types/node`, `@types/react`, `@types/react-dom`, `class-variance-authority`, `clsx`, `date-fns` and 5 more
- **Security policy published**: 18 of 33 publish a security policy.
  Without: `@dagrejs/dagre`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@tailwindcss/postcss`, `class-variance-authority`, `clsx`, `lucide-react`, `next-intl`, `opus-recorder` and 5 more
- **Download volume**: established for 33 of 33; median 40,450,594/week. Lowest: `opus-recorder` (87,434/wk), `@dagrejs/dagre` (3,225,659/wk), `next-intl` (4,246,507/wk).

## Coverage

What was and was not measured, per criterion.

| Criterion | Tier | Assessed | Flagged | Not assessable |
|---|---|---|---|---|
| Known advisories | A | 33/33 | 2 | 0 |
| Deprecated or yanked | A | 33/33 | 0 | 0 |
| Repository archived | A | 33/33 | 0 | 0 |
| Maintenance activity | A | 33/33 | 1 | 0 |
| Publisher concentration | B | 15/33 | 11 | 18 |
| Install-time script execution | B | 33/33 | 0 | 0 |
| Dangerous CI workflow | scorecard | 22/33 | 0 | 11 |
| CI token permissions | scorecard | 22/33 | 0 | 11 |
| Checked-in binaries | scorecard | 23/33 | 4 | 10 |
| Changes reviewed by a second person | scorecard | 23/33 | 0 | 10 |
| Publish provenance | info | 33/33 | 0 | 0 |
| Security policy published | info | 33/33 | 0 | 0 |
| Download volume | info | 33/33 | 0 | 0 |

## Not assessable

**Checked-in binaries**

- 10 dependencies — OpenSSF Scorecard has no report for this repository: `@supabase/ssr`, `@xyflow/react`, `class-variance-authority`, `prettier-plugin-tailwindcss`, `react`, `react-dom` and 4 more

**Changes reviewed by a second person**

- 10 dependencies — OpenSSF Scorecard has no report for this repository: `@supabase/ssr`, `@xyflow/react`, `class-variance-authority`, `prettier-plugin-tailwindcss`, `react`, `react-dom` and 4 more

**Dangerous CI workflow**

- 10 dependencies — OpenSSF Scorecard has no report for this repository: `@supabase/ssr`, `@xyflow/react`, `class-variance-authority`, `prettier-plugin-tailwindcss`, `react`, `react-dom` and 4 more
- 1 dependency — Scorecard could not evaluate Dangerous-Workflow (score -1): `opus-recorder`

**Publisher concentration**

- 18 dependencies — publishes from CI with provenance, so the effective publisher set is whoever can merge to the release branch — not externally observable: `@base-ui/react`, `@supabase/ssr`, `@supabase/supabase-js`, `@tailwindcss/postcss`, `@xyflow/react`, `eslint-config-next` and 12 more

**CI token permissions**

- 10 dependencies — OpenSSF Scorecard has no report for this repository: `@supabase/ssr`, `@xyflow/react`, `class-variance-authority`, `prettier-plugin-tailwindcss`, `react`, `react-dom` and 4 more
- 1 dependency — Scorecard could not evaluate Token-Permissions (score -1): `opus-recorder`

## Method and caveats

- Repository-level criteria (archived, maintenance activity, security policy, and the Scorecard checks) describe the source repository rather than the package. 33 dependencies resolve to 26 distinct repositories, so one repository can appear as several findings. Shared: github.com/DefinitelyTyped/DefinitelyTyped, github.com/clauderic/dnd-kit, github.com/react/react, github.com/tailwindlabs/tailwindcss, github.com/vercel/next.js
- Optional tooling detected: npm. Not installed, so not used: bundler-audit, cargo-audit, osv-scanner, pip-audit.
- Every criterion except advisories applies to direct dependencies only. The 747 registry-verified packages resolved by package-lock.json were checked for known advisories at their locked versions, and for nothing else. 2 lockfile entries could not be verified against a public registry and were not checked.
- HTTP sources: 125 fetched, 72 served from cache (oldest 0.0h old), 0 refetched as stale, 0 unavailable offline, 0 errors.

</details>
