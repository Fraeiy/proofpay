declare module "../../shared/protocol.mjs" {
  import type { Abi } from "viem";
  export const SIGN_IN_STATEMENT: string;
  export const TOKEN_DECIMALS: number;
  export const CENT_SCALE: bigint;
  export const escrowAbi: Abi;
  export const tokenAbi: Abi;
}
