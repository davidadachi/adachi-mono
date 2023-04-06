import { Resolvers } from "@apollo/client";
import { getProvider } from "@wagmi/core";
import { BigNumber } from "ethers";

import { getContract } from "@/lib/contracts";
import { assertUnreachable } from "@/lib/utils";

import { DirectGfiGrant, IndirectGfiGrant } from "../generated";

export const indirectGfiGrantResolvers: Resolvers[string] = {
  async vested(indirectGfiGrant: IndirectGfiGrant): Promise<BigNumber> {
    const provider = getProvider();
    const communityRewardsContract = await getContract({
      name: "CommunityRewards",
    });
    const vested = await communityRewardsContract.totalVestedAt(
      indirectGfiGrant.start,
      indirectGfiGrant.end,
      indirectGfiGrant.amount,
      indirectGfiGrant.cliffLength,
      indirectGfiGrant.vestingInterval.isZero() // This seems unintuitive, but check the code for CommunityRewards.grant(). When a grant with vestingInterval of 0 is claimed, vestingLength is used as the interval instead. If we don't do this there's a divide-by-zero error for some grants
        ? indirectGfiGrant.vestingLength
        : indirectGfiGrant.vestingInterval,
      BigNumber.from(0),
      (
        await provider.getBlock("latest")
      ).timestamp
    );

    return vested;
  },
};

export const directGfiGrantResolvers: Resolvers[string] = {
  async isAccepted(gfiDirectGrant: DirectGfiGrant): Promise<boolean> {
    switch (gfiDirectGrant.directSource) {
      case "MERKLE_DIRECT_DISTRIBUTOR":
        const merkleDirectDistributorContract = await getContract({
          name: "MerkleDirectDistributor",
        });
        return await merkleDirectDistributorContract.isGrantAccepted(
          gfiDirectGrant.index
        );
      case "BACKER_MERKLE_DIRECT_DISTRIBUTOR":
        const backerMerkleDirectDistributorContract = await getContract({
          name: "BackerMerkleDirectDistributor",
        });
        return backerMerkleDirectDistributorContract.isGrantAccepted(
          gfiDirectGrant.index
        );
      default:
        assertUnreachable(gfiDirectGrant.directSource);
    }
  },
};
