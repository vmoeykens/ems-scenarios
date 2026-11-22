// "Other device" pairing: shows the room code, a QR code and the link a second device opens to become the
// student display. Broker settings live here too (build default, or a URL/key saved in this browser).
import { useState } from "react";
import { useRun } from "../state/RunContext.tsx";
import { buildDefault, displayHash, normalizeUrl, validConfig } from "../lib/sync/config.ts";
import { href } from "../lib/router.ts";
import { Modal } from "./primitives.tsx";
import { QR } from "./QR.tsx";

export function pageBase(): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

const STATUS: Record<string, string> = {
  idle: "off",
  connecting: "connecting...",
  connected: "connected to broker",
  error: "cannot reach broker",
};

export function RemoteButton() {
  const { remote } = useRun();
  const [open, setOpen] = useState(false);
  const on = remote.room && remote.status === "connected";
  return (
    <>
      <button type="button" className="sheet-btn" onClick={() => setOpen(true)} data-testid="open-remote" title="Show the student display on another device (tablet, TV, laptop)">
        Other device
        <span className={`ml-1 text-xs ${remote.devices ? "font-bold" : "text-rule"}`}>{remote.room ? (remote.devices ? `(${remote.devices})` : on ? "(waiting)" : "(...)") : "(off)"}</span>
      </button>
      {open && <RemotePanel onClose={() => setOpen(false)} />}
    </>
  );
}

export function RemotePanel({ onClose }: { onClose: () => void }) {
  const { remote, startRemote, stopRemote, rotateRoom } = useRun();
  const [settings, setSettings] = useState(!remote.config);
  const link = remote.room ? `${pageBase()}${displayHash(remote.room, remote.config)}` : "";
  const joinUrl = `${pageBase()}${href.join()}`;

  return (
    <Modal title="Student display on another device" onClose={onClose}>
      {!remote.config ? (
        <p className="text-sm mb-2">No broker is set up for this copy of the app. Add the Supabase project URL and publishable key below (or set them at build time, see docs/remote-display.md).</p>
      ) : !remote.room ? (
        <div className="flex flex-col gap-2 mb-2">
          <p className="text-sm">Make a room code, then open the link (or scan the QR code) on the device the crew will watch. Only the student display content is sent; nothing is stored.</p>
          <button type="button" className="sheet-btn font-bold" onClick={startRemote} data-testid="remote-start">
            Start remote display
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-2" data-testid="remote-panel">
          <div className="flex gap-3 items-start">
            <QR data={link} size="11rem" label="Scan on the display device" />
            <div className="flex flex-col gap-1 min-w-0">
              <div className="text-xs">Room code</div>
              <div className="text-4xl font-bold tracking-widest" data-testid="remote-room">
                {remote.room}
              </div>
              <div className="text-xs">
                or type it at <span className="underline break-all">{joinUrl}</span>
              </div>
              <div className="text-sm mt-1" data-testid="remote-status" data-status={remote.status}>
                Broker: <b>{STATUS[remote.status]}</b>
                {remote.detail ? ` (${remote.detail})` : ""}
                <br />
                Displays linked: <b>{remote.devices}</b>
              </div>
            </div>
          </div>
          <input className="border border-rule text-xs px-1 min-h-8 w-full" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Display link" data-testid="remote-link" />
          <div className="flex gap-1 flex-wrap">
            <button type="button" className="sheet-btn" onClick={() => void navigator.clipboard?.writeText(link)}>
              Copy link
            </button>
            <button
              type="button"
              className="sheet-btn"
              onClick={() => {
                if (confirm("Make a new room code? Linked devices will have to re-join.")) rotateRoom();
              }}
            >
              New code
            </button>
            <button type="button" className="sheet-btn" onClick={stopRemote} data-testid="remote-stop">
              Stop
            </button>
          </div>
        </div>
      )}
      <button type="button" className="text-sm underline" onClick={() => setSettings((v) => !v)}>
        {settings ? "Hide" : "Broker"} settings
      </button>
      {settings && <BrokerSettings />}
    </Modal>
  );
}

function BrokerSettings() {
  const { remote, setBroker } = useRun();
  const def = buildDefault();
  const [url, setUrl] = useState(remote.config?.url ?? "");
  const [key, setKey] = useState(remote.config?.key ?? "");
  const cand = { kind: "supabase" as const, url: normalizeUrl(url), key: key.trim() };
  const ok = validConfig(cand);
  return (
    <form
      className="flex flex-col gap-1 mt-1 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) setBroker(cand);
      }}
    >
      <p className="text-xs">
        Supabase Realtime (hosted, or self-hosted later). The key is the project's public publishable / anon key, which is safe in front-end code. Saved in this browser only; pairing links carry it to the display device.
        {def ? " Build default is set." : " No build default."}
      </p>
      <label>
        URL
        <input className="border border-ink w-full min-h-9 px-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" data-testid="broker-url" />
      </label>
      <label>
        Publishable key
        <input className="border border-ink w-full min-h-9 px-1" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_... or anon key" data-testid="broker-key" />
      </label>
      <div className="flex gap-1">
        <button type="submit" className="sheet-btn font-bold" disabled={!ok} data-testid="broker-save">
          Save
        </button>
        {def && (
          <button type="button" className="sheet-btn" onClick={() => setBroker(null)}>
            Use build default
          </button>
        )}
      </div>
    </form>
  );
}
