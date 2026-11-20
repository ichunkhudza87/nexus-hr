# NEXUS HR — STAGE 3 POST-EXECUTION VERIFICATION

**Target Project:** `nexus-central` (`wcmevigbqsmzsdqidjel`)  
**Cross-DB Reference:** `nexus-branch-a` (`uneycmbqqpkifwhwzbes`)  
**Seed Source:** `supabase/remediation/v2.7.1/002_central_seed_and_rollback_v2_7_1.sql` (Lines 9–64 only)  
**Verification Mode:** Read-Only SQL Inspection (`supabase_mcp:execute_sql`)  
**Timestamp:** `2026-11-12T22:30:28+07:00` to `2026-11-12T22:30:38+07:00`  
**Klasifikasi Akhir:** **`STAGE 3 VERIFIED — PHASE 3 COMPLETE`**

---

## 1. Verifikasi Data Branch

**SQL Query (`wcmevigbqsmzsdqidjel`):**
```sql
SELECT
  id,
  code,
  name,
  timezone,
  address,
  phone_number,
  is_active,
  created_at,
  updated_at
FROM public.branches
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
```

**Actual Result:**
```json
[
  {
    "id": "00000000-0000-0000-0000-000000000001",
    "code": "BRANCH-A",
    "name": "Branch A - Jakarta",
    "timezone": "Asia/Jakarta",
    "address": null,
    "phone_number": null,
    "is_active": true,
    "created_at": "2026-11-12 15:29:14.553472+00",
    "updated_at": "2026-11-12 15:29:14.553472+00"
  }
]
```

**Expected Result:** Exact match on `id`, `code = 'BRANCH-A'`, `name = 'Branch A - Jakarta'`, `timezone = 'Asia/Jakarta'`, `is_active = TRUE`, `address IS NULL`, `phone_number IS NULL`.

**Status:** **PASS**

---

## 2. Verifikasi Keunikan & Data Central Lainnya

**SQL Query (`wcmevigbqsmzsdqidjel`):**
```sql
SELECT
  (SELECT count(*) FROM public.branches) AS total_branches,
  (SELECT count(*) FROM public.branches WHERE id = '00000000-0000-0000-0000-000000000001'::uuid) AS uuid_cnt,
  (SELECT count(*) FROM public.branches WHERE code = 'BRANCH-A') AS code_cnt,
  (SELECT count(*) FROM public.user_profiles) AS user_profiles_cnt,
  (SELECT count(*) FROM public.employee_directory) AS employee_directory_cnt;
```

**Actual Result:**
```json
[
  {
    "total_branches": 1,
    "uuid_cnt": 1,
    "code_cnt": 1,
    "user_profiles_cnt": 0,
    "employee_directory_cnt": 0
  }
]
```

**Expected Result:** Tepat satu row dengan UUID `00000000-0000-0000-0000-000000000001`, tepat satu row dengan `code = 'BRANCH-A'`, tidak ada konflik UUID/kode, dan `user_profiles` (`0`) serta `employee_directory` (`0`) tetap tidak berubah.

**Status:** **PASS**

---

## 3. Verifikasi Integritas Constraint `public.branches`

**SQL Query (`wcmevigbqsmzsdqidjel`):**
```sql
SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conrelid = 'public.branches'::regclass
  AND contype IN ('p', 'u')
ORDER BY contype, conname;
```

**Actual Result:**
```json
[
  {"constraint_name":"branches_pkey","constraint_type":"p","constraint_def":"PRIMARY KEY (id)"},
  {"constraint_name":"uq_branches_code","constraint_type":"u","constraint_def":"UNIQUE (code)"}
]
```

**Expected Result:** Primary key `PRIMARY KEY (id)` dan unique constraint `UNIQUE (code)` aktif pada `public.branches`.

**Status:** **PASS**

---

## 4. Cross-Database Consistency (`nexus-central` vs `nexus-branch-a`)

**SQL Query (`uneycmbqqpkifwhwzbes`):**
```sql
SELECT
  id,
  branch_code,
  branch_name,
  operating_timezone,
  is_active
FROM public.branch_config
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
```

**Actual Result (`nexus-branch-a`):**
```json
[
  {
    "id": "00000000-0000-0000-0000-000000000001",
    "branch_code": "BRANCH-A",
    "branch_name": "Branch A - Jakarta",
    "operating_timezone": "Asia/Jakarta",
    "is_active": true
  }
]
```

| Field | `nexus-central` (`public.branches`) | `nexus-branch-a` (`public.branch_config`) | Match |
|---|---|---|---|
| Singleton UUID | `00000000-0000-0000-0000-000000000001` | `00000000-0000-0000-0000-000000000001` | YES |
| Branch Code | `BRANCH-A` | `BRANCH-A` | YES |
| Branch Name | `Branch A - Jakarta` | `Branch A - Jakarta` | YES |
| Timezone | `Asia/Jakarta` | `Asia/Jakarta` | YES |
| Active Status | `true` | `true` | YES |

**Status:** **PASS**

---

## Klasifikasi Akhir

**`STAGE 3 VERIFIED — PHASE 3 COMPLETE`**
