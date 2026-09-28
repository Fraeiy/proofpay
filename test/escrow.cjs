const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE = 420n * 10n ** 6n;
const TWO = 180n * 10n ** 6n;

async function setup() {
  const [freelancer, client, stranger] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("ProofPayTestToken")).deploy();
  const escrow = await (await ethers.getContractFactory("ProofPayEscrow")).deploy(await token.getAddress());
  await token.connect(client).faucet();
  await token.connect(freelancer).faucet();
  return { freelancer, client, stranger, token, escrow };
}

function hashTerms(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

describe("ProofPayEscrow", function () {
  it("runs funding, revision, payment, and a second milestone", async function () {
    const { freelancer, client, token, escrow } = await setup();
    const terms = hashTerms("week-one");
    await escrow.connect(freelancer).createAgreement(client.address, terms, [ONE, TWO]);
    await expect(escrow.connect(client).fund(1, 0)).to.be.reverted;
    await expect(escrow.connect(client).accept(1, hashTerms("other"))).to.be.reverted;
    await escrow.connect(client).accept(1, terms);
    await expect(escrow.connect(freelancer).fund(1, 0)).to.be.reverted;

    await token.connect(client).approve(await escrow.getAddress(), ONE);
    await escrow.connect(client).fund(1, 0);
    await expect(escrow.connect(client).fund(1, 0)).to.be.reverted;

    const ref = hashTerms("submission-1");
    await escrow.connect(freelancer).submit(1, 0, ref);
    await escrow.connect(client).requestChanges(1, 0);
    await expect(escrow.connect(client).release(1, 0)).to.be.reverted;
    await escrow.connect(freelancer).submit(1, 0, hashTerms("submission-2"));

    const before = await token.balanceOf(freelancer.address);
    await escrow.connect(client).release(1, 0);
    expect(await token.balanceOf(freelancer.address)).to.equal(before + ONE);
    await expect(escrow.connect(client).release(1, 0)).to.be.reverted;

    const held = await token.balanceOf(await escrow.getAddress());
    expect(held).to.equal(0n);
    const second = await token.balanceOf(client.address);
    await token.connect(client).approve(await escrow.getAddress(), TWO);
    await escrow.connect(client).fund(1, 1);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(TWO);
    expect(await token.balanceOf(client.address)).to.equal(second - TWO);
  });

  it("refunds only when the other party approves the current proposal", async function () {
    const { freelancer, client, stranger, token, escrow } = await setup();
    const terms = hashTerms("cancel");
    await escrow.connect(freelancer).createAgreement(client.address, terms, [ONE]);
    await escrow.connect(client).accept(1, terms);
    await token.connect(client).approve(await escrow.getAddress(), ONE);
    await escrow.connect(client).fund(1, 0);

    await expect(escrow.connect(stranger).proposeCancel(1, 0)).to.be.reverted;
    const proposed = await escrow.connect(client).proposeCancel(1, 0);
    await proposed.wait();
    const step = await escrow.milestone(1, 0);
    await expect(escrow.connect(freelancer).approveCancel(1, 0, step.cancelNonce - 1n)).to.be.reverted;
    await expect(escrow.connect(client).approveCancel(1, 0, step.cancelNonce)).to.be.reverted;

    await escrow.connect(client).withdrawCancel(1, 0);
    const withdrawn = await escrow.milestone(1, 0);
    await expect(escrow.connect(freelancer).approveCancel(1, 0, withdrawn.cancelNonce - 1n)).to.be.reverted;

    await escrow.connect(freelancer).proposeCancel(1, 0);
    const current = await escrow.milestone(1, 0);
    const clientBefore = await token.balanceOf(client.address);
    await escrow.connect(client).approveCancel(1, 0, current.cancelNonce);
    expect(await token.balanceOf(client.address)).to.equal(clientBefore + ONE);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    await expect(escrow.connect(client).approveCancel(1, 0, current.cancelNonce)).to.be.reverted;
  });

  it("lets payment win a race against a stale cancellation", async function () {
    const { freelancer, client, token, escrow } = await setup();
    const terms = hashTerms("race");
    await escrow.connect(freelancer).createAgreement(client.address, terms, [ONE]);
    await escrow.connect(client).accept(1, terms);
    await token.connect(client).approve(await escrow.getAddress(), ONE);
    await escrow.connect(client).fund(1, 0);
    await escrow.connect(client).proposeCancel(1, 0);
    const pending = await escrow.milestone(1, 0);
    await escrow.connect(freelancer).submit(1, 0, hashTerms("work"));
    await expect(escrow.connect(freelancer).approveCancel(1, 0, pending.cancelNonce)).to.be.reverted;
    await escrow.connect(client).release(1, 0);
    expect((await escrow.milestone(1, 0)).phase).to.equal(4n);
  });

  it("rejects self agreements, strangers, and early payment", async function () {
    const { freelancer, client, stranger, escrow } = await setup();
    await expect(escrow.connect(freelancer).createAgreement(freelancer.address, hashTerms("self"), [ONE])).to.be.reverted;
    await escrow.connect(freelancer).createAgreement(client.address, hashTerms("ok"), [ONE]);
    await expect(escrow.connect(stranger).accept(1, hashTerms("ok"))).to.be.reverted;
    await expect(escrow.connect(client).release(1, 0)).to.be.reverted;
    await expect(escrow.connect(freelancer).submit(1, 0, hashTerms("early"))).to.be.reverted;
  });

  it("rolls the funded phase back when the token returns false", async function () {
    const [freelancer, client] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("FalseReturnToken")).deploy();
    const escrow = await (await ethers.getContractFactory("ProofPayEscrow")).deploy(await token.getAddress());
    await token.connect(client).faucet();
    const terms = hashTerms("false-return");
    await escrow.connect(freelancer).createAgreement(client.address, terms, [ONE]);
    await escrow.connect(client).accept(1, terms);
    await token.connect(client).approve(await escrow.getAddress(), ONE);
    await token.setFail(true);
    const before = await token.balanceOf(client.address);
    await expect(escrow.connect(client).fund(1, 0)).to.be.reverted;
    expect((await escrow.milestone(1, 0)).phase).to.equal(0n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await token.balanceOf(client.address)).to.equal(before);
  });
});
