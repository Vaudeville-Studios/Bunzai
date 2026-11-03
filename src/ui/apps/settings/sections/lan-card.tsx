/**
 * LAN mode card for the Remote access tab: the connect-code + host-approval path for reaching the studio
 * from devices on the same network without a Tailscale account. Host-only, it polls /api/remote/lan/*,
 * which is refused on any tailed-in listener. Rendered null when the parent detects a remote session.
 *
 * STILL A POLL, NOT YET A PUSH. the scale design asks for push here (another device's
 * connect or approval is server-side state this window did not cause); the server raises no
 * in-process event for it today, and wiring one through the Go sidecar is its own change. What
 * moved: the poll now stops the moment the tab is hidden, not only when the section is closed
 * (`useVisibleInterval`), instead of ticking every 1.5s in a backgrounded window all day.
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { AppContext } from "../../../app-contract";
import type { LanStatus } from "../../../remote/sidecar-status";
import { useVisibleInterval } from "../../../_shared/use-visible-interval";
import { mask } from "./redact";
import { Button } from "../../../components/button";
import styles from "./remote-access.module.css";
import { toErrorMessage } from "../../../_shared/error-message";

const OFF: LanStatus = { on: false, code: "", url: "", fingerprint: "", pending: [], connected: [] };

export function LanCard({
  ctx,
  hidden,
  redacted,
}: {
  ctx: AppContext;
  hidden: boolean;
  redacted: boolean;
}): JSX.Element | null {
  const [lan, setLan] = useState<LanStatus>(OFF);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const poll = async (): Promise<void> => {
    try {
      const s = await ctx.api.remoteLanStatus();
      if (aliveRef.current) setLan(s);
    } catch {
      /* a remote session (403) or a transient error; the parent hides this card in the 403 case */
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    if (!hidden) void poll();
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll closes over ctx/hidden freshly each render
  }, [ctx, hidden]);
  useVisibleInterval(() => void poll(), hidden ? null : 1500);

  if (hidden) return null;

  const run = (p: Promise<LanStatus>): void => {
    setBusy(true);
    setProblem(null);
    p.then((state) => { if (aliveRef.current) setLan(state); })
      .catch((error: unknown) => { if (aliveRef.current) setProblem(toErrorMessage(error, "Local access could not be changed. Try again.")); })
      .finally(() => { if (aliveRef.current) setBusy(false); });
  };

  if (!lan.on) {
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>Local network access</div>
        <div className={styles.cardBody}>
          A no-account option: reach this studio from devices on the <b>same network</b> (home or office
          Wi-Fi), with no Tailscale sign-in. Each device enters a connect code, and you approve it here
          before it gets in.
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => run(ctx.api.remoteLanEnable())}>
            Enable local access
          </Button>
        </div>
        {problem && <p role="alert" className={styles.bad}>{problem}</p>}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <span className={styles.status}>
          <span className={`${styles.dot} ${styles.on}`} />
          Local access on
        </span>
      </div>
      <div className={styles.cardBody}>
        On a device on this network, open the link and enter this code. Only enable on a network you trust.
      </div>
      {problem && <p role="alert" className={styles.bad}>{problem}</p>}
      <div className={styles.code}>{redacted ? mask(lan.code) : lan.code}</div>
      {lan.url && <span className={styles.urlbar}>{redacted ? mask(lan.url) : lan.url}</span>}
      {lan.fingerprint && (
        <div className={styles.subtle}>
          Certificate fingerprint (verify on first connect):{" "}
          {redacted ? mask(lan.fingerprint) : lan.fingerprint}
        </div>
      )}

      {lan.pending.length > 0 && (
        <div className={styles.devices}>
          <div className={styles.devicesTitle}>Wants to connect</div>
          {lan.pending.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (d) => (
            <div key={d.id} className={styles.deviceRow}>
              <span className={styles.deviceName}>{redacted ? mask(d.label) : d.label}</span>
              <div className={styles.actions}>
                <Button size="sm" disabled={busy} onClick={() => run(ctx.api.remoteLanApprove(d.id))}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => run(ctx.api.remoteLanDeny(d.id))}>
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lan.connected.length > 0 && (
        <div className={styles.devices}>
          <div className={styles.devicesTitle}>Connected devices</div>
          {lan.connected.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (d) => (
            <div key={d.id} className={styles.deviceRow}>
              <span className={styles.deviceName}>{redacted ? mask(d.label) : d.label}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => run(ctx.api.remoteLanKick(d.id))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => run(ctx.api.remoteLanDisable())}>
          Turn off local access
        </Button>
      </div>
    </div>
  );
}
