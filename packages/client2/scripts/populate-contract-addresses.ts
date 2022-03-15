/* eslint-disable no-console */
import fs from "fs";
import path from "path";

console.log("Gathering local contract addresses...");
const devDeployments = JSON.parse(
  fs
    .readFileSync(
      path.resolve(__dirname, "../../protocol/deployments/all_dev.json")
    )
    .toString()
);

const contracts = devDeployments["31337"].localhost.contracts;
const pathname = path.resolve(
  __dirname,
  "../constants/contract-addresses/localhost.json"
);
const addresses = {
  USDC: contracts.TestERC20.address,
  SeniorPool: contracts.SeniorPool.address,
};

fs.writeFileSync(pathname, JSON.stringify(addresses, null, 2));

console.log("Finished gathering local contract addresses");
