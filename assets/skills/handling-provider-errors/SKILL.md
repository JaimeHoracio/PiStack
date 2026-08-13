---
name: handling-provider-errors
description: Use when an HTTP error from a model provider appears in the TUI (429, 500, 401, 502, empty body, fetch failed) — translates the raw error into a user-friendly explanation with cause + suggested action
---

# Handling Provider Errors

## Overview

Pi core does not intercept provider HTTP errors. When `@ai-sdk/openai-compatible` or the native provider SDK fails, the raw error message reaches the TUI unchanged (e.g. `429 status code (no body)`).

This skill does NOT fix that limitation — it teaches the agent how to **respond** when such an error appears, so the user gets a useful message instead of staring at HTTP jargon.

## When to Use

Use when the user (or a tool output) shows an error matching any of:

- `Error: <NNN> status code (no body)`
- `Error: fetch failed`
- `Error: 401 ...`
- `Error: 500 ...`
- `Error: ECONNREFUSED ...`
- `Error: socket hang up`
- Any error mentioning `openai-compatible`, `anthropic`, or a provider URL

## The Map

Match the raw error to a row below, then use the **User-friendly message** verbatim and the **Action** to recover.

| Raw error                                       | Cause                                                | User-friendly message                                                                                                                  | Action                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `429 status code (no body)`                     | Rate limit hit on the provider tier                  | "El proveedor limitó la cantidad de requests (429). Esperá unos segundos o bajá el tamaño del mensaje antes de reintentar."          | Wait 15-30s, retry. If persistent: check tier limits or switch provider.                          |
| `429 Too Many Requests` (with JSON body)        | Same as above, provider gave a structured error      | "El proveedor limitó la cantidad de requests (429): <body.error.message>."                                                             | Same as above, but include the body excerpt.                                                      |
| `401 status code`                               | Invalid or expired API key                           | "La API key del proveedor fue rechazada (401). Verificá que la variable de entorno correspondiente esté bien definida."              | Ask user to check `${PROVIDER_API_KEY}`. Do NOT echo the key back.                                 |
| `403 Forbidden`                                 | Key lacks permission for the requested model         | "La API key no tiene permiso para ese modelo (403). Posiblemente el modelo no está disponible en tu tier."                            | Suggest a fallback model from the same provider.                                                  |
| `500 / 502 / 503 status code`                   | Provider outage or transient backend failure         | "El proveedor tuvo un error interno (<code>). Es transitorio — esperá unos segundos y reintentá."                                     | Retry with exponential backoff. After 3 failures: suggest switching provider.                    |
| `fetch failed` / `ECONNREFUSED 127.0.0.1:<p>`   | Local provider not running                           | "El proveedor local no está corriendo. Iniciá el servidor (ej: `ollama serve`, `opencode serve --port <p>`) y reintentá."            | Give the exact command for the suspected local server.                                            |
| `fetch failed` / `ENOTFOUND <host>`             | DNS resolution failed (network down or wrong host)   | "No se pudo resolver el host del proveedor. Revisá tu conexión a internet o la URL configurada."                                      | Ask user to verify `BASE_URL` env var.                                                             |
| `fetch failed` / `ETIMEDOUT`                    | Network timeout                                      | "La request al proveedor tardó demasiado y se cortó. Probablemente el modelo está sobrecargado o tu conexión es lenta."              | Retry once, then suggest a smaller model or shorter prompt.                                        |
| `socket hang up`                                | Connection dropped mid-stream                        | "La conexión con el proveedor se cortó mientras llegaba la respuesta."                                                                 | Retry — usually transient.                                                                        |
| Body says `context_length_exceeded`             | Prompt + max output exceeds model window             | "El mensaje es demasiado largo para este modelo. Acortá el contexto o cambiá a un modelo con ventana mayor."                          | Suggest compaction (`/compact`) or a larger-context model.                                         |
| Body says `model_not_found`                     | Model name typo or deprecated                        | "El modelo solicitado no existe o fue dado de baja. Verificá el nombre en `/model`."                                                  | List available models from `models.json` and let user pick.                                       |

## How to Respond

1. **Identify** the row that matches the raw error (use keywords from the table).
2. **Quote the raw error** to the user first — never hide what actually happened.
3. **Translate** using the "User-friendly message" column (in Spanish unless the user writes in English).
4. **Suggest** the action, with the exact command if applicable.
5. **Ask** if they want to retry now or fix the root cause first.

Example (the bug from this session):

```
Vi el error "429 status code (no body)" en pantalla.

El proveedor limitó la cantidad de requests (429). Esperá unos segundos
o bajá el tamaño del mensaje antes de reintentar.

Si querés, puedo:
- Esperar 30s y reintentar automáticamente.
- Cambiar a otro modelo mientras tanto (¿cuál preferís?).
```

## What NOT to Do

- ❌ Don't pretend the error doesn't exist or say "all good".
- ❌ Don't echo the API key in the response, even partially.
- ❌ Don't retry in a tight loop — exponential backoff or the user will hit the same limit 10×.
- ❌ Don't suggest "restart your computer" — it's never the answer for provider errors.
- ❌ Don't modify Pi core to intercept these — the cost/benefit is wrong for a PiStack fix.

## Related

- `systematic-debugging` — use for bugs where root cause is unknown; this skill is specifically for **known** HTTP error shapes.
- `/friendly-error` command — paste a raw error and get the table row instantly without reading this skill.
