const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const tokenFactory = await hre.ethers.getContractFactory("ProofPayTestToken");
  const token = await tokenFactory.deploy();
  await token.waitForDeployment();
  const escrowFactory = await hre.ethers.getContractFactory("ProofPayEscrow");
  const escrow = await escrowFactory.deploy(await token.getAddress());
  await escrow.waitForDeployment();
  const network = await hre.ethers.provider.getNetwork();
  const deployment = {
    chainId: Number(network.chainId),
    token: await token.getAddress(),
    escrow: await escrow.getAddress(),
    rpc: hre.network.config.url || "http://127.0.0.1:8545",
    explorer: Number(network.chainId) === 10143 ? "https://testnet.monadvision.com" : null,
  };
  const dir = path.join(__dirname, "..", "data");
  const out = process.env.PROOFPAY_DEPLOYMENT
    ? path.resolve(process.env.PROOFPAY_DEPLOYMENT)
    : path.join(dir, "deployment.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
