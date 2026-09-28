// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Milestone escrow for one allowlisted test token.
/// Rules live in contracts/LIFECYCLE.md. This contract does not store private text.
contract ProofPayEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Phase {
        Unfunded,
        Funded,
        Submitted,
        ChangesRequested,
        Paid,
        Refunded
    }

    struct Milestone {
        uint256 amount;
        Phase phase;
        bytes32 submissionRef;
        address cancelProposer;
        uint64 cancelNonce;
    }

    struct Agreement {
        address client;
        address freelancer;
        bytes32 termsHash;
        bool clientAccepted;
        uint32 milestoneCount;
    }

    IERC20 public immutable token;

    uint256 public nextId;
    mapping(uint256 => Agreement) private _agreements;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;

    event AgreementCreated(uint256 indexed id, address indexed freelancer, address indexed client, bytes32 termsHash);
    event AgreementAccepted(uint256 indexed id, bytes32 termsHash);
    event MilestoneFunded(uint256 indexed id, uint256 indexed index, uint256 amount);
    event WorkSubmitted(uint256 indexed id, uint256 indexed index, bytes32 submissionRef);
    event ChangesRequested(uint256 indexed id, uint256 indexed index);
    event MilestonePaid(uint256 indexed id, uint256 indexed index, address freelancer, uint256 amount);
    event CancelProposed(uint256 indexed id, uint256 indexed index, address proposer, uint64 nonce);
    event CancelWithdrawn(uint256 indexed id, uint256 indexed index, uint64 nonce);
    event MilestoneRefunded(uint256 indexed id, uint256 indexed index, address client, uint256 amount, uint64 nonce);

    error SelfAgreement();
    error NoMilestones();
    error TooManyMilestones();
    error ZeroAmount();
    error UnknownAgreement();
    error NotClient();
    error NotFreelancer();
    error NotParty();
    error TermsMismatch();
    error AlreadyAccepted();
    error NotAccepted();
    error BadIndex();
    error BadPhase();
    error ZeroRef();
    error NoProposal();
    error NotProposer();
    error IsProposer();
    error StaleProposal();

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    function agreement(uint256 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    function milestone(uint256 id, uint256 index) external view returns (Milestone memory) {
        return _milestones[id][index];
    }

    function createAgreement(address client, bytes32 termsHash, uint256[] calldata amounts) external returns (uint256 id) {
        if (client == msg.sender) revert SelfAgreement();
        uint256 count = amounts.length;
        if (count == 0) revert NoMilestones();
        if (count > 8) revert TooManyMilestones();

        id = ++nextId;
        _agreements[id] = Agreement({
            client: client,
            freelancer: msg.sender,
            termsHash: termsHash,
            clientAccepted: false,
            milestoneCount: uint32(count)
        });
        for (uint256 index = 0; index < count; index++) {
            if (amounts[index] == 0) revert ZeroAmount();
            _milestones[id][index].amount = amounts[index];
        }
        emit AgreementCreated(id, msg.sender, client, termsHash);
    }

    function accept(uint256 id, bytes32 termsHash) external {
        Agreement storage item = _existing(id);
        if (msg.sender != item.client) revert NotClient();
        if (item.clientAccepted) revert AlreadyAccepted();
        if (item.termsHash != termsHash) revert TermsMismatch();
        item.clientAccepted = true;
        emit AgreementAccepted(id, termsHash);
    }

    function fund(uint256 id, uint256 index) external nonReentrant {
        Agreement storage item = _existing(id);
        if (!item.clientAccepted) revert NotAccepted();
        if (msg.sender != item.client) revert NotClient();
        Milestone storage step = _step(item, id, index);
        if (step.phase != Phase.Unfunded) revert BadPhase();
        step.phase = Phase.Funded;
        token.safeTransferFrom(msg.sender, address(this), step.amount);
        emit MilestoneFunded(id, index, step.amount);
    }

    function submit(uint256 id, uint256 index, bytes32 submissionRef) external {
        Agreement storage item = _existing(id);
        if (msg.sender != item.freelancer) revert NotFreelancer();
        if (submissionRef == bytes32(0)) revert ZeroRef();
        Milestone storage step = _step(item, id, index);
        if (step.phase != Phase.Funded && step.phase != Phase.ChangesRequested) revert BadPhase();
        step.phase = Phase.Submitted;
        step.submissionRef = submissionRef;
        _invalidateCancel(id, index, step);
        emit WorkSubmitted(id, index, submissionRef);
    }

    function requestChanges(uint256 id, uint256 index) external {
        Agreement storage item = _existing(id);
        if (msg.sender != item.client) revert NotClient();
        Milestone storage step = _step(item, id, index);
        if (step.phase != Phase.Submitted) revert BadPhase();
        step.phase = Phase.ChangesRequested;
        _invalidateCancel(id, index, step);
        emit ChangesRequested(id, index);
    }

    function release(uint256 id, uint256 index) external nonReentrant {
        Agreement storage item = _existing(id);
        if (msg.sender != item.client) revert NotClient();
        Milestone storage step = _step(item, id, index);
        if (step.phase != Phase.Submitted) revert BadPhase();
        uint256 amount = step.amount;
        step.phase = Phase.Paid;
        _invalidateCancel(id, index, step);
        token.safeTransfer(item.freelancer, amount);
        emit MilestonePaid(id, index, item.freelancer, amount);
    }

    function proposeCancel(uint256 id, uint256 index) external returns (uint64 nonce) {
        Agreement storage item = _existing(id);
        if (msg.sender != item.client && msg.sender != item.freelancer) revert NotParty();
        Milestone storage step = _step(item, id, index);
        if (!_holdsFunds(step.phase)) revert BadPhase();
        nonce = ++step.cancelNonce;
        step.cancelProposer = msg.sender;
        emit CancelProposed(id, index, msg.sender, nonce);
    }

    function withdrawCancel(uint256 id, uint256 index) external {
        Agreement storage item = _existing(id);
        Milestone storage step = _step(item, id, index);
        if (step.cancelProposer == address(0)) revert NoProposal();
        if (msg.sender != step.cancelProposer) revert NotProposer();
        uint64 nonce = ++step.cancelNonce;
        step.cancelProposer = address(0);
        emit CancelWithdrawn(id, index, nonce);
    }

    function approveCancel(uint256 id, uint256 index, uint64 nonce) external nonReentrant {
        Agreement storage item = _existing(id);
        if (msg.sender != item.client && msg.sender != item.freelancer) revert NotParty();
        Milestone storage step = _step(item, id, index);
        if (step.cancelProposer == address(0)) revert NoProposal();
        if (msg.sender == step.cancelProposer) revert IsProposer();
        if (nonce != step.cancelNonce) revert StaleProposal();
        if (!_holdsFunds(step.phase)) revert BadPhase();
        uint256 amount = step.amount;
        step.phase = Phase.Refunded;
        step.cancelProposer = address(0);
        step.cancelNonce = nonce + 1;
        token.safeTransfer(item.client, amount);
        emit MilestoneRefunded(id, index, item.client, amount, nonce);
    }

    function _existing(uint256 id) private view returns (Agreement storage item) {
        item = _agreements[id];
        if (item.freelancer == address(0)) revert UnknownAgreement();
    }

    function _step(Agreement storage item, uint256 id, uint256 index) private view returns (Milestone storage step) {
        if (index >= item.milestoneCount) revert BadIndex();
        step = _milestones[id][index];
    }

    function _holdsFunds(Phase phase) private pure returns (bool) {
        return phase == Phase.Funded || phase == Phase.Submitted || phase == Phase.ChangesRequested;
    }

    function _invalidateCancel(uint256 id, uint256 index, Milestone storage step) private {
        if (step.cancelProposer == address(0) && step.cancelNonce == 0) return;
        step.cancelProposer = address(0);
        uint64 nonce = ++step.cancelNonce;
        emit CancelWithdrawn(id, index, nonce);
    }
}
