import { useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../components/ui";
import { Mark } from "../components/Wordmark";
import { useDemo } from "../demo/store";
import { enterMode } from "../mode";
import { ethereum } from "../chain/wallet";

export function Welcome() {
  usePageTitle("Milestone payments");
  const demo = useDemo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        <p className="text-sm font-extrabold text-blue-ink">A workspace, not a marketplace</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">See a funded week move from delivery to payment.</h2>
        <p className="mt-3 max-w-md text-[15px] text-muted">Amara Cole sends a client a four-week agreement. The client funds one week at a time, reviews the activity report, and releases that payment. The next week stays visibly unfunded until they fund it.</p>
        <div className="mt-5 grid max-w-md gap-3">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={() => {
              if (demo.mode === "preview") {
                enterMode("live", "/");
                return;
              }
              setBusy(true);
              setError("");
              void demo.signIn().then(() => enterMode("live", "/overview")).catch((reason: unknown) => {
                setBusy(false);
                setError(reason instanceof Error ? reason.message : "Sign-in did not finish.");
              });
            }}
          >
            {busy ? "Check your wallet" : "Sign in with wallet"} <ArrowUpRight size={18} aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => enterMode("preview", "/overview")}>Look at sample data</button>
          <p className="text-sm text-muted">Sign this message to sign in. This does not move funds or approve token spending.</p>
          {ethereum() ? null : <p className="text-sm text-muted">No wallet was found in this browser. On a phone, open ProofPay in your wallet’s browser, then sign in.</p>}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {demo.profile ? <Link to="/overview" className="text-sm font-bold text-blue-ink">Open your workspace</Link> : null}
        </div>
        <div className="panel mt-5 max-w-md p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-muted">Product preview</p>
              <p className="font-extrabold">Week 3 · Recap and report</p>
              <p className="text-sm text-muted">Northline Labs · funds held · due 30 Sep</p>
            </div>
            <p className="font-extrabold tabular-nums">420.00</p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full w-1/2 bg-ink" />
          </div>
          <p className="mt-2 text-sm text-muted">2 of 4 weeks paid. Week 4 is not secured.</p>
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
