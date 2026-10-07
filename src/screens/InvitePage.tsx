import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/PrivyGate";
import { Button, usePageTitle } from "../components/ui";
import { Mark } from "../components/Wordmark";
import { useDemo } from "../demo/store";
import { api, ApiError } from "../live/api";

type Preview = {
  title: string;
  freelancerName: string;
  expiresAt: string;
  status: "open" | "claimed" | "confirmed" | "expired";
};

export function InvitePage() {
  const { token = "" } = useParams();
  const demo = useDemo();
  const auth = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  usePageTitle("Invitation");

  useEffect(() => {
    sessionStorage.setItem("proofpay.next", `/invite/${token}`);
    let gone = false;
    void api<Preview>(`/api/invitations/${token}`).then((next) => {
      if (!gone) setPreview(next);
    }).catch((reason: unknown) => {
      if (!gone) setError(reason instanceof Error ? reason.message : "This invitation is not available.");
    });
    return () => { gone = true; };
  }, [token]);

  async function claim() {
    setBusy(true);
    setError("");
    try {
      const claimed = await api<{ agreementId: string }>(`/api/invitations/${token}/claim`, { method: "POST", body: "{}" });
      sessionStorage.removeItem("proofpay.next");
      window.location.assign(`/agreements/${claimed.agreementId}`);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof ApiError ? reason.message : "The invitation could not be claimed.");
    }
  }

  const signedIn = Boolean(demo.profile);
  return (
    <main className="mx-auto grid min-h-dvh max-w-lg gap-4 px-5 py-8">
      <div className="flex items-center gap-2 font-extrabold">
        <Mark className="h-9 w-9" title="" />
        ProofPay
        <span className="demo-pill">{demo.mode === "preview" ? "Sample" : "Testnet"}</span>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Agreement invitation</h1>
      {preview ? (
        <section className="panel p-4">
          <p className="text-sm font-bold text-muted">From {preview.freelancerName}</p>
          <p className="mt-1 font-extrabold">{preview.title}</p>
          <p className="mt-2 text-sm text-muted">Status: {preview.status}. Expires {preview.expiresAt.slice(0, 10)}.</p>
          <p className="mt-2 text-sm text-muted">The full terms stay hidden until you sign in and claim this invitation. Claiming proposes your wallet. It does not fund anything, and the freelancer still has to confirm you.</p>
        </section>
      ) : <p className="text-sm text-muted">{error || "Loading the invitation."}</p>}
      {demo.mode === "preview" ? <p className="text-sm">Leave sample data and sign in to claim an invitation.</p> : null}
      {demo.mode === "live" && !signedIn ? (
        <div className="grid gap-2">
          {auth.authenticated ? <p className="text-sm" role="status">Your sign-in worked. The wallet is still being prepared.</p> : (
            <>
              <Button onClick={() => { auth.continueGoogle(); }}>Continue with Google</Button>
              <Button variant="ink" onClick={() => { auth.continueX(); }}>Continue with X</Button>
              <Button variant="ghost" onClick={() => navigate("/")}>Use email or an existing wallet</Button>
            </>
          )}
        </div>
      ) : null}
      {demo.mode === "live" && signedIn && preview && preview.status !== "expired" && preview.status !== "confirmed" ? (
        <Button onClick={() => void claim()} unavailable={busy}>{busy ? "Claiming…" : "Propose my wallet as the client"}</Button>
      ) : null}
      {error && preview ? <p className="error-text" role="alert">{error}</p> : null}
    </main>
  );
}
