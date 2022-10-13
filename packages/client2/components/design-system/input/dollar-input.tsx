import { ComponentProps } from "react";
import { useController, UseControllerProps } from "react-hook-form";
import { IMaskMixin } from "react-imask";

import {
  CURVE_LP_DECIMALS,
  FIDU_DECIMALS,
  GFI_DECIMALS,
  USDC_DECIMALS,
} from "@/constants";
import { SupportedCrypto, SupportedFiat } from "@/lib/graphql/generated";

import { Input } from "./input";

const MaskedInput = IMaskMixin(({ inputRef, ...props }) => {
  // @ts-expect-error ref types don't match because of bad typing
  return <Input ref={inputRef} {...props} />;
});

type Unit = SupportedFiat | SupportedCrypto;

type DollarInputProps = ComponentProps<typeof Input> &
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  UseControllerProps<any> & {
    unit?: Unit;
    /**
     * If this prop is included, a "MAX" button will be included on the input. When that button is clicked, this callback will be invoked.
     */
    onMaxClick?: () => void;
  };

const unitProperties: Record<Unit, { mask: string; scale: number }> = {
  [SupportedFiat.Usd]: { mask: "$amount", scale: 2 },
  [SupportedCrypto.Usdc]: { mask: "$amount USDC", scale: USDC_DECIMALS },
  [SupportedCrypto.Fidu]: { mask: "amount FIDU", scale: FIDU_DECIMALS },
  [SupportedCrypto.Gfi]: { mask: "amount GFI", scale: GFI_DECIMALS },
  [SupportedCrypto.CurveLp]: {
    mask: "amount FIDU-USDC-F",
    scale: CURVE_LP_DECIMALS,
  },
  [SupportedCrypto.StakingTokenId]: { mask: "$amount", scale: 0 },
  [SupportedCrypto.PoolTokenId]: { mask: "$amount", scale: 0 },
};

export function DollarInput({
  unit = SupportedCrypto.Usdc,
  onMaxClick,
  name,
  rules,
  control,
  shouldUnregister,
  defaultValue,
  ...rest
}: DollarInputProps) {
  const {
    field: { onChange, ...controllerField },
  } = useController({
    name,
    rules,
    control,
    shouldUnregister,
    defaultValue,
  });

  return (
    <MaskedInput
      mask={unitProperties[unit].mask}
      blocks={{
        amount: {
          mask: Number,
          thousandsSeparator: ",",
          lazy: false,
          scale: unitProperties[unit].scale,
          radix: ".",
        },
      }}
      // @ts-expect-error unmask isn't typed properly in IMaskMixin for some reason
      unmask
      onAccept={onChange}
      lazy={false}
      decoration={
        onMaxClick ? (
          <button
            type="button"
            onClick={onMaxClick}
            className="block rounded-md border border-sky-500 p-2 text-[10px] uppercase leading-none"
          >
            Max
          </button>
        ) : undefined
      }
      {...rest}
      {...controllerField}
    />
  );
}
