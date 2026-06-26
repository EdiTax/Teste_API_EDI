# 📋 Relatório de Execuções — Noite de 25/06/2026

## Contexto
Integração com a API de Apuração Assistida da CBS (Receita Federal) para o CNPJ base `45877877`.
Ambiente utilizado: **Produção** (`api.receitafederal.gov.br`).

---

## Linha do Tempo Completa

### 🔹 Execução 1 — 21:05 (horário de Brasília)

| Passo | Descrição | Status | Detalhes |
|:------|:----------|:-------|:---------|
| **Passo 1** — Autenticar | `POST https://api.receitafederal.gov.br/token` | ✅ Sucesso (200) | Token OAuth2 gerado: `20zz6JXh...wSp1p9iF`. Válido por 1h (até ~22:05). |
| **Passo 2** — Solicitar | `POST https://api.receitafederal.gov.br/rtc/apuracao-cbs/v1/45877877` | ✅ Sucesso (201) | A Receita Federal **aceitou** a solicitação. Registro: `2026-06-26T00:05:59.859Z` (UTC). |
| **Passo 3** — Baixar | `GET https://api.receitafederal.gov.br/rtc/download/v1/{tiquete}` | ❌ **Não executado** | O tíquete retornado no corpo da resposta 201 **não foi capturado** pelo código (bug). |

> ⚠️ **PROBLEMA:** O código antigo fazia `console.log(responseSolicitacao.status)` mas **descartava** o `responseSolicitacao.data`. O tíquete estava lá na resposta, mas foi ignorado.

**Uso da cota diária:** 1 de 2 chamadas consumidas.

---

### 🔹 Execução 2 — 21:20 (horário de Brasília)

| Passo | Descrição | Status | Detalhes |
|:------|:----------|:-------|:---------|
| **Passo 1** — Autenticar | Cache do token | ✅ Reutilizado | Token ainda válido do cache (`token_cache.json`). |
| **Passo 2** — Solicitar | `POST .../apuracao-cbs/v1/45877877` | ✅ Sucesso (201) | Segunda chamada aceita. Registro: `2026-06-26T00:20:53.696Z` (UTC). |
| **Passo 3** — Baixar | Não executado | ❌ **Mesmo bug** | Tíquete ignorado novamente. |

**Uso da cota diária:** 2 de 2 chamadas consumidas (cota esgotada para o dia 25/06).

---

### 🔹 Execução 3 — 22:13 a 22:22 (Polling)

| Passo | Descrição | Status | Detalhes |
|:------|:----------|:-------|:---------|
| **Passo 1** — Autenticar | Cache do token | ✅ Reutilizado | Token do cache, expirando ~22:45. |
| **Passo 2** — Solicitar | Pulado pelo usuário | ⏩ Ignorado | Escolheu "S" para reutilizar disparo anterior (cota esgotada). |
| **Passo 4** — Polling | 20 tentativas de `GET /api/tiquete` na Vercel | ❌ Timeout (10 min) | Todas retornaram `pending` — nenhum tíquete no Supabase. |

---

## Análise dos Logs da Vercel (67KB exportados)

```
Período coberto: 22:02 a 22:20 (Brasília) / 01:02 a 01:20 UTC
Total de requisições registradas: ~55
```

| Método | Rota | Quantidade | Origem |
|:-------|:-----|:-----------|:-------|
| `GET` | `/api/tiquete?cnpj=45877877` | ~40 | Motor local (axios/1.18.1) — polling |
| `GET` | `/api/status-env` | 1 | Navegador Edge — painel de diagnóstico |
| `POST` | `/api/webhook-receita` | **🔴 ZERO** | A Receita Federal **nunca chamou** o webhook |

> 🎯 **Descoberta crítica:** O tíquete é retornado **diretamente na resposta 201** do POST (Passo 2).
> A Receita Federal NÃO envia callback para o webhook (`urlRetorno`).
> O webhook na Vercel nunca recebeu nenhum POST externo em todo o período monitorado.

---

## Diagnóstico Final

### O que funcionou ✅
1. **Passo 1 (Token):** Autenticação OAuth2 bem-sucedida. Token gerado e cacheado.
2. **Passo 2 (Solicitação):** A Receita Federal aceitou ambas as solicitações com Status `201`.
3. **Infraestrutura:** Vercel operante, Supabase acessível, motor local funcional.

### O que falhou ❌
1. **Captura do tíquete:** O código antigo ignorava o corpo da resposta `201` que continha o tíquete.
2. **Arquitetura do polling:** O sistema esperava que a Receita enviasse o tíquete via webhook, mas ela retorna direto no POST.

### Correção aplicada (25/06 às 22:17)
Commit: `41f37e4` — "fix: capturar tíquete diretamente da resposta 201 do POST"

O código agora:
- Lê `responseSolicitacao.data` e extrai o campo `tiquete`.
- Salva o tíquete em `tiquete_cache.json` para reuso.
- Exibe o corpo completo da resposta no console (debug).
- Pula direto para o download sem esperar o webhook.

---

## Estado Atual dos Caches (manhã de 26/06, 08:18 BRT)

| Arquivo | Conteúdo | Status |
|:--------|:---------|:-------|
| `token_cache.json` | Token `20zz6JXh...`, expira em `1782438304161` (~22:45 de 25/06) | ⏰ **EXPIRADO** |
| `limites_disparo.json` | 2 disparos em 26/06 UTC (= 25/06 BRT) | 🔄 **Cota renovada** (é dia 26/06 BRT) |
| `tiquete_cache.json` | **NÃO EXISTE** | ❌ Tíquete nunca foi salvo |
