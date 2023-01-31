import { Resolvers } from "@apollo/client";
import { BigNumber } from "ethers";

import { TOKEN_LAUNCH_TIME } from "@/constants";
import { getContract } from "@/lib/contracts";
import { grantComparator } from "@/lib/gfi-rewards";
import { getEpochNumber } from "@/lib/membership";
import { assertUnreachable } from "@/lib/utils";
import { getProvider } from "@/lib/wallet";

import {
  Viewer,
  SupportedCrypto,
  IndirectGfiGrant,
  DirectGfiGrant,
} from "../generated";

async function erc20Balance(
  token: SupportedCrypto
): Promise<CryptoAmount | null> {
  try {
    const provider = await getProvider();
    const account = await provider.getSigner().getAddress();

    const contract = await getContract({
      name:
        token === "GFI"
          ? "GFI"
          : token === "USDC"
          ? "USDC"
          : token === "FIDU"
          ? "Fidu"
          : token === "CURVE_LP"
          ? "CurveLP"
          : assertUnreachable(token),
      provider,
    });
    const balance = await contract.balanceOf(account);
    return { token, amount: balance };
  } catch (e) {
    // This will execute if getAddress() above throws (which happens when a user wallet isn't connected)
    return null;
  }
}

export const viewerResolvers: Resolvers[string] = {
  account(viewer: Viewer, args: { format: "lowercase" }) {
    if (!viewer || !viewer.account) {
      return null;
    }
    const format = args?.format;
    if (format === "lowercase") {
      return viewer.account.toLowerCase();
    }
    return viewer.account;
  },
  async gfiBalance(): Promise<CryptoAmount | null> {
    return erc20Balance("GFI");
  },
  async usdcBalance(): Promise<CryptoAmount | null> {
    return erc20Balance("USDC");
  },
  async fiduBalance(): Promise<CryptoAmount | null> {
    return erc20Balance("FIDU");
  },
  async curveLpBalance(): Promise<CryptoAmount | null> {
    return erc20Balance("CURVE_LP");
  },
  async gfiGrants(viewer: Viewer) {
    if (!viewer || !viewer.account) {
      return [];
    }

    const matchingGrantsFromEndpoint = await (
      await fetch(`/api/gfi-grants?account=${viewer.account}`)
    ).json();
    const gfiGrants = [];
    for (const g of matchingGrantsFromEndpoint.matchingGrants) {
      if (
        g.grant.vestingLength &&
        g.grant.vestingInterval &&
        g.grant.cliffLength
      ) {
        gfiGrants.push({
          __typename: "IndirectGfiGrant",
          id: `${g.source}${g.index}`,
          index: g.index,
          indirectSource: g.source,
          reason: g.reason.toUpperCase(),
          proof: g.proof,
          amount: BigNumber.from(g.grant.amount),
          vestingLength: BigNumber.from(g.grant.vestingLength),
          vestingInterval: BigNumber.from(g.grant.vestingInterval),
          cliffLength: BigNumber.from(g.grant.cliffLength),
          start: BigNumber.from(TOKEN_LAUNCH_TIME),
          end: BigNumber.from(TOKEN_LAUNCH_TIME).add(
            BigNumber.from(g.grant.vestingLength)
          ),
        } as Required<Omit<IndirectGfiGrant, "vested">>);
      } else {
        gfiGrants.push({
          __typename: "DirectGfiGrant",
          id: `${g.source}${g.index}`,
          index: g.index,
          directSource: g.source,
          reason: g.reason.toUpperCase(),
          proof: g.proof,
          amount: BigNumber.from(g.grant.amount),
        } as Required<Omit<DirectGfiGrant, "isAccepted">>);
      }
    }

    gfiGrants.sort(grantComparator);

    return gfiGrants;
  },
  async claimableMembershipRewards(): Promise<CryptoAmount | null> {
    try {
      const provider = await getProvider();
      const account = await provider.getSigner().getAddress();

      const membershipContract = await getContract({
        name: "MembershipOrchestrator",
        provider,
      });
      const availableRewards = await membershipContract.claimableRewards(
        account
      );
      return {
        token: "FIDU",
        amount: availableRewards,
      };
    } catch (e) {
      return null;
    }
  },
  async accruedMembershipRewardsThisEpoch(): Promise<CryptoAmount | null> {
    try {
      const provider = await getProvider();
      const account = await provider.getSigner().getAddress();

      const membershipContract = await getContract({
        name: "MembershipOrchestrator",
        provider,
      });
      const membershipVaultContract = await getContract({
        name: "MembershipVault",
        provider,
      });

      const currentBlock = await provider.getBlock("latest");
      const epoch = getEpochNumber(currentBlock.timestamp * 1000);
      const totalRewardsThisEpoch = await membershipContract.estimateRewardsFor(
        epoch
      );
      const eligibleScore = await membershipVaultContract.currentValueOwnedBy(
        account
      );
      const { eligibleTotal } = await membershipContract.totalMemberScores();
      const accrued = eligibleTotal.isZero()
        ? BigNumber.from(0)
        : totalRewardsThisEpoch.mul(eligibleScore).div(eligibleTotal);
      return { token: "FIDU", amount: accrued };
    } catch (e) {
      return null;
    }
  },
};
