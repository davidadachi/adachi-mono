import clsx from "clsx";
import { useRef, useEffect, useState, Children } from "react";

interface MarqueeProps {
  className?: string;
  /**
   * Supply children as an array of strings if you wish to have multiple segments equally spaced apart. Otherwise, just use a plain string.
   */
  children: string | string[];
  colorScheme?: "blue" | "purple" | "yellow";
}

export function Marquee({
  className,
  children,
  colorScheme = "blue",
}: MarqueeProps) {
  const bgRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [numCopies, setNumCopies] = useState(1);

  const wrappedChildren = Children.map(children, (child) => (
    <div className="mx-7">{child}</div>
  ));

  // Note that this currently does not recalculate on resize
  useEffect(() => {
    if (!bgRef.current || !ghostRef.current) {
      return;
    }
    const bgWidth = bgRef.current.getBoundingClientRect().width;
    const contentWidth = ghostRef.current.getBoundingClientRect().width;
    const numCopiesToFill = Math.max(1, Math.ceil(bgWidth / contentWidth));
    setNumCopies(numCopiesToFill);
  }, []);

  const repeatedChildren = new Array(numCopies)
    .fill(0)
    .map(() => wrappedChildren);

  return (
    <div
      ref={bgRef}
      aria-hidden="true" // hidden because this element is decorative and very noisy to screen readers
      className={clsx(
        "flex w-full overflow-hidden whitespace-nowrap bg-gradient-to-t py-3 text-xs font-medium uppercase",
        colorScheme === "blue"
          ? "from-[#D2C2F2] to-sky-300 text-white"
          : colorScheme === "purple"
          ? "from-[#D17673] to-[#49386D] text-white"
          : colorScheme === "yellow"
          ? "from-[#F2EDC2] to-[#F1D26E] text-eggplant-800"
          : null,
        className
      )}
    >
      <div className="flex animate-marquee">{repeatedChildren}</div>
      <div className="flex animate-marquee">{repeatedChildren}</div>
      <div className="invisible absolute" ref={ghostRef}>
        {wrappedChildren}
      </div>
    </div>
  );
}
