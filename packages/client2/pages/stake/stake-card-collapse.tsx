import clsx from "clsx";
import { FixedNumber } from "ethers";
import Image from "next/image";
import { useState, ReactNode } from "react";

import { Icon } from "@/components/design-system";
import { formatCrypto, formatPercent } from "@/lib/format";
import { CryptoAmount } from "@/lib/graphql/generated";

import stakeGfImg from "./stake-gf.png";

interface StakeCardCollapseProps {
  children: ReactNode;
  heading: string;
  subheading: string;
  apy: FixedNumber;
  available?: CryptoAmount | null;
  staked?: CryptoAmount | null;
}

const IMG_HEIGHT = 48;

export default function StakeCardCollapse({
  children,
  heading,
  subheading,
  apy,
  available,
  staked,
}: StakeCardCollapseProps) {
  const [isOpen, setIsOpen] = useState(false);

  const IMG_RATIO = stakeGfImg.height / IMG_HEIGHT;

  return (
    <div className="relative rounded-xl bg-sand-100 py-4 px-6 hover:bg-sand-200">
      <div className="grid grid-cols-12 items-center">
        <div className="col-span-5">
          <div className="flex items-center">
            <Image
              src={stakeGfImg}
              alt={heading}
              height={IMG_HEIGHT}
              width={stakeGfImg.width / IMG_RATIO}
            />

            <div className="ml-4 flex-1">
              <div className="mb-1 text-xl font-medium">{heading}</div>
              <div className="text-sand-700">{subheading}</div>
            </div>
          </div>
        </div>
        <div className="col-span-2 text-right text-xl">
          {formatPercent(apy)}
        </div>
        <div className="col-span-2 text-right text-xl">
          {available ? formatCrypto(available) : null}
        </div>
        <div className="col-span-2 text-right text-xl">
          {staked ? formatCrypto(staked) : null}
        </div>
        <div className="col-span-1 text-right">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="ml-6 before:absolute before:inset-0"
          >
            <Icon
              name="ChevronDown"
              size="lg"
              className={clsx(
                "transition-transform",
                isOpen ? "rotate-180" : null
              )}
            />
          </button>
        </div>
      </div>
      {isOpen ? (
        <>
          <div className="-mx-6 mt-4 border-t border-sand-300 px-6 pt-6">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}
