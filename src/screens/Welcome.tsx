import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/PrivyGate";
import { usePageTitle } from "../components/ui";
import { Mark } from "../components/Wordmark";
import { useDemo } from "../demo/store";
import { enterMode } from "../mode";

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function Welcome() {
  usePageTitle("Sign in");
  const demo = useDemo();
  const auth = useAuth();
  const navigate = useNavigate();
  const codeRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (codeSent) codeRef.current?.focus();
  }, [codeSent]);

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || demo.mode === "preview") return;
    const next = sessionStorage.getItem("proofpay.next");
    const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
    navigate(destination, { replace: true });
  }, [auth.authenticated, auth.ready, demo.mode, navigate]);

  async function sendCode(address: string, resend: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const delivered = await auth.sendEmailCode(address);
      setSentTo(delivered);
      setCodeSent(true);
      if (codeRef.current) codeRef.current.value = "";
      setNotice(resend
        ? `A new code is on its way to ${delivered}. The previous code no longer works.`
        : `A 6-digit code is on its way to ${delivered}.`);
    } catch (reason) {
      setError(messageOf(reason, "The code could not be sent."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function verifyCode(raw: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await auth.submitEmailCode(raw);
    } catch (reason) {
      lock.current = false;
      setError(messageOf(reason, "Email sign-in did not finish."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-2">
      <a className="skip-link" href="#start">Skip to actions</a>
      <section className="relative flex flex-col justify-between bg-anchor px-5 py-6 text-on-anchor sm:px-10 sm:py-10 lg:min-h-dvh lg:px-14">
        <div className="flex items-center gap-2 font-extrabold">
          <Mark className="h-9 w-9" title="" />
          ProofPay
          <span className="demo-pill">{demo.mode === "preview" ? "Sample" : "Testnet"}</span>
        </div>
        <div className="py-6 lg:py-0">
          <div className="mb-5 flex items-center gap-3 lg:mb-8 lg:gap-4" aria-hidden>
            <Float tone="bg-amber" className="h-12 w-12 rotate-[-8deg] lg:h-14 lg:w-14"><ReceiptGlyph /></Float>
            <Float tone="bg-blue" className="h-14 w-14 lg:h-[72px] lg:w-[72px]"><ArrowUpRight size={28} /></Float>
            <Float tone="bg-lime" className="h-11 w-11 rotate-[8deg] text-anchor lg:h-12 lg:w-12"><span className="text-lg font-extrabold">W</span></Float>
          </div>
          <p className="text-sm font-bold text-lime">Agreements, proof, and payment in one place</p>
          <h1 className="mt-2 max-w-xl text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:mt-3">Keep the work next to the money.</h1>
          <p className="mt-3 max-w-md text-base text-on-anchor/75 lg:mt-4">For freelance social managers and the small teams who hire them. Each milestone is funded, reviewed, and paid on its own.</p>
        </div>
        <ul className="hidden gap-2 pb-2 text-sm font-bold lg:flex">
          <li className="rounded-full bg-white/10 px-3 py-1.5">Four-week retainers</li>
          <li className="rounded-full bg-white/10 px-3 py-1.5">Proof with the milestone</li>
          <li className="rounded-full bg-white/10 px-3 py-1.5">No automatic payouts</li>
        </ul>
      </section>
      <section id="start" className="flex flex-col justify-center px-5 py-6 sm:px-10 lg:px-14 lg:py-8">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Sign in</h2>
        <p className="mt-3 max-w-md text-[15px] text-muted">Google, X, email, or a wallet you already have. Signing in does not move funds or approve token spending.</p>
        <div className="mt-5 grid max-w-md gap-3">
          {demo.mode === "preview" ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => enterMode("live", "/")}>
              Continue on testnet <ArrowUpRight size={18} aria-hidden />
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-lg" disabled={busy || !auth.ready} onClick={() => { setError(""); auth.continueGoogle(); }}>
                Continue with Google <ArrowUpRight size={18} aria-hidden />
              </button>
              <button type="button" className="btn btn-ink btn-lg" disabled={busy || !auth.ready} onClick={() => { setError(""); auth.continueX(); }}>
                Continue with X <ArrowUpRight size={18} aria-hidden />
              </button>
              {auth.authenticated ? (
                <p className="text-sm font-bold" role="status">{auth.walletReady ? "You are signed in." : "Signed in. Preparing your wallet."}</p>
              ) : codeSent ? (
                <form className="grid gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  void verifyCode(codeRef.current?.value ?? "");
                }}>
                  <p className="text-sm text-muted">Code sent to <span className="font-bold text-ink">{sentTo}</span></p>
                  <label className="grid gap-1.5 text-sm font-bold">
                    6-digit code
                    <input
                      ref={codeRef}
                      className="control"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      aria-describedby="email-code-help"
                      onInput={(event) => {
                        const digits = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
                        event.currentTarget.value = digits;
                        if (digits.length === 6) void verifyCode(digits);
                      }}
                    />
                  </label>
                  <p id="email-code-help" className="text-sm text-muted">Use the newest email. Spaces and dashes are ignored.</p>
                  <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !auth.ready}>Verify email</button>
                  <button type="button" className="btn btn-ghost" disabled={busy || !auth.ready} onClick={() => void sendCode(sentTo, true)}>Send a new code</button>
                  <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setCodeSent(false); setNotice(""); setError(""); }}>Use a different email</button>
                </form>
              ) : (
                <form className="grid gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  const typed = String(new FormData(event.currentTarget).get("email") ?? "");
                  setEmail(typed);
                  void sendCode(typed, false);
                }}>
                  <label className="grid gap-1.5 text-sm font-bold">
                    Email
                    <input className="control" type="email" name="email" autoComplete="email" defaultValue={email} required />
                  </label>
                  <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !auth.ready}>Email me a code</button>
                </form>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                disabled={busy}
                onClick={() => {
                  setError("");
                  if (auth.configured) {
                    auth.connectWallet();
                    return;
                  }
                  setBusy(true);
                  void demo.signIn().then(() => enterMode("live", "/overview")).catch((reason: unknown) => {
                    setBusy(false);
                    setError(messageOf(reason, "Sign-in did not finish."));
                  });
                }}
              >
                Connect existing wallet
              </button>
            </>
          )}
          {notice ? <p className="text-sm text-muted" role="status">{notice}</p> : null}
          {auth.error ? <p className="error-text" role="alert">{auth.error}</p> : null}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {demo.profile ? <Link to="/overview" className="text-sm font-bold text-blue-ink">Open your workspace</Link> : null}
        </div>
      </section>
    </main>
  );
}

function Float({ children, className, tone }: { children: ReactNode; className: string; tone: string }) {
  return (
    <span className={`grid place-items-center rounded-2xl border-[1.5px] border-anchor text-on-anchor shadow-[4px_4px_0_var(--color-shadow)] ${tone} ${className}`}>
      {children}
    </span>
  );
}

function ReceiptGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <path d="M6 3h9l3 3v15l-2-1.2L14 21l-2-1.2L10 21l-2-1.2L6 21V3Z" fill="none" stroke="#191A35" strokeWidth="1.8" />
      <path d="M9 9h6M9 13h6" stroke="#191A35" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
