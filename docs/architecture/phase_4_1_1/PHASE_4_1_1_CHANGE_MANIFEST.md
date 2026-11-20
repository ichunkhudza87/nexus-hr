# NEXUS HR — PHASE 4.1.1 CHANGE MANIFEST

**Workspace:** `D:\Antigravity_Projects\nexus-hr\`  
**Date:** 2026-11-12 (UTC+7)  
**Backup Location:** `<appDataDir>\brain\0d4e76fc-95d1-41db-85f1-9bce58a77b9b\scratch\phase_4_1_1_backup\gateway_src`

---

## 1. File Changes & SHA-256 Hash Comparison

| File | Status | SHA-256 Before | SHA-256 After | Description |
|---|---|---|---|---|
| `gateway/src/config/env.ts` | Modified | `E3F09D16DAA82D36EC629B1C84F3E7D129035254AF061D5F501DF8B9E7D01BA2` | `AE2FA0DF34B899BA1308E2CC6098A66E7C4CB4CBA77E5C889F72497F7F99E8B2` | Added `activatedAt` validation and `CORS_ALLOWED_ORIGINS` parsing. |
| `gateway/src/security/hmac-signer.ts` | Modified | `978003648E6E13309168C6C3C14B7BE68BA0300AA678ED334DFFBC0ACCBC80CD` | `B64AA04B98D629E213263A84F0A674B50A98B2B73538B5F9FBD5B801D3705F3C` | Enforced `activatedAt <= now` in `getActiveKey` and `verifyEnvelope`. |
| `gateway/src/errors/gateway-error.ts` | Modified | `773ABD269D618E89F2EDF3CE3D2280C6BA8462F4E020A49BED15A9F976C8D93F` | `8E4DC0B3ADE04BC4BBEE82EC4B2DDAA2ED9A6704103A136346DAA5B48106BBDF` | Sanitized `23505` and `23503` client messages and attached `internalDetail`. |
| `gateway/src/app.ts` | Modified | `6AB09FC5A56493FC899FCAD0A7DD6F4AE5650CA7727CF2BC8E9385BF5F59EB3C` | `2CFF94B3347DDAE19E674188205AC7635B89C11A1AF62EB7EAC5559ADFC5E041` | Added CORS handling, 7 read routes, and safe internal detail logging. |
| `gateway/src/index.ts` | Modified | `E078195CA6F992C6226E3863889B23758FE4E4C7231D456F669F07F3D9674BA2` | `6D66998B06F9FA8309C8F522E3F39D03BFE151C5188DED0043055068A50781E9` | Added server timeouts and `SIGINT`/`SIGTERM` graceful shutdown. |
| `gateway/src/types/domain.ts` | Modified | `51D297614E71E57977228836AF789913B8ED429F0119A0DBFE3CEABE6EF5EB46` | `E8A3DA5065D135E0DE229CD1B85C42D504CF90CA2E558A8B3284FFE1FEDAE1B6` | Added domain interfaces for Central and Branch A read entities and query params. |
| `gateway/src/clients/central-client.ts` | Modified | `8B3AA7A41CF926FD7A0696FE61B80B0B048489E007CB9F8FD4E35E43986A0FC6` | `B8B03881A57C2F8BDD72EAEB59A799BA5271770C9774C0C14C37D1D66DB26D57` | Added `getDashboardSummary` and `getEmployeeDirectory` paginated queries. |
| `gateway/src/clients/branch-rpc-client.ts` | Modified | `545B80A2BF6E6488BF5FF80113A3976B197C614DE6128ABAE3534404EB4143E7` | `388BB76634937F4EB690AA49243D70A862E555EBFF9F08DB30A979CF977E87FE` | Added `getEmployees`, `getShifts`, `getSchedules`, `getAttendance`, `getLeaveRequests`. |
| `gateway/src/validation/read-schemas.ts` | **New** | — | `D18C4AA59AE46A3803165E8E8FEAB173BD93215DAA1E7323D245B750F6EC5A7B` | Strict validation for all 7 read endpoint query parameters. |
| `gateway/src/__tests__/sec-41-remediation.test.ts` | **New** | — | `5371736F972B913C0706B8B5999CBDE2F11362B65072C8C3F83ED947F00F4BDF` | Unit tests for `activatedAt` and error sanitization (6 tests). |
| `gateway/src/__tests__/read-endpoints-http.test.ts` | **New** | — | `E4EF0EA6AAFFC6CF8ED87A9CDD2735D65415821BC0CC531EBDE37C7C5B75AE95` | End-to-end HTTP tests for CORS and role-isolated read endpoints (2 tests). |
| `.env.example` | Modified | `369F604D...` | `5F82B961...` | Added `CORS_ALLOWED_ORIGINS` template variable. |

---

## 2. Unchanged Core Security Modules
- `src/auth/central-jwt.ts`: SHA-256 `154B970B30CC4BC74F0DBEBB63B38FD25526993722546F6569CC621A20AA0142` (preserved intact).
- `src/auth/identity-resolver.ts`: SHA-256 `BAD2B19F26DF85F536E1535EA9D81BC39938D27C92A0596C1E4F3C6208CD56DE` (preserved intact).
- `src/security/log-sanitizer.ts`: SHA-256 `9F7D9500E2F72BD763703CDFBA32C07F6D5938BFB79C39FD1D71E4458C938CB0` (preserved intact).
- `src/security/nonce-store.ts`: SHA-256 `55720FC4F0BB3D7A5885E72F4CAB6E667419890E6E0B12B622C75B5429C2ADDB` (preserved intact).
- `src/services/leave-service.ts`: SHA-256 `49D986C84A95F96E06C97B48D7D3BA7E0252BB5FF923FA83CA21D4CE438E0EAF` (preserved intact).
- `src/validation/leave-schemas.ts`: SHA-256 `A887855508EE8DE0BC47FBEE6B7521D71F38022882EA9C48AEC03686DB27FCEE` (preserved intact).
- All 6 original test files in `src/__tests__/`: Preserved intact (32 tests passing without relaxation).
