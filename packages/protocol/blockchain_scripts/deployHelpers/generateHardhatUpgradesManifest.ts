import hre from "hardhat"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {fixProvider} from "./"
import {Logger} from "../types"
import {openzeppelin_saveDeploymentManifest} from "./openzeppelin-upgrade-validation"

const logger: Logger = console.log

async function main() {
  const hardhatUpgrades = new HardhatUpgradesManifest({hre, logger})
  const proxyContracts = Object.keys(await hre.deployments.all())
    .filter((x) => x.includes("_Proxy") && x != "CreditDesk_Proxy" && x != "Pool_Proxy")
    .map((x) => x.replace("_Proxy", ""))
  await hardhatUpgrades.writeManifest({
    contracts: proxyContracts,
  })
}

export class HardhatUpgradesManifest {
  private readonly logger: Logger
  private readonly hre: HardhatRuntimeEnvironment

  constructor(deployer: {logger: Logger; hre: HardhatRuntimeEnvironment}) {
    this.logger = deployer.logger
    this.hre = deployer.hre
  }

  async writeManifest({contracts}: {contracts: string[]}): Promise<void> {
    const {network} = this.hre
    this.logger(`Writing manifest: ${contracts}`)
    for (const i in contracts) {
      const contract = contracts[i] as string
      this.logger(`Saving deployment manifest: ${contract} & ${contract}_Implementation`)
      const proxyContractDeployment = await this.hre.deployments.get(`${contract}`)
      const implContractDeployment = await this.hre.deployments.get(`${contract}_Implementation`)
      try {
        await openzeppelin_saveDeploymentManifest(
          fixProvider(network.provider),
          proxyContractDeployment,
          implContractDeployment
        )
      } catch (e) {
        this.logger(`Error saving manifest for ${contract}: ${e}`)
      }
    }
  }
}

if (require.main === module) {
  // If this is run as a script, then call main. If it's imported (for tests), this block will not run
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export default HardhatUpgradesManifest
