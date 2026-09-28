import { getAddress, isAddress, keccak256, parseAbi, toBytes } from "viem";

export const SIGN_IN_STATEMENT =
  "Sign this message to sign in. This does not move funds or approve token spending.";

export const TOKEN_DECIMALS = 6;
export const CENT_SCALE = 10n ** BigInt(TOKEN_DECIMALS - 2);

export const escrowAbi = parseAbi([
  "function createAgreement(address client, bytes32 termsHash, uint256[] amounts) returns (uint256 id)",
  "function accept(uint256 id, bytes32 termsHash)",
  "function fund(uint256 id, uint256 index)",
  "function submit(uint256 id, uint256 index, bytes32 submissionRef)",
  "function requestChanges(uint256 id, uint256 index)",
  "function release(uint256 id, uint256 index)",
  "function proposeCancel(uint256 id, uint256 index) returns (uint64 nonce)",
  "function withdrawCancel(uint256 id, uint256 index)",
  "function approveCancel(uint256 id, uint256 index, uint64 nonce)",
  "function agreement(uint256 id) view returns (address client, address freelancer, bytes32 termsHash, bool clientAccepted, uint32 milestoneCount)",
  "function milestone(uint256 id, uint256 index) view returns (uint256 amount, uint8 phase, bytes32 submissionRef, address cancelProposer, uint64 cancelNonce)",
  "event AgreementCreated(uint256 indexed id, address indexed freelancer, address indexed client, bytes32 termsHash)",
  "event AgreementAccepted(uint256 indexed id, bytes32 termsHash)",
  "event MilestoneFunded(uint256 indexed id, uint256 indexed index, uint256 amount)",
  "event WorkSubmitted(uint256 indexed id, uint256 indexed index, bytes32 submissionRef)",
  "event ChangesRequested(uint256 indexed id, uint256 indexed index)",
  "event MilestonePaid(uint256 indexed id, uint256 indexed index, address freelancer, uint256 amount)",
  "event CancelProposed(uint256 indexed id, uint256 indexed index, address proposer, uint64 nonce)",
  "event CancelWithdrawn(uint256 indexed id, uint256 indexed index, uint64 nonce)",
  "event MilestoneRefunded(uint256 indexed id, uint256 indexed index, address client, uint256 amount, uint64 nonce)",
]);

export const tokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function faucet()",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
]);

export function centsToBaseUnits(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Amount must be a positive integer number of cents.");
  return BigInt(cents) * CENT_SCALE;
}

export function baseUnitsToCents(units) {
  const value = BigInt(units);
  if (value % CENT_SCALE !== 0n) throw new Error("Token amount is not an exact cent value.");
  const cents = value / CENT_SCALE;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large.");
  return Number(cents);
}

export function canonicalTerms(input) {
  return JSON.stringify({
    v: 1,
    title: input.title.trim(),
    description: input.description.trim(),
    client: getAddress(input.clientWallet).toLowerCase(),
    freelancer: getAddress(input.freelancerWallet).toLowerCase(),
    milestones: input.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title.trim(),
      deliverables: milestone.deliverables.map((line) => line.trim()).filter(Boolean),
      amountCents: milestone.amountCents,
      dueDate: milestone.dueDate,
    })),
  });
}

export function hashTerms(input) {
  return keccak256(toBytes(canonicalTerms(input)));
}

export function submissionRef(submissionId) {
  return keccak256(toBytes(`proofpay-submission:${submissionId}`));
}

export function checksum(address) {
  if (!isAddress(address)) return null;
  return getAddress(address);
}

export function sameAddress(left, right) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
