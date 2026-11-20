# NEXUS HR — PHASE 4.3.1: DESIGN SYSTEM ARCHITECTURE

## 1. Overview & Skill Applied

The design system for **NEXUS HR** was established using Antigravity's **`ui-ux-pro-max`** design intelligence skill (`C:\Users\DELL\.gemini\antigravity\skills\ui-ux-pro-max\`), generating the core design master specification (`D:\Antigravity_Projects\nexus-hr\design-system\nexus-hr\MASTER.md`).

The visual language follows modern enterprise SaaS principles:
- **Corporate Authority & Elegance:** Navy navigation shell (`#0B132B` / `#0F172A`) with refined neutral background (`#F8FAFC`).
- **High Information Density & Readability:** Generous text contrast (≥4.5:1), tight vertical rhythm (8px baseline scale), and tabular alignment for quantitative HR data.
- **Subtle Geometry & Layering:** Consistent corner radius (`rounded-xl` / 12px for cards, `rounded-lg` / 8px for controls), 1px solid borders (`#E2E8F0`), and restrained shadows (`shadow-xs` to `shadow-sm`) avoiding excessive floating card effects.

---

## 2. Color Palette & Semantic Tokens

| Token Role | Value (Hex) | Tailwind Class | Semantic Context |
| :--- | :--- | :--- | :--- |
| **Brand Primary** | `#2563EB` | `bg-blue-600` / `text-blue-600` | Primary buttons, active tabs, brand badge |
| **Brand Hover** | `#1D4ED8` | `hover:bg-blue-700` | Interactive hover transitions |
| **Sidebar Canvas** | `#0F172A` | `bg-slate-900` | Navigation drawer, persistent desktop sidebar |
| **Sidebar Header/Footer**| `#020617` | `bg-slate-950/60` | Fixed brand header, user session panel |
| **App Canvas Background**| `#F8FAFC` | `bg-slate-50` | Global page viewport canvas |
| **Card / Surface** | `#FFFFFF` | `bg-white` | Content containers, modal dialogs, data tables |
| **Surface Border** | `#E2E8F0` | `border-slate-200/80` | Subtle, accessible structural boundary |
| **Body Foreground** | `#0F172A` | `text-slate-900` | Primary titles, metrics, employee names |
| **Secondary Text** | `#64748B` | `text-slate-500` | Subtitles, helper text, table column labels |
| **Status: On Time / Success**| `#059669` | `bg-emerald-50 text-emerald-700` | On-time clock in, approved leave, active status |
| **Status: Late / Warning**| `#D97706` | `bg-amber-50 text-amber-700` | Late arrival, pending leave, probation |
| **Status: Danger / Rejected**| `#DC2626` | `bg-rose-50 text-rose-700` | Absent, rejected leave, account suspended |
| **Status: Special / Roster** | `#2563EB` | `bg-blue-50 text-blue-700` | Scheduled shift, PKWT contract |

---

## 3. Typography Hierarchy

The application standardizes on **Plus Jakarta Sans** (Google Fonts) for geometric readability across Latin characters and numbers:

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap');
font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
```

| Hierarchy Level | Font Size | Weight | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display H1** | `1.5rem` (24px) | ExtraBold (`800`) | `-0.025em` | Page header titles |
| **Section H2** | `1.125rem` (18px)| Bold (`700`) | `-0.015em` | Section headings, modal titles |
| **Card H3** | `0.875rem` (14px)| Bold (`700`) | Normal | Card headings, table item names |
| **Body Primary**| `0.875rem` (14px)| Medium (`500`) | Normal | Table cells, form inputs |
| **Caption / Meta**| `0.6875rem` (11px)| SemiBold (`600`)| `+0.025em` | Status badges, timestamps, helper text |
| **Numeric KPI** | `1.5rem` (24px) | ExtraBold (`800`) | Monospace | Headcount and attendance metrics |

---

## 4. Spacing, Rhythm & Geometry

- **Baseline Grid:** 4px / 8px systematic spacing rhythm.
- **Padding Tiers:**
  - `p-2.5` to `p-3` (10px–12px) for compact control toolbars.
  - `p-4` to `p-5` (16px–20px) for standard metric and content cards.
  - `p-6` (24px) for executive modals and setting cards.
- **Corner Radii:**
  - `rounded-2xl` (16px) for welcome banners and modal cards.
  - `rounded-xl` (12px) for content cards, inputs, and primary buttons.
  - `rounded-lg` (8px) for table badges, filter buttons, and pagination controls.
