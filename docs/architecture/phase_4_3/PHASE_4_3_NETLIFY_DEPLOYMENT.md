# NEXUS HR — PHASE 4.3: NETLIFY DEPLOYMENT SPECIFICATION

## 1. Overview

This document specifies the deployment configuration and procedures for hosting the **NEXUS HR** Frontend Single Page Application on Netlify.

The application has been verified to build into standard static assets with zero external runtime dependencies.

---

## 2. Netlify Configuration Files

### 2.1 Root `netlify.toml`
Located at `D:\Antigravity_Projects\nexus-hr\netlify.toml`:

```toml
[build]
  base = "frontend"
  publish = "dist"
  command = "npm run build"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 2.2 Fallback `frontend/public/_redirects`
Copied automatically to `dist/_redirects` during Vite build:

```
/*    /index.html   200
```

This dual configuration ensures proper Single Page Application routing across direct URL access, browser reloads, and nested views without encountering 404 Not Found errors on Netlify CDN edges.

---

## 3. Build & Artifact Verification

| Parameter | Value | Verification Status |
| :--- | :--- | :---: |
| **Node.js Target** | `>= 18.0.0` (Local built with v20.18.0) | PASS |
| **Build Command** | `npm run build` (`tsc && vite build`) | PASS |
| **Output Directory** | `frontend/dist/` | PASS |
| **Bundle Size (JS)** | 370.78 kB (gzip: 98.09 kB) | PASS |
| **Bundle Size (CSS)** | 43.98 kB (gzip: 8.12 kB) | PASS |
| **HTML Entrypoint** | `dist/index.html` (720 bytes) | PASS |
| **Redirect Rules** | `dist/_redirects` present | PASS |

---

## 4. Environment Variables

The frontend application operates in standalone demo mode by default, requiring **zero mandatory environment variables** for immediate deployment and evaluation.

When ready to connect to the live Backend API Gateway in subsequent phases:

| Variable | Required in Phase 4.3 | Default / Example Value | Description |
| :--- | :---: | :--- | :--- |
| `VITE_API_BASE_URL` | No | `http://localhost:3000/api/v1` | URL of the Backend Gateway |
| `VITE_APP_ENV` | No | `production` | Deployment environment identifier |
| `VITE_ENABLE_MOCK` | No | `false` | Explicitly enables mock adapter |

---

## 5. Deployment Procedures for Phase 4.4

### Option A: Netlify CLI Manual Deploy (Preview / Production)
From `D:\Antigravity_Projects\nexus-hr\frontend`:

1. Authenticate Netlify CLI:
   ```bash
   npx netlify login
   ```
2. Deploy Preview:
   ```bash
   npx netlify deploy --dir=dist
   ```
3. Deploy to Production:
   ```bash
   npx netlify deploy --prod --dir=dist
   ```

### Option B: Git Continuous Deployment
1. Connect Git repository to Netlify Dashboard.
2. Set **Base directory**: `frontend`
3. Set **Build command**: `npm run build`
4. Set **Publish directory**: `dist`
5. Click **Deploy site**.

---

## 6. Pre-Flight Deployment Checklist

- [x] Package dependencies strictly locked in `package.json`.
- [x] TypeScript compilation passes with zero type errors (`tsc --noEmit`).
- [x] Vite build generates clean `dist` folder.
- [x] SPA rewrite rules configured for client-side navigation.
- [x] Responsive layout verified across desktop, tablet, and mobile breakpoints.
- [x] All 11 pages/views interactive and functional with mock state.
- [x] Role switcher enables seamless demonstration across `SUPERADMIN`, `BRANCH_MANAGER`, and `EMPLOYEE`.
- [x] No remote database credentials, secrets, or sensitive strings bundled into client JS.
