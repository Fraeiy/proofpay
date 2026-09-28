import { cx, formatMoney, TOKEN } from "../domain/format";

export function Money({
  cents,
  size = "md",
  tone = "ink",
  token = true,
}: {
  cents: number;
  size?: "sm" | "md" | "lg";
  tone?: "ink" | "inverse" | "muted";
  token?: boolean;
}) {
  const sizeClass = size === "lg" ? "text-[42px] sm:text-[52px]" : size === "sm" ? "text-[15px]" : "text-xl";
  const toneClass = tone === "inverse" ? "text-on-anchor" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <span className={cx("inline-flex items-baseline gap-1.5 font-extrabold tabular-nums tracking-tight", sizeClass, toneClass)}>
      {formatMoney(cents)}
      {token ? <span className={cx("font-bold tracking-normal", size === "lg" ? "text-sm" : "text-[11px]")}>{TOKEN}</span> : null}
    </span>
  );
}
