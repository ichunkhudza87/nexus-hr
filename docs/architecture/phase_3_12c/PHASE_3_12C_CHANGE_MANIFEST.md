# NEXUS HR — PHASE 3.12C CHANGE MANIFEST

**Workspace:** `D:\Antigravity_Projects\nexus-hr`  
**Pre-Remediation Backup Verified:** `docs/architecture/phase_3_12c/pre_remediation_backup/` (`20` files: snapshot of all 19 `gateway/src/` files + `PHASE_3_12A_REMEDIATION_V2_6.sql`)

---

## 1. Modified Files (Before / After SHA-256)

| File Path | Original SHA-256 | Planned / Applied Modification | Reason | Final SHA-256 |
|---|---|---|---|---|
| `gateway/src/types/domain.ts` | `37BC2159B57DE53BC7E644D1D6F1DD9CE83F1DAE981E0DAD1823125752376E51` | Add `CANONICAL_ACTOR_PAYLOAD_VERSION` (`'v2.7'`), `activatedAt` & `expiresAt` on `HmacSigningKeyRecord` | B-1 canonical versioning & key expiry metadata | `51D297614E71E57977228836AF789913B8ED429F0119A0DBFE3CEABE6EF5EB46` |
| `gateway/src/config/env.ts` | `262C21A79246256B40214A00F5A963188D6ABE54F07C3DABC11563EB999429F1` | Validate `KEY_ID_REGEX`, parse `activatedAt`/`expiresAt`, reject expired keys at startup | B-1 key format & expiration validation | `E3F09D16DAA82D36EC629B1C84F3E7D129035254AF061D5F501DF8B9E7D01BA2` |
| `gateway/src/security/hmac-signer.ts` | `DF7D78087C6883DE74F6D51A7241BE5C3A079A1FC23BB78BB407F2E512BC46C7` | Implement v2.7 12-field canonical payload (`v2.7\|keyId\|...`), `keyId`/email sanitization, `expiresAt` grace window, legacy `buildCanonicalActorPayloadV26` reference | B-1 canonical `key_id` binding & rotation/revocation | `978003648E6E13309168C6C3C14B7BE68BA0300AA678ED334DFFBC0ACCBC80CD` |
| `gateway/src/clients/branch-rpc-client.ts` | `8DD1C33B2C88525DE89BB671FD01FEB8FFBEA5FB86E50CEA865F244C80C8C9DD` | Propagate `p_key_id`, send tri-state `p_set_*` flags for `CORRECTION`, differentiate `504` timeout & `502` malformed JSON | B-1, B-2 & wire resilience | `545B80A2BF6E6488BF5FF80113A3976B197C614DE6128ABAE3534404EB4143E7` |
| `gateway/src/clients/central-client.ts` | `CF425BE67E8FAB7139737EE8A68EEE763C62C46EE4818AE4FCB11985F4CB9978` | Differentiate `504` timeout vs `502` malformed JSON vs `503` unreachable | Wire error clarity & resilience | `8B3AA7A41CF926FD7A0696FE61B80B0B048489E007CB9F8FD4E35E43986A0FC6` |
| `gateway/src/validation/leave-schemas.ts` | `685CC7F9DA40964817FE0B9DB4A29E14CDDD0F41DF292E971E2177A52D84E42D` | Add `p_key_id`/`p_set_*` forbidden keys, real calendar date checks, NOT NULL `null` rejection, explicit tri-state handling & `CORRECTION` emptiness check | B-2 partial correction integrity & anti-tampering | `A887855508EE8DE0BC47FBEE6B7521D71F38022882EA9C48AEC03686DB27FCEE` |
| `gateway/src/security/nonce-store.ts` | `2645EEA96C3A7B02CB7F4C699675C5B48AD63ED0551B8CCEF90C528E35CDC166` | Fix `out:` lookup prefix bug, guard `out` namespace, optimize prune frequency, add injectable `uuidFn` | B-4 collision fix & namespace isolation | `55720FC4F0BB3D7A5885E72F4CAB6E667419890E6E0B12B622C75B5429C2ADDB` |
| `gateway/src/auth/central-jwt.ts` | `65D834FCD7679C735C5A292561C9E7E5FB3B72C08A467A16A2299DF2AE84C887` | Add single-flight `inFlightRefresh` (including concurrent unknown-`kid` misses), per-`kid` cooldown, multi-key omitted-`kid` check | F-04 JWKS rotation & DoS hardening | `154B970B30CC4BC74F0DBEBB63B38FD25526993722546F6569CC621A20AA0142` |
| `gateway/src/app.ts` | `CCCB9D9BB54F9F65DEBD7CE7C9A3B55F8297F88CB2C6BADEBBC4D21FDBB3AF31` | Authenticate Bearer JWT before consuming optional `X-Request-Nonce`; document single-process scope | F-05 unauthenticated NonceStore eviction defense | `6AB09FC5A56493FC899FCAD0A7DD6F4AE5650CA7727CF2BC8E9385BF5F59EB3C` |
| `.env.example` | `79D04EEBB3AE258CD31ADDE2F6098781779C8FD4810201434B46C2539A031669` | Document UTF-8 parity & `activatedAt`/`expiresAt` JSON key ring fields (placeholders only) | F-09 operational clarity (no real secrets) | `3601E7876BAAC57A188F5671439744CB16EA847532DAF9A31FFD60F25A53C6FC` |
| `gateway/src/__tests__/central-jwt.test.ts` | `53314B92282296F8CC0EB8FDBDB2ACADBDCE4CC73830A7D96CC7FAB4D1165C2C` | Add single-flight concurrency, unknown-`kid` rotation, omitted-`kid`, and 503 outage tests | F-04 verification | `1E1682FC53845142CF89781B54405E38FB573778194814651484F4F839976CE2` |
| `gateway/src/__tests__/env-config.test.ts` | `E9E5C348DCC8109A5BD741B5E21C51A31ABFB67D767EABD2084D6AE2E40D8EB0` | Add expired key & pipe `keyId` rejection tests | B-1 config hardening | `4FDF7B49A58F6E2B2283051693934DC8A2E27BC0050290D4A804CA66FD9E2F2A` |
| `gateway/src/__tests__/hmac-and-nonce.test.ts` | `F9B6323695105B6959E11D050D55789CB5E87D60E7456592EAFEFEC96BA9DDD7` | Update to v2.7 canonical 12-field tests + v2.6 rejection + rotation/grace/revocation/collision/concurrency tests | B-1 & B-4 verification | `A8D4F45581A8BB7767CFEEDC3C9EB876848B98E7CD6011FEF2EB91D126BF69A3` |
| `gateway/src/__tests__/leave-service-http.test.ts` | `E60F9390B58B410366A17204A2CA3BDAFE23AE217FD6D5D44E87849293C79CB5` | Stateful mock DB row tests for partial `CORRECTION`, omitted vs explicit `null`, constraint rollback, forged `p_*` keys | B-2 regression coverage | `9EB6775B003CF6D3A34B2F88609E91994155902FA37CA7A97A5FBA4602E08958` |

---

## 2. Newly Created Code & SQL Draft Files

| File Path | Purpose | SHA-256 |
|---|---|---|
| `gateway/src/__tests__/http-clients-wire.test.ts` | Local loopback HTTP wire-level test suite (`HttpCentralClient`, `HttpBranchAClient`, `mapPostgrestError`, timeouts, malformed JSON) | `18916386BB2821A38B079EAD83C2EA8E8A5C165F0335732D6E177B34D000672D` |
| `supabase/remediation/v2.7/001_branch_a_security_remediation_v2_7.sql` | Branch A v2.7 security remediation SQL draft (unexecuted) | `7F062E115B7A680C9913579072B3BE1694F374F6EA4E7988D0363E38C4EC5CB4` |
| `supabase/remediation/v2.7/002_central_seed_and_rollback_v2_7.sql` | Central BRANCH-A seed + reference `FOR UPDATE` rollback draft (unexecuted) | `8C60141CF1660F7E2D3102590A07586C6824E8647EEBA99F5DED0E13F8A6DB81` |
| `supabase/remediation/v2.7/SQL_V2_7_CHANGELOG.md` | Delta specification from v2.6 -> v2.7 | `F6960A1858C19AB615FC0A903EC61BE8C9BDC7455DEB5797ECBA1D685C0C6D87` |
| `supabase/remediation/v2.7/SQL_V2_7_CONTRACT.md` | Canonical v2.7 wire contract, rotation & nonce ops, object inventory | `12298488AABB8426655CA55FBBD1B6D0568E676598125894C1753BA57D90B82E` |
| `supabase/remediation/v2.7/SQL_V2_7_ROLLBACK_PLAN.md` | Symmetric rollback SQL for Central & Branch A | `A64B98682D98B8D166CC35E5A9C33FB86551E2689B34E80411FA79D373863C6C` |

---

## 3. Unchanged Source & Protected Baseline Migrations

| File Path | Status | Verified SHA-256 |
|---|---|---|
| `supabase/migrations/001_central_schema.sql` | **UNCHANGED** | `02447A8F2923ED49235DDD77D5EED33D47B0E023F0108A6495BDD7CC1C9C0260` |
| `supabase/migrations/002_branch_a_schema.sql` | **UNCHANGED** | `F1C8960FA8504E6AC9DD134FAC9BE68768DBDAF33FAED4A5B3F402D541874EC1` |
| `gateway/src/index.ts` | Unchanged | `E078195CA6F992C6226E3863889B23758FE4E4C7231D456F669F07F3D9674BA2` |
| `gateway/src/auth/identity-resolver.ts` | Unchanged | `BAD2B19F26DF85F536E1535EA9D81BC39938D27C92A0596C1E4F3C6208CD56DE` |
| `gateway/src/errors/gateway-error.ts` | Unchanged | `773ABD269D618E89F2EDF3CE3D2280C6BA8462F4E020A49BED15A9F976C8D93F` |
| `gateway/src/security/log-sanitizer.ts` | Unchanged | `9F7D9500E2F72BD763703CDFBA32C07F6D5938BFB79C39FD1D71E4458C938CB0` |
| `gateway/src/services/leave-service.ts` | Unchanged | `49D986C84A95F96E06C97B48D7D3BA7E0252BB5FF923FA83CA21D4CE438E0EAF` |
| `gateway/src/__tests__/identity-resolver.test.ts` | Unchanged | `B1CA6D08EB4D523FBC5822EDBC92A2508DBE36BD28DC7116F743E81EC172DA12` |


