/**
 * Settings section: Remote access - reach this studio from another device over a private, encrypted
 * link (the embedded Tailscale sidecar). Its own richly-styled page, NOT the plain settings rows. It
 * polls the sidecar state and drives Enable / Turn-off; the server opens the Tailscale sign-in page for
 * the user, so the whole flow lives inside Bunzai, never a terminal.
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { AppContext } from "../../../app-contract";
import type { RemoteDevice, RemoteState } from "../../../remote/sidecar-status";
import { apiStatusIs } from "../../../_shared/api-fetch";
import { copyText } from "../../../_shared/clipboard";
import { FLASH_MS, useFlash } from "../../../_shared/use-flash";
import { requestExternal } from "../../../_shared/link-gate";
import { useVisibleInterval } from "../../../_shared/use-visible-interval";
import { SETTING_KEYS } from "../../../../studio/settings-shape";
import type { SettingsSection } from "../section-contract";
import { LanCard } from "./lan-card";
import { HelperInstalledLine, HelperMissingCard, useHelper, type HelperControls } from "./helper-card";
import { mask } from "./redact";
import { Button, IconButton } from "../../../components/button";
import styles from "./remote-access.module.css";
import { Ic } from "../../../_shared/ic";

/** Eye (details shown) / eye-with-slash (details hidden), for the screenshot-redaction toggle. */
function EyeIcon({ off }: { off: boolean }): JSX.Element {
  return <Ic name={off ? "lucide:eye-off" : "lucide:eye"} size={16} />;
}

function LockIcon(): JSX.Element {
  return <Ic name="lucide:lock" size={14} className={styles.lock} />;
}

interface Actions {
  enable: () => void;
  disable: () => void;
  copyLink: () => void;
  openHttpsSettings: () => void;
  kick: (nodeId: string) => void;
  devices: RemoteDevice[];
  busy: boolean;
  copied: boolean;
  /** the downloadable mesh helper: its status, and the one action that fetches it */
  helper: HelperControls;
}

/** The Tailscale admin page where HTTPS certificates are enabled (the one-time toggle). */
const TAILSCALE_HTTPS_ADMIN = "https://login.tailscale.com/admin/dns";

function StateCard({
  state,
  a,
  redacted,
}: {
  state: RemoteState;
  a: Actions;
  redacted: boolean;
}): JSX.Element {
  switch (state.phase) {
    case "off":
      return (
        <div className={`${styles.card} ${styles.hero}`}>
          <div className={styles.cardTitle}>Turn on remote access</div>
          <div className={styles.cardBody}>
            Bunzai stays on your machine. A private, encrypted link lets your own devices reach it, with
            no router changes and no ports opened. You sign in to Tailscale once (free); we open that page
            for you.
          </div>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" disabled={a.busy} onClick={() => a.enable()}>
              Enable remote access
            </Button>
          </div>
          <HelperInstalledLine h={a.helper} />
        </div>
      );
    case "unavailable":
      return <HelperMissingCard detail={state.detail} h={a.helper} />;
    case "starting":
      return (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Bringing up the private link</div>
          <span className={styles.status}>
            <span className={`${styles.dot} ${styles.busy}`} />
            Starting. This is quick.
          </span>
        </div>
      );
    case "needs-login": {
      const signInUrl = state.signInUrl;
      return (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Sign in to Tailscale</div>
          <div className={styles.cardBody}>
            A Tailscale sign-in page just opened in your browser. Sign in once (free), then come back here.
            This reconnects on its own.
          </div>
          <div className={styles.actions}>
            <span className={styles.status}>
              <span className={`${styles.dot} ${styles.busy}`} />
              Waiting for sign-in
            </span>
            {signInUrl && (
              <Button size="sm" variant="quiet" onClick={() => requestExternal(signInUrl, "Tailscale sign-in")}>
                Open sign-in again
              </Button>
            )}
          </div>
        </div>
      );
    }
    case "needs-https":
      return (
        <div className={styles.card}>
          <div className={styles.cardTitle}>One more setup step: turn on HTTPS</div>
          <div className={styles.cardBody}>
            Tailscale needs HTTPS certificates enabled for your account, a one-time switch. Open your
            Tailscale settings, turn on <b>HTTPS Certificates</b>, and this connects on its own, you do not
            need to come back here and click anything.
          </div>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" onClick={() => a.openHttpsSettings()}>
              Open Tailscale HTTPS settings
            </Button>
            <span className={styles.status}>
              <span className={`${styles.dot} ${styles.busy}`} />
              Waiting for HTTPS to be turned on
            </span>
          </div>
        </div>
      );
    case "connected":
      return (
        <div className={`${styles.card} ${styles.hero}`}>
          <div className={styles.cardTitle}>
            <span className={styles.status}>
              <span className={`${styles.dot} ${styles.on}`} />
              On, reachable
            </span>
          </div>
          <div className={styles.cardBody}>
            Open this link on any device signed into the same Tailscale account, your phone, another
            computer. It is a real, trusted https link with no certificate warnings.
          </div>
          {state.url && (
            <span className={styles.urlbar}>
              <LockIcon />
              {redacted ? mask(state.url) : state.url}
            </span>
          )}
          <div className={styles.actions}>
            {state.url && (
              <Button size="sm" onClick={() => a.copyLink()}>
                {a.copied ? "Copied" : "Copy link"}
              </Button>
            )}
            <Button size="sm" variant="danger" disabled={a.busy} onClick={() => a.disable()}>
              Turn off
            </Button>
          </div>
          <div className={styles.subtle}>
            To add a device: install the free Tailscale app on it, sign in with the same account, then open
            the link above.
          </div>
          {a.devices.length > 0 && (
            <div className={styles.devices}>
              <div className={styles.devicesTitle}>Connected devices</div>
              {a.devices.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (d) => (
                <div key={d.nodeId} className={styles.deviceRow}>
                  <span className={styles.deviceName}>
                    {redacted ? mask(d.name || d.nodeId) : d.name || d.nodeId}
                  </span>
                  <Button size="sm" variant="danger" onClick={() => a.kick(d.nodeId)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case "error":
      return (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Remote access could not start</div>
          <span className={`${styles.status} ${styles.bad}`}>
            <span className={styles.dot} />
            {state.error ?? "Something stopped the link from coming up."}
          </span>
          <div className={styles.cardBody}>Nothing else in Bunzai is affected.</div>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" disabled={a.busy} onClick={() => a.enable()}>
              Try again
            </Button>
          </div>
        </div>
      );
    default:
      return assertNever(state.phase);
  }
}

const assertNever = (x: never): never => {
  throw new Error(`remote-access: unhandled phase ${JSON.stringify(x)}`);
};

function RemoteAccessSection({ ctx }: { ctx: AppContext }): JSX.Element {
  const [state, setState] = useState<RemoteState>({ phase: "off" });
  const [busy, setBusy] = useState(false);
  const [managedElsewhere, setManagedElsewhere] = useState(false);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [redacted, setRedacted] = useState(false);
  // The status poll discovers installation; mesh starts only through the separate Enable action.
  const helper = useHelper(ctx);

  // STILL A POLL, NOT YET A PUSH: the sidecar raises no in-process
  // event for a connect/disconnect, so a push route is its own change, not this one. What moved:
  // the poll stops the moment the tab is hidden (useVisibleInterval), not only never.
  const aliveRef = useRef(true);
  const poll = async (): Promise<void> => {
    try {
      const s = await ctx.api.remoteStatus();
      if (!aliveRef.current) return;
      setState(s);
      setManagedElsewhere(false);
      if (s.phase === "connected") {
        const d = await ctx.api.remoteDevices().catch(() => [] as RemoteDevice[]);
        if (aliveRef.current) setDevices(d);
      } else {
        setDevices([]);
      }
    } catch (e) {
      // A 403 here means this is a tailed-in (remote) session: management is host-only.
      // Structural, not `instanceof`: this app is its own bundle, so the shell's error class is
      // not this one's - the check read false forever and the host-only notice never appeared.
      if (aliveRef.current && apiStatusIs(e, 403)) setManagedElsewhere(true);
    }
  };
  useEffect(() => {
    aliveRef.current = true;
    void poll();
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll closes over ctx freshly each render
  }, [ctx]);
  useVisibleInterval(() => void poll(), 1500);

  const enable = (): void => {
    setBusy(true);
    ctx.api
      .remoteEnable()
      .then(setState)
      .catch(() => {}) // the poll recovers the true state
      .finally(() => setBusy(false));
  };
  const disable = (): void => {
    setBusy(true);
    ctx.api
      .remoteDisable()
      .then(setState)
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const { value: copiedFlash, flash } = useFlash<true>(FLASH_MS.copy);
  const copied = copiedFlash === true;
  const copyLink = (): void => {
    if (!state.url) return;
    void copyText(state.url).then((ok) => { if (ok) flash(true); });
  };
  const openHttpsSettings = (): void => {
    requestExternal(TAILSCALE_HTTPS_ADMIN, "Tailscale HTTPS settings");
  };
  const kick = (nodeId: string): void => {
    void ctx.api
      .remoteKick(nodeId)
      .then(() => ctx.api.remoteDevices())
      .then((d) => setDevices(d))
      .catch(() => {});
  };

  return (
    <div className={styles.wrap}>
      <div>
        <div className={styles.titleRow}>
          <IconButton
            size="sm"
            aria-pressed={redacted}
            label={redacted ? "Show details" : "Hide details for a screenshot"}
            icon={<EyeIcon off={redacted} />}
            onClick={() => setRedacted((v) => !v)}
          />
        </div>
        {/* The sign-in sentence is a promise only the mesh path can keep. When that path is absent from
            this build, LAN mode is what remains and it needs no account at all, so saying otherwise
            would send a user looking for a sign-up they do not need. */}
        <div className={styles.blurb}>
          {state.phase === "unavailable" ? (
            <>
              Reach this studio from your phone or another computer on the same network. Off by default,
              and no account needed.
            </>
          ) : (
            <>
              Reach this studio from your phone or another computer, over a private, encrypted link. Off by
              default. Turning it on needs a one-time free Tailscale sign-in, Bunzai opens that page for
              you.
            </>
          )}
        </div>
      </div>
      {managedElsewhere ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Managed on the host device</div>
          <div className={styles.cardBody}>
            You are connected to this studio remotely. Remote access is turned on or off, and devices are
            managed, only on the computer actually running Bunzai, never from a device that connected in.
            Open Bunzai on that computer to change these settings.
          </div>
        </div>
      ) : (
        <StateCard
          state={state}
          a={{
            enable,
            disable,
            copyLink,
            openHttpsSettings,
            kick,
            devices,
            busy,
            copied,
            helper,
          }}
          redacted={redacted}
        />
      )}
      <LanCard ctx={ctx} hidden={managedElsewhere} redacted={redacted} />
    </div>
  );
}

const section: SettingsSection = {
  id: "remote-access",
  act: "house",
  title: "Remote access",
  lede: "",
  protectedNote: "Managed only on the computer actually running Bunzai, never from a device that connected in.",
  status: (ctx) => (ctx.prefs.get(SETTING_KEYS.remoteAccessEnabled) === true ? "On" : "Off"),
  label: "Remote access",
  order: 85,
  Component: RemoteAccessSection,
};

export default section;
