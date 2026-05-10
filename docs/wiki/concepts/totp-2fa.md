---
title: TOTP/2FA + Password Hashing
type: concept
updated: 2026-05-10
sources: []
related:
  - ../modules/settings.md
  - ./supabase-sync.md
code_refs:
  - src/App.jsx:833-955
  - src/App.jsx#generateTotpSecret
  - src/App.jsx#totpCode
  - src/App.jsx#verifyTotp
  - src/App.jsx#hashPassword
  - src/App.jsx#checkPassword
---

# TOTP/2FA + Password Hashing

Auth local (sem backend custom). Senha hashada via PBKDF2 + 2FA opcional via TOTP RFC 6238. Tudo browser-side com Web Crypto.

## Password hashing

### Formato armazenado

```
pbkdf2:<salt-base64>:<hash-base64>
```

### `hashPassword(pwd, existingSalt?)`

- Algoritmo: **PBKDF2-SHA-256, 100000 iterações**
- Salt: 16 bytes via `crypto.getRandomValues` (ou reusa `existingSalt` se passado — pra rehash em check)
- Output: 32 bytes
- Encode: base64

### `checkPassword(plain, stored)` → `{match, needsRehash}`

Aceita 3 formatos legados pra migração transparente:

| Formato armazenado | Como checa | `needsRehash` |
|---|---|---|
| `pbkdf2:salt:hash` | rehasha plain com mesmo salt, compara | `false` |
| Hash DJB2 hex (legado v1) | aplica DJB2, compara | `true` |
| Base64 simples (legado v0) | btoa(plain), compara | `true` |

`needsRehash: true` → caller deve chamar `hashPassword(plain)` e atualizar `user.password`. Migração lazy: usuário loga uma vez → senha vira PBKDF2 no próximo `DB.set`.

### Constant-time?

Comparação atual usa `===` em strings base64. **Não é constant-time** — vulnerável a timing attack em teoria. Na prática browser-side com auth local + login throttling (`frost_login_attempts`) o risco é baixo, mas é uma lacuna conhecida.

## TOTP (RFC 6238)

### Constantes

- T0 = 0
- Step = 30s
- Algoritmo: HMAC-SHA-1 (compatível Google Authenticator/Authy/1Password)
- Dígitos: 6
- Janela aceita: ±1 step (±30s) → tolera clock drift

### `generateTotpSecret()`

```js
const bytes = crypto.getRandomValues(new Uint8Array(20));
return base32Encode(bytes); // 32 chars base32 sem padding
```

20 bytes = 160 bits. Tamanho recomendado pra HMAC-SHA-1.

### `base32Encode/Decode`

- Alfabeto RFC 4648: `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`
- Sem padding (`=`)
- Decode é tolerante a lowercase e espaços (autenticadores às vezes copiam com formatação)

### `totpCode(secret, time = Date.now())`

```js
counter = floor(time / 1000 / 30);
hmac = HMAC-SHA-1(base32Decode(secret), counter as 8-byte BE);
offset = hmac[19] & 0x0f;
binary = (hmac[offset] & 0x7f) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3];
return (binary % 10**6).toString().padStart(6, "0");
```

### `verifyTotp(secret, code)`

Tenta `now`, `now - 30s`, `now + 30s`. Match em qualquer um → true. Cobre clock drift do dispositivo do usuário.

### `buildOtpAuthUri({issuer, accountName, secret})`

```
otpauth://totp/<issuer>:<accountName>?secret=<secret>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30
```

`accountName` URL-encoded. Consumido pelo `qrcode` lib pra gerar QR no enrollment.

## Fluxo de enrollment

1. Usuário em Settings → "Ativar 2FA"
2. App gera secret (`generateTotpSecret`)
3. Renderiza QR (`qrcode` + `buildOtpAuthUri`) + secret em texto fallback
4. Usuário escaneia no app autenticador
5. Digita código atual → `verifyTotp` confirma
6. Persiste `user.twoFactorSecret` + gera 8 backup codes (`twoFactorBackupCodes`)
7. Próximo login pede código

## Storage / sync

`twoFactorSecret` e `twoFactorBackupCodes` estão em `USER_SECRET_FIELDS` do `supabase.js` → **strip antes de upload pro kv_store**. Secrets ficam só no device. Trade-off: usuário troca de device → re-enrolla 2FA.

## Padrões / armadilhas

- **Backup codes single-use** — após usar, marcar consumido. Não regerar lista parcial; regerar tudo.
- **`verifyTotp` aceita ±1 step** — não aumentar pra ±2/3 sem revisar (window maior = mais código válido simultâneo = brute-force mais fácil).
- **Throttling não cobre TOTP** hoje — só password. Brute-force de TOTP é viável (10⁶ combinações). Lacuna: aplicar `frost_login_attempts` ao verify do TOTP também.
- **Reusa de salt em rehash**: passar `existingSalt` é só pra check; **nunca** rehash de senha nova com salt antigo.
- **Sync race do secret**: como secret não sincroniza, autenticador no celular ≠ autenticador no desktop. Documentar pro usuário ou implementar sync seguro (claim JWT + Edge Function).

## Lacunas

- [a expandir] Comparação constant-time pro hash check
- [a expandir] Throttling em verify do TOTP
- [a expandir] UX de "perdi o autenticador" — backup codes funcionam mas fluxo não está documentado
