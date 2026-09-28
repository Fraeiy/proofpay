export type AppMode = "live" | "preview";

export function readMode(): AppMode {
  return localStorage.getItem("proofpay.mode") === "preview" ? "preview" : "live";
}

export function enterMode(mode: AppMode, path: string) {
  localStorage.setItem("proofpay.mode", mode);
  window.location.assign(path);
}
