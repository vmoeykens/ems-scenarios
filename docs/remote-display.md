# Student display on another device

The instructor console can stream the student display to a second device (tablet, laptop, TV browser) through a
realtime broker. The app is still static (GitHub Pages) and stateless: the broker only relays messages between
devices in a room; nothing is stored. Only `toDisplay()` snapshots (crew-safe content) and small hello / ping / bye
control messages cross it.

## How it works

- Console: **Other device** button > **Start remote display** makes a 6-digit room code and shows a QR code and link.
  The room is kept in this browser, so a console reload stays paired. **New code** rotates it.
- Display device: scan the QR code / open the link (`#/display/<code>`), or go to `#/join` and type the code.
  The badge on the display shows LINKED / CONNECTING / RECONNECTING.
- The same-browser window (**Student screen**) still works with no network, exactly as before.
- Transport: Supabase Realtime **broadcast** on channel `scenario-runner:<room>` (`src/lib/sync/supabase.ts`), behind
  the `SyncTransport` interface (`src/lib/sync/transport.ts`). The Supabase client is loaded lazily, only when used.

## Setup (hosted Supabase)

1. In the Supabase dashboard: Project Settings > API (or "API Keys"). Copy the **Project URL** and the
   **publishable key** (`sb_publishable_...`; the legacy `anon` key also works). Both are public by design.
   Never use the `service_role` / secret key.
2. Realtime is on by default. Under Realtime settings, leave "Allow public access" on (this app uses public
   broadcast channels, no database tables, no auth).
3. Build default (recommended): GitHub repo > Settings > Secrets and variables > Actions > **Variables**:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_KEY` = the publishable key

   The Pages workflow passes them to `npm run build`. Re-run the workflow (or push) after adding them.
4. Or, without a rebuild: open **Other device > Broker settings** in the app and paste the URL and key. They are saved
   in that browser, and pairing links carry them to the display device (the QR code works on a fresh device).

Free-tier limits are far above what one training run uses (a few messages per instructor action plus one ping every
10 s per display). Snapshots are kept under 64 KB (checked in `tests/display.test.ts`).

## Self-hosted broker (later)

Easiest path: run **Supabase Realtime** yourself (the `supabase/realtime` image, or the self-hosted Supabase
docker-compose), behind your reverse proxy with TLS (`wss://` is required: the app is served over HTTPS). Then put
its URL and key in Broker settings or the build variables; no code change.

Other brokers (Mosquitto / MQTT over WebSockets, Soketi, Centrifugo) need a new adapter implementing `SyncTransport`
(`connect(room)`, `send`, `onMessage`, optional `onStatus`, `close`) plus a `kind` in `BrokerConfig`
(`src/lib/sync/config.ts`). The console and display code only talk to the interface.

## Security notes

- Anyone with the room code and broker key could watch the display or push fake display state into that room.
  Content is simulated training data only; rotate the code with **New code** if needed.
- Instructor-only content never leaves the console: the leak test covers every scenario, and the remote e2e test
  checks every relayed message.

## Tests

- `tests/sync.test.ts`: config / link encoding, room codes, routes, presence, the Supabase transport against a fake client.
- `e2e/remote.spec.ts`: two browser contexts ("devices") using the real supabase-js client against an in-test fake
  Realtime server (`e2e/fakeRealtime.ts`): pairing by link and by typed code, live vitals and cards, display reload,
  console reload keeps the room.
