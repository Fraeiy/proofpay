import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { createPublicClient, http } from "viem";
import { tokenAbi } from "../../shared/protocol.mjs";
import { MONAD_FAUCET_URL } from "../chain/monad";
import { walletChain, type ChainConfig } from "../chain/wallet";
import { useDemo } from "../demo/store";
import { api } from "../live/api";
import { Button } from "./ui";

export function TestFunds() {
  const demo = useDemo();
  const [mon, setMon] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [config, setConfig] = useState<ChainConfig & { faucetUrl?: string } | null>(null);

  useEffect(() => {
    if (demo.mode !== "live" || !demo.profile) return;
    let gone = false;
    void (async () => {
      const next = await api<ChainConfig & { faucetUrl?: string }>("/api/config");
      if (gone) return;
      setConfig(next);
      const client = createPublicClient({ chain: walletChain(next), transport: http(next.rpcUrl) });
      const native = await client.getBalance({ address: demo.profile!.wallet as `0x${string}` });
      if (gone) return;
      setMon(formatUnits(native, 18));
      if (!next.token) {
        setToken(null);
        return;
      }
      const balance = await client.readContract({
        address: next.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [demo.profile!.wallet as `0x${string}`],
      });
      if (!gone) setToken(formatUnits(balance as bigint, next.tokenDecimals || 6));
    })().catch(() => {
      if (!gone) {
        setMon(null);
        setToken(null);
      }
    });
    return () => { gone = true; };
  }, [demo.mode, demo.profile]);

  if (demo.mode !== "live" || !demo.profile || !config) return null;
  const needsGas = mon === "0" || mon?.startsWith("0.000000");
  const faucet = config.faucetUrl || MONAD_FAUCET_URL;
  return (
    <section className="panel mb-6 p-4">
      <h2 className="font-extrabold">Testnet funds</h2>
      <p className="mt-1 text-sm text-muted">Test MON pays gas. Test tUSDC is the milestone token. Neither has monetary value. Creating a wallet does not add either one.</p>
      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex justify-between gap-3"><dt>MON</dt><dd className="font-bold tabular-nums">{mon ?? "Unable to read"}</dd></div>
        <div className="flex justify-between gap-3"><dt>tUSDC</dt><dd className="font-bold tabular-nums">{config.token ? (token ?? "Unable to read") : "Not configured"}</dd></div>
      </dl>
      {needsGas ? <p className="mt-3 text-sm">This wallet needs test MON for gas. Request it yourself at the faucet. ProofPay does not receive it for you.</p> : null}
      {!config.configured ? <p className="mt-3 text-sm">The escrow contract is not configured on this server yet, so milestone funding stays closed.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn btn-ghost" href={faucet} target="_blank" rel="noreferrer">Open MON faucet</a>
        <Button variant="ghost" onClick={() => void demo.faucet()}>Get test tUSDC</Button>
      </div>
    </section>
  );
}
