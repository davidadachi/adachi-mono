import { gql } from "@apollo/client";
import { FixedNumber } from "ethers";
import Image from "next/image";
import NextLink from "next/link";

import { ShimmerLines } from "@/components/spinners";
import { formatPercent } from "@/lib/format";
import { TranchedPoolCardFieldsFragment } from "@/lib/graphql/generated";

interface PoolCardProps {
  title?: string | null;
  subtitle?: string | null;
  apy?: number | FixedNumber | null;
  apyWithGfi?: number | FixedNumber | null;
  icon?: string | null;
  href?: string;
  /**
   * Set this if the pool card is being used as a placeholder during loading
   */
  isPlaceholder?: boolean;
}

export function PoolCard({
  title,
  subtitle,
  apy,
  apyWithGfi,
  icon,
  href,
  isPlaceholder = false,
}: PoolCardProps) {
  return (
    <div className="relative flex space-x-4 rounded bg-sand-100 px-7 py-5 hover:bg-sand-200">
      <div className="relative h-12 w-12 overflow-hidden rounded-full bg-white">
        {icon && !isPlaceholder ? (
          <Image
            src={icon}
            alt={`${title} icon`}
            layout="fill"
            sizes="48px"
            objectFit="contain"
          />
        ) : null}
      </div>
      <div className="grow">
        {isPlaceholder ? (
          <ShimmerLines lines={2} truncateFirstLine />
        ) : (
          <>
            {href ? (
              <NextLink passHref href={href}>
                <a className="text-lg before:absolute before:inset-0">
                  {title}
                </a>
              </NextLink>
            ) : (
              <div className="text-lg">{title}</div>
            )}
            <div className="text-purple-100">{subtitle}</div>
          </>
        )}
      </div>
      <div className="w-1/5">
        <div className="text-lg">
          {apy ? `${formatPercent(apy)} USDC` : "\u00A0"}
        </div>
        <div className="text-purple-100">
          {apyWithGfi ? `${formatPercent(apyWithGfi)} with GFI` : "\u00A0"}
        </div>
      </div>
    </div>
  );
}

export const TRANCHED_POOL_CARD_FIELDS = gql`
  fragment TranchedPoolCardFields on TranchedPool {
    id
    name @client
    category @client
    icon @client
    creditLine {
      interestApr
    }
  }
`;

interface TranchedPoolCardProps {
  tranchedPool: TranchedPoolCardFieldsFragment;
  href: string;
}

export function TranchedPoolCard({
  tranchedPool,
  href,
}: TranchedPoolCardProps) {
  return (
    <PoolCard
      title={tranchedPool.name}
      subtitle={tranchedPool.category}
      icon={tranchedPool.icon}
      apy={
        parseFloat(tranchedPool.creditLine.interestApr.toString()) / 10 ** 18 // TODO creditLine.interestApr should really be stored as a BigDecimal in The Graph. It's just not that helpful as a BigInt
      }
      apyWithGfi={0.9999} // TODO just a placeholder
      href={href}
    />
  );
}
