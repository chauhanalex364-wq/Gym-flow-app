# GymFlow Production Build

Production-oriented GymFlow build using Supabase for persistent data/auth, Vercel-ready static deployment, and GitHub-ready source control.

## Supabase
- Project: `entergym-v3-production`
- URL: `https://ewqudthqqxwimjoicebe.supabase.co`
- Publishable key is embedded in `index.html`; never put a service-role key in the browser.
- Owner authentication uses Supabase Auth phone + password.
- Owner data is protected by RLS in `gymflow_profiles` and `gymflow_records`.
- Member 6-digit access is implemented through narrowly scoped security-definer RPCs because members are intentionally code-based rather than phone-auth users.
- Daily attendance is validated server-side against India date and duplicate check-ins.

## Features
- Owner login with mobile + 8-digit password
- GymFlow activation code `9A2L6E` for new owners
- Member CRUD and unique 6-digit member access codes
- Owner dashboard, members, payments, invoices, plans, attendance, workouts, diets, settings
- Daily QR attendance with camera/upload scanner
- Member onboarding/profile editing, health metrics, streaks, workouts and diet
- Persistent Supabase data instead of localStorage as the source of truth
- Responsive mobile UI

## Vercel
This project is a static site and includes `vercel.json`; it can be deployed directly from this folder or connected to a GitHub repository.

## GitHub
The source tree is ready to push to a private repository. No GitHub service token or Supabase service-role key is included.


## V2 upgrades
- Reference UI direction: Soft Neumorphism / Light Blue (image #02).
- PWA manifest + install flow + offline app shell via service worker.
- Browser + service-worker notifications with a focused notification center.
- Owner Payment Center: save gym UPI ID and generate exact-plan-price UPI Intent links.
- Member Plans: Buy Plan -> secure server-side order validation -> open UPI app.
- Online payment requests stay Pending until the gym owner confirms the payment in their UPI app; this avoids falsely marking a UPI payment as paid.
- Payment confirmation creates a payment record, invoice and membership renewal.
- WhatsApp API is intentionally not included in this version.
- New Supabase RPC: `gymflow_member_create_order` (server validates gym, member, plan and exact amount).

### UPI limitation
A `upi://pay` intent opens installed UPI apps on supported mobile browsers. The browser cannot reliably verify bank settlement by itself. The owner confirmation flow therefore records the request as Pending until the owner confirms the payment. For automatic bank reconciliation, a regulated payment gateway/webhook integration should be added later.

## Notification & engagement engine
- PWA Web Push registration is handled from the app after explicit notification permission.
- `gymflow-notifications` exposes `public-key`, `register`, `unregister`, `test`, `broadcast`, `tasks`, and scheduled `daily` actions.
- Supabase `pg_cron` runs the daily connection engine twice per day (morning/evening); duplicate daily slots are protected by a database unique index.
- Member copy is personalized from member name, streak, membership expiry, and recovery/connection context. The target is 1 meaningful morning + 1 meaningful evening notification per eligible member/day, not a high-volume stream.
- Owner receives a daily task summary push and has an in-app AI Tasks section with up to 7 data-driven priorities.
- Owner Broadcast Center supports a title, message, emoji and priority and sends to the gym's active member push subscriptions while retaining the message in the member notification center for devices without push permission.
- Invalid Web Push subscriptions are automatically deactivated after provider 404/410 responses.
- Notification history and delivery outcomes are persisted in Supabase.
- WhatsApp API is intentionally removed from this production version.

## PWA behavior
- Installable `manifest.json`, standalone display and 192/512px icons.
- `sw.js` provides the app shell cache, offline fallback for same-origin assets, Web Push handling and notification-click deep links.
- The app shows a soft permission UX rather than forcing browser permission immediately on first load.

## Owner smart tasks
The owner task engine is intentionally hybrid: it uses live gym data and deterministic priorities to identify dues, renewals, inactivity, onboarding gaps, attendance, plan setup and member-experience work. This keeps task generation fast and predictable while leaving room for a future optional LLM wording layer.

## Important production note
Web Push requires the member/owner to grant browser notification permission at least once on that device. A user who declines permission will still receive in-app notification history/broadcasts, but the browser cannot display push notifications for that device.

## AI Command Center
- Owner-only GymFlow AI Assistant is connected to the deployed Supabase Edge Function `gymflow-ai`.
- Supports English, Hindi and Hinglish language modes.
- AI is scoped to GymFlow and gym-management topics; unrelated questions are declined.
- Includes an in-repository 1,000-entry FAQ bundle for common software/gym questions and repeated wording.
- Live actions include member dues/attendance lookup, attendance marking, invoice creation, payment recording, membership renewal, member block/unblock and section navigation.
- Action results are returned to the frontend and reflected immediately in the visible dashboard without a duplicate write.
- AI requests are audit-logged in `public.gymflow_ai_logs` with the owner and gym scope.
- Optional OpenAI Responses API wording is supported when the backend `OPENAI_API_KEY` and `OPENAI_MODEL` secrets are configured; no model key is exposed in the browser.
- The assistant UI uses a processing state with animated progress dots and a polished light-blue neomorphic command sheet.

## Dashboard polish
- Animated 7-day revenue bars and attendance bars.
- Animated member-status donut visualization with live counts.
- Micro-interactions for cards, buttons, rows and fields.
- AI quick-control shortcuts are visible directly on the owner overview.
- Owner authentication uses the registered mobile number and 8-digit password; no sample account or sample gym records are shipped.

## Real-data finalization
- Removed sample member names, sample owner login hints, seeded demo identifiers and demo-only quick actions from the client bundle.
- Browser storage is only a temporary cache; owner data is reloaded from the gym-scoped Supabase records.
- Owner and member screens perform an automatic live refresh while the app is visible so recent server changes appear without a full page reload.
- Digital Member ID is generated from the live member record and includes current gym branding, member photo when available, plan, expiry, mobile, status and the unique access code. It can be printed or shared.
- Invoices are persisted as real gym records and include member, amount, payment method, date and note; they can be opened and printed/saved as PDF.
- Supabase production database check confirmed there are currently zero records for the retired `demo-gym` identifier.
