import { Listbox as HeadlessListbox, Transition } from "@headlessui/react";
import clsx from "clsx";
import { Fragment, ReactNode, useState } from "react";
import { useController, UseControllerProps } from "react-hook-form";

import { HelperText, Icon } from "@/components/design-system";

export interface Option {
  value: string;
  label: string;
}

export interface ListboxProps extends UseControllerProps<any> {
  options: Option[];
  /**
   * Label text that will appear above the input
   */
  label: string;
  /**
   * Visually hide the label. Screen readers will still read it.
   */
  hideLabel?: boolean;
  /**
   * Placeholder shown in the selection when the user has not selected anything and there is no defaultValue set.
   */
  placeholder?: string;
  /**
   * The `name` attribute of the input element. This is important to the functionality of standard HTML forms.
   */
  name: string;
  /**
   * Helper text that will appear below the input.
   */
  helperText?: string;
  /**
   * Error message that replaces the `helperText` when supplied
   */
  errorMessage?: string;
  disabled?: boolean;
  colorScheme?: "light" | "dark";
  textSize?: "sm" | "md" | "lg" | "xl";
  /**
   * This class goes on the wrapper of the whole component. Use this for positioning
   */
  className?: string;
  /**
   * Class that goes specifically on the label element, not on the wrapper. Makes it easier to override label-specific styles.
   */
  labelClassName?: string;
  /**
   * An element that will render on the right side of the label. Can be used to add extra contextual information like a tooltip.
   */
  labelDecoration?: ReactNode;
}

export function Listbox({
  options,
  label,
  hideLabel = false,
  placeholder = "Make a selection...",
  helperText,
  errorMessage,
  disabled = false,
  colorScheme = "light",
  textSize = "md",
  className,
  labelClassName,
  labelDecoration,
  ...controlProps
}: ListboxProps) {
  const isError = !!errorMessage;
  const { field } = useController(controlProps);
  const [selectedOption, setSelectedOption] = useState<Option | null>(
    () => options.find((o) => o.value === field.value) ?? null
  );
  return (
    <div
      className={clsx(
        "flex flex-col items-start justify-start",
        colorScheme === "light"
          ? "text-sand-700"
          : colorScheme === "dark"
          ? "text-white"
          : null,
        textSize === "sm"
          ? "text-sm"
          : textSize === "lg"
          ? "text-lg"
          : textSize === "xl"
          ? "text-2xl"
          : null,
        className
      )}
    >
      <HeadlessListbox
        value={selectedOption}
        onChange={(selected) => {
          setSelectedOption(selected);
          field.onChange(selected?.value);
        }}
        as="div"
        className="relative self-stretch"
      >
        <div
          className={clsx(
            "mb-1.5 flex w-full items-center justify-between gap-4 leading-none",
            hideLabel && "sr-only",
            labelClassName
          )}
        >
          <HeadlessListbox.Label>{label}</HeadlessListbox.Label>
          {labelDecoration ? labelDecoration : null}
        </div>
        <HeadlessListbox.Button
          disabled={disabled}
          className={clsx(
            "unfocused flex w-full items-center justify-between rounded", // unfocused because the color schemes supply a border color as a focus style
            colorScheme === "light"
              ? [
                  "border bg-white focus:border-sand-600",
                  isError
                    ? "border-clay-100 placeholder:text-clay-700"
                    : "border-sand-200 placeholder:text-sand-500",
                ]
              : colorScheme === "dark"
              ? [
                  "border bg-sky-900 focus:border-white",
                  isError
                    ? "border-clay-500 placeholder:text-clay-500"
                    : "border-transparent placeholder:text-sand-300",
                ]
              : null,
            disabled && "opacity-50",
            textSize === "sm"
              ? "py-1.5 px-3"
              : textSize === "md"
              ? "py-2 px-3"
              : textSize === "lg"
              ? "px-4 py-3"
              : textSize === "xl"
              ? "px-5 py-4"
              : null
          )}
        >
          <span
            className={clsx("trucate", !selectedOption ? "opacity-50" : null)}
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <Icon name="ChevronDown" />
        </HeadlessListbox.Button>

        <Transition
          as={Fragment}
          enterFrom="opacity-0 scale-95"
          enterTo="transition opacity-100 scale-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="transition opacity-0 scale-95"
        >
          <HeadlessListbox.Options
            className={clsx(
              "absolute z-10 mt-0.5 min-w-full origin-top rounded border shadow-lg",
              colorScheme === "light"
                ? "border-sand-200 bg-white"
                : colorScheme === "dark"
                ? "border-white bg-sky-900"
                : null
            )}
          >
            {options.map((option: Option) => (
              <HeadlessListbox.Option
                key={option.value}
                value={option}
                className={clsx(
                  "cursor-pointer p-3 first:rounded-t last:rounded-b",
                  colorScheme === "light"
                    ? "hover:bg-sand-200"
                    : colorScheme === "dark"
                    ? "hover:bg-sky-700"
                    : null
                )}
              >
                {option.label}
              </HeadlessListbox.Option>
            ))}
          </HeadlessListbox.Options>
        </Transition>
      </HeadlessListbox>

      {helperText || errorMessage ? (
        <HelperText
          className={clsx(
            isError
              ? "text-clay-500"
              : colorScheme === "light"
              ? "text-sand-500"
              : colorScheme === "dark"
              ? "text-sand-300"
              : null,
            "mt-1 text-sm leading-none"
          )}
        >
          {errorMessage ? errorMessage : helperText}
        </HelperText>
      ) : null}
    </div>
  );
}
