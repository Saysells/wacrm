# Auditoría insecure-defaults — 2026-09-13

Plugin `insecure-defaults@trailofbits` v2.0.1 (pipeline de 11 agentes, 6 categorías,
79 patrones). Alcance: `crm/`, excluyendo `node_modules`, `.next`, `auditoria/` y
archivos de test. Solo lectura: no se corrigió nada.

Commit auditado: `8c3f7b9`.

## Resumen

| Severidad | Cantidad |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 13 |

Las 13 son de la misma categoría, **debug-features**, y de la misma forma: una ruta de
API devuelve el `PostgrestError.message` crudo en el cuerpo de un 500. Lo que se filtra
son nombres de tablas, columnas, constraints y políticas RLS — nunca una credencial, un
token ni datos de filas.

**Cero hallazgos de credenciales hardcodeadas, secretos de fallback, credenciales por
defecto o criptografía débil.** Los dos primeros son justamente lo que se pidió buscar y
no aparecieron: las 426 archivos barridos por `fallback-secrets` y `default-credentials`
no dejaron un solo candidato que sobreviviera la verificación.

## Hallazgos

| Sev | Categoría | Ubicación | Origen |
| --- | --- | --- | --- |
| LOW | debug-features | `src/app/api/automations/[id]/route.ts:39` | upstream |
| LOW | debug-features | `src/app/api/automations/cron/route.ts:42` | upstream |
| LOW | debug-features | `src/app/api/automations/route.ts:23` | upstream |
| LOW | debug-features | `src/app/api/flows/[id]/activate/route.ts:116` | upstream |
| LOW | debug-features | `src/app/api/flows/[id]/route.ts:210` | upstream |
| LOW | debug-features | `src/app/api/flows/cron/route.ts:95` | **propio** |
| LOW | debug-features | `src/app/api/flows/route.ts:43` | upstream |
| LOW | debug-features | `src/app/api/quick-replies/[id]/route.ts:80` | upstream |
| LOW | debug-features | `src/app/api/quick-replies/route.ts:19` | upstream |
| LOW | debug-features | `src/app/api/whatsapp/templates/[id]/route.ts:211` | upstream |
| LOW | debug-features | `src/app/api/whatsapp/templates/[id]/route.ts:226` | upstream |
| LOW | debug-features | `src/app/api/whatsapp/templates/submit/route.ts:255` | upstream |
| LOW | debug-features | `src/app/api/whatsapp/templates/sync/route.ts:310` | upstream |

**Propio vs upstream: 1 propio, 12 upstream.** El único en código post-fork es
`src/app/api/flows/cron/route.ts:95`, de la sesión de Flujos. Es además el más
ilustrativo: la línea 94 loguea `error.message` al servidor (correcto) y la 95 lo manda
igual al cliente (no). Borrar la segunda mitad es el arreglo entero.

El repo ya tiene la forma segura resuelta: `toErrorResponse` en
`src/lib/auth/account.ts:69-75` loguea y devuelve `Internal server error` genérico. Doce
de las trece rutas **ya lo importan** y lo usan para los fallos de rol — se lo saltean
solo en el camino del error de base.

### Agravante en cuatro de ellas

`automations/[id]`, `flows/[id]`, `flows/[id]/activate` y `quick-replies/[id]` corren
sobre `supabaseAdmin()` (service-role, sin RLS), así que el mensaje vuelve sin pasar por
ninguna capa de política.

## Qué corregir hoy y qué anotar

**Nada de esto es urgente.** Trece LOW, todas requieren estar autenticado, y dos de ellas
(`automations/cron`, `flows/cron`) piden además el `AUTOMATION_CRON_SECRET`.

- **Hoy, si se quiere cerrar barato**: `flows/cron/route.ts:95` — es propio, es una línea,
  y el log del servidor ya queda. Coste: un carácter de diff.
- **Anotar**: las otras doce son upstream. Corregirlas significa divergir del fork en doce
  archivos que upstream va a seguir tocando, a cambio de cerrar una divulgación de esquema
  a usuarios ya autenticados. La alternativa sensata es un PR a `ArnasDon/wacrm`, no un
  parche local.
- **Anotar**: el patrón se repite porque no hay lint que lo impida. Una regla ESLint que
  prohíba `error.message` dentro de un `NextResponse.json` lo frenaría de raíz, y vale más
  que las trece correcciones sueltas.

## Refutados (9)

El pipeline verificó y descartó nueve candidatos:

| Categoría | Ubicación | Refutado en |
| --- | --- | --- |
| fail-open-security | `next.config.ts:39` | paso 3 |
| fail-open-security | `src/middleware.ts:103` | paso 3 |
| fail-open-security | `src/app/api/account/invitations/route.ts:86` | paso 4 |
| permissive-access | `src/middleware.ts:106` | paso 3 |
| permissive-access | `src/app/api/account/invitations/route.ts:90` | paso 3 |
| permissive-access | `src/lib/auth/api-context.ts:84` | paso 3 |
| permissive-access | `supabase/migrations/001_initial_schema.sql:185` | paso 3 |
| debug-features | `mcp-server/src/tools/shared.ts:39` | paso 4 |
| debug-features | `src/app/api/whatsapp/broadcast/route.ts:203` | paso 3 |

## Cobertura — leer esto antes de concluir nada

| Categoría | Archivos barridos |
| --- | --- |
| fallback-secrets | 426 |
| default-credentials | 426 |
| fail-open-security | 426 |
| weak-crypto | 0 |
| permissive-access | 540 |
| debug-features | 426 |

- **`weak-crypto` barrió 0 archivos** y figura en `unsearched_categories`. Esa categoría
  **no corrió**. Este informe no dice nada sobre criptografía débil en el repo; lo que hay
  sobre el tema es la verificación de `gcm-no-tag-length` de la auditoría Semgrep del mismo
  día, que es un punto, no un barrido.
- Archivos totales vistos: 2244. Candidatos crudos: 22,
  únicos: 22, en 21 archivos.
  3 lotes corridos, 3 verificados, 0 sin adjudicar.
- Ningún hallazgo ni refutado cayó en las rutas excluidas.
- El informe en prosa del pipeline dice "14" en su tabla de resumen pero enumera 13
  ubicaciones confirmadas; la cifra correcta es **13**, la del resultado estructurado.

## Informe completo del pipeline

<details>
<summary>Texto generado por el pipeline</summary>

# Insecure-Defaults Audit — crm-whatsapp-instalador/crm

## 1. Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 14 |

All 14 confirmed findings fall under **debug-features**: API routes that return a raw database error (`PostgrestError.message`) or a raw thrown `Error.message` verbatim in the HTTP response body instead of a generic message. The actual exposure is schema/constraint/policy-name disclosure to authenticated callers (in a few cases scoped further to admin or shared-secret holders) — never a credential, a token, or row data. No CRITICAL/HIGH/MEDIUM findings, and no configurable fallback-secret or default-credential findings survived verification.

**All 14 findings are unconditional** — there is no environment variable, flag, or deployment setting that changes this behavior. They are insecure as written, not insecure-if-misconfigured, so remediation is a code fix in each handler, not a deployment/config change. This is the same reason the run found zero configurable findings to report: every fail-open and permissive-access candidate that depended on an unset variable was traced and refuted (see §5) because either the value never reaches a security decision, or an outer authorization layer already gates the same boundary.

## 2. Findings

All findings below are severity **LOW**.

---

### Finding: Raw PostgREST/Postgres error text returned in API error responses
Locations:
- `src/app/api/automations/route.ts:23`
- `src/app/api/automations/[id]/route.ts:39`
- `src/app/api/automations/cron/route.ts:42`
- `src/app/api/flows/route.ts:43`
- `src/app/api/flows/[id]/route.ts:210`
- `src/app/api/flows/[id]/activate/route.ts:116`
- `src/app/api/flows/cron/route.ts:95`
- `src/app/api/quick-replies/route.ts:19`
- `src/app/api/quick-replies/[id]/route.ts:80`
- `src/app/api/whatsapp/templates/[id]/route.ts:211`

Pattern (representative, `automations/route.ts:23`):
```ts
if (error) return NextResponse.json({ error: error.message }, { status: 500 })
```
Every other location in this group repeats the identical shape (`{ error: error.message }` / `{ error: updErr.message }`), each unconditional on the query that precedes it.

Verification: Each site is a live query (`select`, `update`, `delete`) whose `error` object — a `PostgrestError` — is forwarded to the client without transformation. Several run on `supabaseAdmin()` (an RLS-bypassing service-role client: `automations/[id]/route.ts`, `flows/[id]/route.ts`, `flows/[id]/activate/route.ts`, `quick-replies/[id]/route.ts`), so the message returned is untouched by any policy layer. `flows/cron/route.ts:95` even logs the same message safely at line 94 (`console.error`) immediately before shipping it again to the caller at the sink line.

Production Impact: Unconditional — nothing to configure. The repo already has a generic-message helper, `toErrorResponse` (`src/lib/auth/account.ts:69-75`), imported in most of these same files for role-check failures, but bypassed on every one of these DB-error branches.

Exploitation: An authenticated caller (any signed-in user for `automations`, `flows`, and `quick-replies` GET; agent+ for the `flows` mutation routes; a `TALLY`/cron-secret holder for the two `*/cron/route.ts` sinks) triggers a query error — a bad id, a constraint violation, a malformed UUID — and receives the raw Postgres/PostgREST diagnostic (e.g. `column automations.x does not exist`, `new row violates row-level security policy for table "automations"`, `new row for relation "flows" violates check constraint "flows_status_check"`, `invalid input syntax for type uuid: "..."`). This discloses table/column/constraint/policy names but no data, secret, or credential.

---

### Finding: Unbounded catch-all forwards thrown `Error.message` instead of a generic message
Locations:
- `src/app/api/whatsapp/templates/[id]/route.ts:226`
- `src/app/api/whatsapp/templates/submit/route.ts:255`
- `src/app/api/whatsapp/templates/sync/route.ts:310`

Pattern (`templates/[id]/route.ts:226`, identical shape in the other two):
```ts
} catch (error) {
    console.error('Error editing template:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to edit template.' },
      { status: 500 },
    )
```

Verification: The catch wraps the whole handler and forwards any thrown `Error.message` verbatim. `submit/route.ts` and `sync/route.ts` special-case `UnauthorizedError`/`ForbiddenError` through `toErrorResponse` first (visible in the extracted code, lines directly above the sink), so only the *generic* branch is affected there; `templates/[id]/route.ts:226` has no such special-case at all — an auth error thrown deeper in the handler would also flatten into this same raw-message 500. Possible messages include JS `TypeError`s naming internal object shape, GCM decrypt failures from `src/lib/whatsapp/encryption.ts`, or raw Meta Graph API error text.

Production Impact: Unconditional — no configuration mitigates any of the three. `toErrorResponse` is one import away and is already used in the same files for the auth-error branch.

Exploitation: `templates/[id]/route.ts:226` is reachable by any signed-in user (this route has no `requireRole`, only `auth.getUser()`); `submit/route.ts:255` and `sync/route.ts:310` require `requireRole('admin')`. In all three cases the disclosed content is schema/provider-error text, not a secret.

## 3. Remediation

All 14 findings share one fix shape and one existing helper:

1. **Route the DB-error branch through `toErrorResponse` (or an equivalent generic-500 helper) instead of `{ error: error.message }`.** Files: `src/app/api/automations/route.ts`, `src/app/api/automations/[id]/route.ts`, `src/app/api/automations/cron/route.ts`, `src/app/api/flows/route.ts`, `src/app/api/flows/[id]/route.ts`, `src/app/api/flows/[id]/activate/route.ts`, `src/app/api/flows/cron/route.ts`, `src/app/api/quick-replies/route.ts`, `src/app/api/quick-replies/[id]/route.ts`. Log `error.message` server-side (several already do, e.g. `flows/cron/route.ts:94`) and return a fixed string (`Internal server error` or a route-appropriate constant) in the body. `src/lib/auth/account.ts:69-75` is the reference implementation already in this codebase.

2. **Close the catch-all gap in the templates routes.** Files: `src/app/api/whatsapp/templates/[id]/route.ts` (lines 211 and 226, plus the noted sibling DELETE branches at 316/325), `src/app/api/whatsapp/templates/submit/route.ts:255`, `src/app/api/whatsapp/templates/sync/route.ts:310`. Two changes: (a) replace the raw-message JSON with a generic message the way `toErrorResponse` does, keeping the useful non-secret advice text (e.g. `Run "Sync from Meta" to recover.`) but dropping the interpolated `${updErr.message}` / `${delErr.message}`; (b) in `templates/[id]/route.ts` specifically, add the `UnauthorizedError`/`ForbiddenError` special-case that `submit` and `sync` already have, so an auth failure thrown mid-handler doesn't get flattened into a 500 with a leaked message.

No secrets manager, startup validator, or env-var change is applicable here — every finding is a code-level response-shaping bug, not a missing/defaulted configuration value.

## 4. Coverage and limits

- **Scope**: `/Users/emilianoacosta/Desktop/crm-whatsapp-instalador/crm`
- **Files scanned**: 2244
- **Categories run**: fallback-secrets, default-credentials, fail-open-security, weak-crypto, permissive-access, debug-features
- **Distinct patterns run**: 79
- **Candidates**: 22 raw → 22 unique → 14 confirmed, 8 refuted, 0 left unadjudicated
- **Batches**: 3 run, 3 verified — no batch died mid-run, so `unadjudicated` is empty and no candidate is missing a verdict for that reason.

**Not searched:**
- `weak-crypto` — scanned **0 files** (`files_scanned_by_category.weak-crypto: 0`). It appears in `categories_run` only because the sweep returned, not because it searched any file. This audit makes **no claim** about weak or misused cryptography anywhere in the repo (encryption of stored WhatsApp tokens, `ENCRYPTION_KEY` handling, signature verification for the Meta and Tally webhooks, etc. are all untouched by this run) — that surface should be treated as unreviewed, not clean.

No `seed_only_sweeps` were recorded, so the other five categories are reported as having adapted beyond generic seed patterns for this stack (79 patterns across 5 active categories is a substantive per-category depth, though this report cannot independently confirm pattern quality — only that the category was not seed-only per the coverage record).

## 5. Refuted candidates

| Location | Step refuted | Reason |
|---|---|---|
| `next.config.ts:39` (fail-open-security) | 3 | Report-Only CSP is un-adopted defense-in-depth, never consulted at any enforcement point; enforcing headers (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy) already cover the same threats. |
| `src/middleware.ts:103` (fail-open-security) | 3 | Skipped check is a URL/nav gate; the same unresolved-profile state is denied downstream by `account.ts:133-137` and by RLS (041). No role the check protects can reach the fail-open branch (NOT NULL, client-immutable). |
| `src/app/api/account/invitations/route.ts:86` (fail-open-security) | 4 | Permissive default reachable, but the value is a cosmetic base URL echoed only to the requesting admin — never consulted for auth, tokens, or redirects. |
| `src/middleware.ts:106` (permissive-access) | 3 | `account_role` is a NOT NULL enum; no unrecognized value is reachable, and the same field enforces the real boundary in RLS and route guards. Only a rare no-profile-row case is affected, which renders empty page shells. |
| `src/app/api/account/invitations/route.ts:90` (permissive-access) | 3 | Unconfigured permissive state is real, but gated behind admin-only auth at the same trust boundary; the value returns only to the admin who requested it, alongside the actual token. |
| `src/lib/auth/api-context.ts:84` (permissive-access) | 3 | Documented, intentional zero-scope behavior for the self-identity endpoint (`GET /api/v1/me`); a valid key gaining access to its own identity is the designed-secure case, not a defect. |
| `supabase/migrations/001_initial_schema.sql:185` (permissive-access) | 3 | Permissive `TO PUBLIC` policy is unconditionally dropped by `017_account_sharing.sql:508` within the same cumulative migration set; never governs a fully-migrated, serving database. |
| `mcp-server/src/tools/shared.ts:39` (debug-features) | 4 | Error string reaches only the operator's own MCP client process over stdio (no listener, no privilege drop) — no lower-privileged reader exists. |
| `src/app/api/whatsapp/broadcast/route.ts:203` (debug-features) | 3 | Captured value is Meta's own per-recipient error envelope or a hand-written validation string, never DB/schema/credential detail; genuinely unknown errors already route through `toErrorResponse` (lines 241-246). |

</details>
