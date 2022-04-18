import clsx from "clsx";

import ArrowDown from "./svg/arrow-down.svg";
import ArrowTopRight from "./svg/arrow-top-right.svg";
import ArrowUp from "./svg/arrow-up.svg";
import Checkmark from "./svg/checkmark.svg";
import InfoCircle from "./svg/info-circle-solid.svg";
import Menu from "./svg/menu.svg";
import Wallet from "./svg/wallet.svg";
import X from "./svg/x.svg";

export const iconManifest = {
  ArrowDown,
  ArrowTopRight,
  ArrowUp,
  Checkmark,
  InfoCircle,
  Menu,
  Wallet,
  X,
};

export type IconNameType = keyof typeof iconManifest;
export type IconSizeType = "xs" | "sm" | "md" | "lg" | "text";

export interface IconProps {
  name: keyof typeof iconManifest;
  size?: IconSizeType;
  className?: string;
}

export function Icon({ name, size = "text", className }: IconProps) {
  const IconComponent = iconManifest[name];
  return (
    <IconComponent
      aria-hidden="true"
      className={clsx(
        size === "xs"
          ? "h-4 w-4"
          : size === "sm"
          ? "h-5 w-5"
          : size === "md"
          ? "h-6 w-6"
          : size === "lg"
          ? "h-10 w-10"
          : size === "text"
          ? "h-[1em] w-[1em]"
          : null,
        "inline",
        className
      )}
    />
  );
}
