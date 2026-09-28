export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-proofpay-request": "1",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as { error?: string } : {};
  if (!response.ok) throw new ApiError(response.status, data.error || "ProofPay could not finish that request.");
  return data as T;
}

export async function downloadReceiptFile(id: string) {
  const response = await fetch(`/api/receipts/${id}.pdf`, {
    credentials: "include",
    headers: { "x-proofpay-request": "1" },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "The receipt is not available." }));
    throw new ApiError(response.status, data.error || "The receipt is not available.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `proofpay-${id}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
