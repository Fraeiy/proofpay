function settings() {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || "";
  const appSecret = process.env.PRIVY_APP_SECRET || "";
  return { appId, appSecret, ok: Boolean(appId && appSecret) };
}

export function privyConfigured() {
  return settings().ok;
}

function accountsOf(user) {
  return user?.linked_accounts || user?.linkedAccounts || [];
}

export function ethereumWallets(user) {
  const wallets = [];
  for (const account of accountsOf(user)) {
    if (account?.type !== "wallet") continue;
    const chain = account.chain_type || account.chainType || "ethereum";
    if (chain !== "ethereum" || !account.address) continue;
    const clientType = account.wallet_client_type || account.walletClientType || "";
    wallets.push({
      address: String(account.address).toLowerCase(),
      kind: clientType === "privy" ? "embedded" : "external",
    });
  }
  return wallets;
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadSdk() {
  try {
    const imported = await import("@privy-io/node");
    return { PrivyClient: imported.PrivyClient, flavor: "node" };
  } catch {
    const imported = await import("@privy-io/server-auth");
    return { PrivyClient: imported.PrivyClient, flavor: "server-auth" };
  }
}

async function verifyClaims(privy, accessToken) {
  const utils = typeof privy.utils === "function" ? privy.utils() : privy.utils;
  const auth = utils && (typeof utils.auth === "function" ? utils.auth() : utils.auth);
  if (auth && typeof auth.verifyAccessToken === "function") return auth.verifyAccessToken(accessToken);
  if (auth && typeof auth.verifyAuthToken === "function") return auth.verifyAuthToken(accessToken);
  throw fail(503, "This server cannot verify Privy access tokens with the installed SDK.");
}

async function loadUser(privy, userId) {
  const users = privy.users && (typeof privy.users === "function" ? privy.users() : privy.users);
  if (users && typeof users._get === "function") return users._get(userId);
  if (typeof privy.getUser === "function") return privy.getUser(userId);
  throw fail(503, "This server cannot read Privy linked accounts with the installed SDK.");
}

export async function verifyPrivyAccessToken(accessToken) {
  const { appId, appSecret, ok } = settings();
  if (!ok) throw fail(503, "Google and email sign-in are not configured on this server yet.");
  if (!accessToken) throw fail(401, "Sign in again.");
  let sdk;
  try {
    sdk = await loadSdk();
  } catch {
    throw fail(503, "The Privy server SDK is not installed on this server yet.");
  }
  const privy = sdk.flavor === "node"
    ? new sdk.PrivyClient({ appId, appSecret })
    : new sdk.PrivyClient(appId, appSecret);
  let claims;
  try {
    claims = await verifyClaims(privy, accessToken);
  } catch (error) {
    if (error?.status) throw error;
    throw fail(401, "This sign-in could not be verified. Try again.");
  }
  const userId = claims?.userId || claims?.user_id || claims?.sub;
  if (!userId) throw fail(401, "This sign-in could not be verified. Try again.");
  let user;
  try {
    user = await loadUser(privy, userId);
  } catch (error) {
    if (error?.status) throw error;
    throw fail(401, "This sign-in could not be verified. Try again.");
  }
  return { userId: String(userId), wallets: ethereumWallets(user) };
}
