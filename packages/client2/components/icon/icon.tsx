import clsx from "clsx";

import Checkmark from "./svg/checkmark.svg";
import InfoCircle from "./svg/info-circle.svg";
import Menu from "./svg/menu.svg";
import X from "./svg/x.svg";

export const iconManifest = {
  Checkmark,
  InfoCircle,
  Menu,
  X,
};

export type IconNameType = keyof typeof iconManifest;
export type IconSizeType = "sm" | "md" | "lg" | "text";

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
        size === "sm"
          ? "h-4 w-4"
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
