# AI Context / Handoff

## Repo + Paths
- **Git repo root:** `E:\fpv-enthusiast-app`
- **Actual app folder:** `E:\fpv-enthusiast-app\FPVEnthusiast`
- **Rule:** all Expo app code, Supabase functions, and migrations must be handled inside `FPVEnthusiast`
- **Rule:** git commands should be run from the repo root
- **Shell preference:** use **PowerShell-safe commands** only
  - Good: `Set-Location 'E:\fpv-enthusiast-app'`
  - Good: `Set-Location 'E:\fpv-enthusiast-app\FPVEnthusiast'`
  - Avoid: `cd /d ...`

## GitHub / Branch Rules
- **GitHub repo:** `https://github.com/HypnosFPV/fpv-enthusiast-app`
- **Default branch for current recovery work:** `fix/season-pass-recovery`
- **Expected workflow:** AI should make edits, commit them, push to GitHub, then give the user exact pull commands
- **Do not drift to a new branch** unless there is a strong reason

## Supabase Project
- **Project ref:** `iyjtdzcobdbzjonskpgi`
- **Project URL:** `https://iyjtdzcobdbzjonskpgi.supabase.co`

## Important Cautions
- **Do NOT run** `supabase db push`
- **Do NOT work from the repo root** when editing app files
- **Do NOT place new app files in the wrong directory**
- Be explicit about which folder each command must be run from
- Prefer exact, copy-paste PowerShell commands

## Current Feature Track
Season pass implementation and checkout recovery

## Completed / Confirmed Work
- Season pass work exists on branch `fix/season-pass-recovery`
- Edge functions deployed from the correct folder:
  - `create-season-pass-payment-intent`
  - `stripe-webhook`
- Manual SQL migration scripts already executed:
  - `20260403010000_season_pass_foundation.sql`
  - `20260403011000_season_pass_automation.sql`
- Added DB column:
  - `alter table public.users add column if not exists header_video_url text;`
- Confirmed app/backend state:
  - season screen loads
  - active season exists
  - XP awarding works

## Current Blocker
- Season pass purchase flow still fails during checkout init with:
  - `Invalid JWT`
- This occurs before purchase creation completes
- Likely tied to stale or invalid auth/session state, auth relay behavior, or project/session mismatch during Edge Function invocation

## Most Relevant Recent Commits on `fix/season-pass-recovery`
- `e70dde4` — Surface edge function checkout error details
- `572e6c2` — Refresh auth session before season checkout
- `2070964` — Validate auth sessions and harden season checkout auth
- `4579c1c` — Hard reset cached Supabase auth sessions

## Key Files To Read First After Refresh
1. `E:\fpv-enthusiast-app\FPVEnthusiast\src\context\AuthContext.tsx`
2. `E:\fpv-enthusiast-app\FPVEnthusiast\src\hooks\useSeasonPassCheckout.ts`
3. `E:\fpv-enthusiast-app\FPVEnthusiast\src\services\supabase.js`
4. `E:\fpv-enthusiast-app\FPVEnthusiast\app\season.tsx`
5. `E:\fpv-enthusiast-app\FPVEnthusiast\supabase\functions\create-season-pass-payment-intent\index.ts`
6. `E:\fpv-enthusiast-app\FPVEnthusiast\supabase\functions\stripe-webhook\index.ts`

## Expected Assistant Behavior
- Read the key files before proposing next steps
- Inspect git status / branch state before changing anything
- Stay focused on the current blocker unless the user explicitly switches focus
- If code edits are needed, make them, commit them, push them to GitHub, then provide:
  1. what changed
  2. commit hash
  3. exact pull commands
  4. exact next PowerShell commands
- If the user sends unrelated prompts, confirm whether to ignore them before changing focus

## Helpful PowerShell Commands
### Repo root
```powershell
Set-Location 'E:\fpv-enthusiast-app'
git fetch origin
git checkout fix/season-pass-recovery
git pull --ff-only origin fix/season-pass-recovery
```

### App folder
```powershell
Set-Location 'E:\fpv-enthusiast-app\FPVEnthusiast'
supabase functions deploy create-season-pass-payment-intent --project-ref iyjtdzcobdbzjonskpgi
npx expo start --clear
```

## Quick Refresh Prompt
Use this after chat refresh:

```text
Read AI_CONTEXT.md in the repo root first and continue from there. Repo root: E:\fpv-enthusiast-app. App folder: E:\fpv-enthusiast-app\FPVEnthusiast. GitHub repo: https://github.com/HypnosFPV/fpv-enthusiast-app. Always make edits yourself, commit, push to GitHub, then give me exact pull commands. Use branch fix/season-pass-recovery unless needed otherwise. Supabase project ref: iyjtdzcobdbzjonskpgi. Do NOT run supabase db push. Use PowerShell-safe commands only. Current blocker: season pass checkout fails with Invalid JWT.
```
