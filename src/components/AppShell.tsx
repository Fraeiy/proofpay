import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, Plus, Receipt, ScrollText, UserRound } from "lucide-react";
import { cx, shortWallet } from "../domain/format";
import { demoIdentity, moneyBlockReason } from "../domain/selectors";
import type { Role, TxOutcome } from "../domain/types";
import { useAuth } from "../auth/PrivyGate";
import { useDemo, type Profile, type TxPhase, type TxView } from "../demo/store";
import { enterMode } from "../mode";
import { persistTheme, readThemeChoice, type ThemeChoice } from "../theme";
import { Wordmark } from "./Wordmark";
import { Banner, Button, Dialog } from "./ui";
import { TransactionStatus } from "./TransactionStatus";

const nav = [
  { to: "/overview", label: "Overview", icon: LayoutGrid },
  { to: "/agreements", label: "Agreements", icon: ScrollText },
  { to: "/payments", label: "Payments", icon: Receipt },
];

const busyPhase = (phase: TxPhase | undefined) => phase === "awaiting" || phase === "submitted" || phase === "pending";

function txCopy(tx: TxView, live: boolean): string {
  if (!live) {
    if (tx.phase === "pending") return "Waiting for the simulated transaction. Nothing is sent to a network.";
    if (tx.phase === "rejected") return "The wallet preview rejected this transaction. No funds moved.";
    if (tx.phase === "failed") return "The simulated transaction failed. Balances are unchanged.";
    if (tx.kind === "fund") return "Funding is recorded in this demo. The amount is held, not paid out.";
    if (tx.kind === "release") return "Payment is recorded in this demo. This milestone was paid in full, once.";
    return "The refund is recorded in this demo. The full amount went back to the client.";
  }
  if (tx.phase === "awaiting") return "Confirm this in your wallet. Sign-in stays a separate message. This request is the payment action shown above.";
  if (tx.phase === "submitted" || tx.phase === "pending") return "The transaction is on the network and waiting for confirmation. A hash alone is not a completed payment.";
  if (tx.phase === "rejected") return "You rejected the wallet request. No funds moved.";
  if (tx.phase === "failed") return "The transaction reverted. The contract did not apply this action.";
  if (tx.phase === "unknown") return "This transaction could not be verified yet. It was not marked successful or failed.";
  if (tx.kind === "fund") return "The deposit is confirmed. The amount is held in escrow. The freelancer has not been paid.";
  if (tx.kind === "release") return "Payment is confirmed. This milestone was paid in full, once.";
  return "The refund is confirmed. The full amount went back to the client.";
}

function txTitle(phase: TxPhase, live: boolean): string {
  if (phase === "awaiting") return "Confirm in your wallet";
  if (phase === "submitted" || phase === "pending") return "Transaction pending";
  if (phase === "success") return live ? "Transaction confirmed" : "Transaction recorded";
  if (phase === "unknown") return "Not verified yet";
  return "Transaction did not complete";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "P";
}

export function AppShell() {
  const demo = useDemo();
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const live = demo.mode === "live";
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signError, setSignError] = useState("");
  const focusFlow = /\/agreements\/new$|\/edit$/.test(location.pathname);
  const block = live ? (demo.profile ? demo.walletMessage : null) : moneyBlockReason(demo.state.walletPreview);
  const identity = demoIdentity(demo.state);

  function openAccount() {
    setConfirmReset(false);
    setTheme(readThemeChoice());
    setDisplayName(demo.profile?.displayName ?? "");
    setAccountOpen(true);
  }

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    persistTheme(choice);
    demo.setTheme(choice);
  }

  return (
    <div className="min-h-dvh">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 lg:h-16 lg:px-6">
          <NavLink to="/overview" className="shrink-0 rounded-xl" aria-label="ProofPay overview">
            <Wordmark />
          </NavLink>
          <span className="demo-pill">{live ? "Testnet" : "Sample"}</span>
          <nav className="pill-nav mx-auto hidden lg:flex" aria-label="Primary">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className="pill-link" end={item.to === "/overview"}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <NavLink to="/agreements/new" className="btn btn-primary">New agreement</NavLink>
          </div>
          <button type="button" className="ml-auto grid h-11 w-11 place-items-center rounded-full border border-line bg-paper lg:ml-0" aria-label={live ? "Account" : "Account and sample controls"} onClick={openAccount}>
            {live && demo.profile ? <span className="grid h-8 w-8 place-items-center rounded-full bg-lime text-xs font-extrabold text-anchor">{initials(demo.profile.displayName)}</span> : <UserRound size={18} />}
          </button>
        </div>
        <div className="mx-auto max-w-[1120px] px-4 pb-3">
          <ViewSwitch role={demo.state.role} live={live} onChange={demo.setRole} />
        </div>
      </header>
      <main id="content" className={cx("app-main", focusFlow && "no-nav")}>
        <div className="mx-auto grid max-w-[1120px] gap-4 px-4 pt-4 lg:px-6">
          {live && !demo.previewLoading && !demo.profile ? (
            <Banner tone="info" title={auth.authenticated ? "Finishing sign-in" : "Sign in"}>
              {auth.authenticated
                ? (auth.error || "Your sign-in worked. The wallet is still being prepared.")
                : auth.configured
                  ? "Continue with Google, X, email, or an existing wallet. Sign-in does not move funds or approve spending."
                  : "Open Account and sign the message. Connecting a wallet does not sign you in, and the message does not move funds or approve spending."}
              {auth.authenticated ? <button type="button" className="btn btn-ghost mt-2" onClick={() => { void auth.retryWallet(); }}>Retry wallet setup</button> : null}
            </Banner>
          ) : null}
          {live ? null : (
            <Banner tone="ok" title="Sample data">
              These agreements are stored in this browser and labelled as a sample. Freelancer and Client change whose list you are looking at. They do not sign anyone in.
            </Banner>
          )}
          {demo.notice ? (
            <Banner tone={demo.notice.tone === "ok" ? "ok" : "danger"} title={demo.notice.title} onClose={demo.dismissNotice}>
              {demo.notice.detail}
            </Banner>
          ) : null}
          {block ? <Banner tone="danger" title={demo.state.walletPreview === "wrong_network" ? "Wrong network" : "Wallet"}>{block}</Banner> : null}
        </div>
        <Outlet />
      </main>
      {focusFlow ? null : (
        <nav className="bottom-nav" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className="bottom-link">
                <Icon size={18} aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
          <NavLink to="/agreements/new" className="bottom-link">
            <Plus size={18} aria-hidden />
            New
          </NavLink>
        </nav>
      )}
      <Dialog
        open={accountOpen}
        title="Account"
        description={live ? "One wallet can do freelance work and hire people. The switch only changes which list you see." : "Sample controls. They do not connect a wallet or grant permission."}
        onClose={() => setAccountOpen(false)}
        footer={
          <Button variant="ghost" block onClick={() => setAccountOpen(false)}>Close</Button>
        }
      >
        {live ? (
          <LiveAccount
            profile={demo.profile}
            theme={theme}
            displayName={displayName}
            saving={savingProfile}
            signingIn={signingIn}
            signError={signError}
            onTheme={chooseTheme}
            onName={setDisplayName}
            onSave={() => {
              setSavingProfile(true);
              void demo.saveProfile({ displayName }).finally(() => setSavingProfile(false));
            }}
            onSignIn={() => {
              setSigningIn(true);
              setSignError("");
              void demo.signIn().then(() => {
                setSigningIn(false);
                setAccountOpen(false);
              }).catch((reason: unknown) => {
                setSigningIn(false);
                setSignError(reason instanceof Error ? reason.message : "Sign-in did not finish.");
              });
            }}
            onSignOut={() => { void demo.signOut().then(() => setAccountOpen(false)); }}
            onFaucet={() => { setAccountOpen(false); void demo.faucet(); }}
            onUseWallet={(wallet) => { void demo.switchWallet(wallet); }}
            onLinkWallet={auth.configured ? () => auth.linkWallet() : undefined}
            onExportWallet={auth.configured ? () => { void auth.exportWallet(); } : undefined}
          />
        ) : (
          <div className="grid gap-5">
            <section>
              <p className="text-sm font-bold text-muted">Viewing as</p>
              <p className="font-extrabold">{identity.name}</p>
              <p className="text-sm text-muted">{identity.detail}</p>
            </section>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-bold">Appearance</legend>
              <ThemeRadios theme={theme} onTheme={chooseTheme} />
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-bold">Wallet preview</legend>
              <Radio name="wallet" checked={demo.state.walletPreview === "demo"} label="Demo session" hint="Simulated funding and payments stay available." onChange={() => demo.setWalletPreview("demo")} />
              <Radio name="wallet" checked={demo.state.walletPreview === "disconnected"} label="Disconnected wallet" hint="Money actions turn off and explain why." onChange={() => demo.setWalletPreview("disconnected")} />
              <Radio name="wallet" checked={demo.state.walletPreview === "wrong_network"} label="Wrong network" hint="Stands in for a wallet that is not on Monad testnet." onChange={() => demo.setWalletPreview("wrong_network")} />
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-bold">Next simulated transaction</legend>
              <p className="text-sm text-muted">Applies to the next fund, payment, or refund. The main path stays on success until you change it.</p>
              {(["success", "rejected", "failed"] as TxOutcome[]).map((outcome) => (
                <Radio
                  key={outcome}
                  name="outcome"
                  checked={demo.state.nextOutcome === outcome}
                  label={outcome === "success" ? "Success" : outcome === "rejected" ? "Wallet rejection" : "Failed transaction"}
                  onChange={() => demo.setNextOutcome(outcome)}
                />
              ))}
            </fieldset>
            <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5" checked={demo.previewLoading} onChange={(event) => demo.setPreviewLoading(event.target.checked)} />
              Preview loading state
            </label>
            {confirmReset ? (
              <div className="rounded-2xl border border-[var(--color-coral-line)] bg-coral-wash p-4 text-coral-ink">
                <p className="font-extrabold">Reset the sample?</p>
                <p className="mt-1 text-sm">Agreements you created in this browser will be removed. Seeded examples come back.</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" onClick={() => { demo.resetDemo(); setConfirmReset(false); setAccountOpen(false); }}>Reset sample</Button>
                  <Button variant="ghost" onClick={() => setConfirmReset(false)}>Keep data</Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>Reset sample</Button>
            )}
            <Button variant="ghost" onClick={() => enterMode("live", "/")}>Leave sample data</Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={live && Boolean(demo.profile) && demo.profile?.onboarded === false}
        title="What brings you here?"
        description="This chooses the list you see first. You can switch between freelance work and hires whenever you like."
        locked
        onClose={() => undefined}
      >
        <div className="grid gap-2">
          <Button block onClick={() => void demo.saveProfile({ intent: "freelance", preferredView: "freelancer", onboarded: true })}>Manage my freelance work</Button>
          <Button block variant="ink" onClick={() => void demo.saveProfile({ intent: "hire", preferredView: "client", onboarded: true })}>Hire someone</Button>
          <Button block variant="ghost" onClick={() => void demo.saveProfile({ intent: "both", preferredView: "freelancer", onboarded: true })}>Both</Button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(demo.tx)}
        title={demo.tx ? txTitle(demo.tx.phase, live) : "Transaction"}
        onClose={demo.dismissTx}
        locked={busyPhase(demo.tx?.phase)}
        footer={
          demo.tx && !busyPhase(demo.tx.phase) ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {demo.tx.entryId ? (
                <Button onClick={() => { const id = demo.tx?.entryId; demo.dismissTx(); if (id) navigate(`/payments/${id}`); }}>
                  {demo.tx.phase === "success" ? "View receipt" : "View attempt"}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={demo.dismissTx}>Close</Button>
            </div>
          ) : null
        }
      >
        {demo.tx ? <TransactionStatus phase={demo.tx.phase} live={live} title={demo.tx.title} detail={txCopy(demo.tx, live)} /> : null}
      </Dialog>
    </div>
  );
}

function LiveAccount({
  profile,
  theme,
  displayName,
  saving,
  signingIn,
  signError,
  onTheme,
  onName,
  onSave,
  onSignIn,
  onSignOut,
  onFaucet,
  onUseWallet,
  onLinkWallet,
  onExportWallet,
}: {
  profile: Profile | null;
  theme: ThemeChoice;
  displayName: string;
  saving: boolean;
  signingIn: boolean;
  signError: string;
  onTheme: (theme: ThemeChoice) => void;
  onName: (value: string) => void;
  onSave: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onFaucet: () => void;
  onUseWallet: (wallet: string) => void;
  onLinkWallet?: () => void;
  onExportWallet?: () => void;
}) {
  return (
    <div className="grid gap-5">
      {profile ? (
        <section className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-lime text-base font-extrabold text-anchor" aria-hidden>{initials(profile.displayName)}</span>
          <div className="min-w-0">
            <p className="font-extrabold">{profile.displayName}</p>
            <p className="break-all text-sm text-muted">{shortWallet(profile.wallet)} · {profile.wallet}</p>
          </div>
        </section>
      ) : (
        <section>
          <p className="font-extrabold">Sign in</p>
          <p className="mt-1 text-sm text-muted">Use Google, email, or an existing wallet from the start page. This wallet sign-in does not move funds or approve token spending.</p>
          <Button className="mt-3" block onClick={onSignIn} unavailable={signingIn}>{signingIn ? "Check your wallet" : "Connect existing wallet"}</Button>
          {signError ? <p className="error-text" role="alert">{signError}</p> : null}
        </section>
      )}
      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold">Appearance</legend>
        <ThemeRadios theme={theme} onTheme={onTheme} />
      </fieldset>
      {profile ? (
        <div className="grid gap-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-bold">Display name</span>
            <input className="control" value={displayName} maxLength={80} onChange={(event) => onName(event.target.value)} />
          </label>
          <Button variant="ink" onClick={onSave} unavailable={saving}>{saving ? "Saving…" : "Save profile"}</Button>
          {(profile.wallets ?? [profile.wallet]).map((wallet) => (
            <button key={wallet} type="button" className="btn btn-quiet" onClick={() => onUseWallet(wallet)}>
              {wallet.toLowerCase() === profile.wallet.toLowerCase() ? "Active signer" : "Use for transactions"} · {shortWallet(wallet)}
            </button>
          ))}
          {onLinkWallet ? <Button variant="ghost" onClick={onLinkWallet}>Connect another wallet</Button> : null}
          {onExportWallet ? <Button variant="ghost" onClick={onExportWallet}>Wallet recovery</Button> : null}
          <Button variant="ghost" onClick={onFaucet}>Get test tUSDC</Button>
          <p className="text-sm text-muted">Test tUSDC has no monetary value. The token faucet only works after the test token is configured. Test MON for gas comes from the Monad faucet, which you request yourself.</p>
          <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
        </div>
      ) : null}
    </div>
  );
}

function ThemeRadios({ theme, onTheme }: { theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void }) {
  return (
    <>
      <Radio name="theme" checked={theme === "light"} label="Light" onChange={() => onTheme("light")} />
      <Radio name="theme" checked={theme === "dark"} label="Dark" onChange={() => onTheme("dark")} />
      <Radio name="theme" checked={theme === "system"} label="System" hint="Follows this device and updates when the system theme changes." onChange={() => onTheme("system")} />
    </>
  );
}

function ViewSwitch({ role, live, onChange }: { role: Role; live: boolean; onChange: (role: Role) => void }) {
  const options: Array<{ id: Role; label: string }> = live
    ? [{ id: "freelancer", label: "My freelance work" }, { id: "client", label: "My hires" }]
    : [{ id: "freelancer", label: "Freelancer" }, { id: "client", label: "Client" }];
  return (
    <div role="radiogroup" aria-label={live ? "Workspace" : "Sample perspective"} className="grid grid-cols-2 rounded-full border border-line bg-paper p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={role === option.id}
          className={cx("min-h-11 rounded-full px-3 text-[13px] font-bold sm:text-sm", role === option.id ? "bg-ink text-canvas" : "text-muted")}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Radio({ name, checked, label, hint, onChange }: { name: string; checked: boolean; label: string; hint?: string; onChange: () => void }) {
  return (
    <label className={cx("block rounded-2xl border px-3 py-2", checked ? "border-ink bg-paper" : "border-line")}>
      <span className="flex min-h-11 items-center gap-3 font-bold">
        <input type="radio" name={name} checked={checked} onChange={onChange} />
        {label}
      </span>
      {hint ? <span className="block pl-7 text-sm text-muted">{hint}</span> : null}
    </label>
  );
}
