import clsx from "clsx";

export interface ShimmerLinesProps {
  lines: number;
  truncateFirstLine: boolean;
  className?: string;
}

export function ShimmerLines({
  lines = 1,
  truncateFirstLine = true,
  className,
}: ShimmerLinesProps) {
  const shimmers = [];
  for (let i = 0; i < lines; i++) {
    shimmers.push(<Shimmer isTruncated={i === 0 && truncateFirstLine} />);
  }

  return (
    <div className={clsx("flex flex-col items-stretch gap-2", className)}>
      {shimmers}
    </div>
  );
}

export interface ShimmerProps {
  isTruncated?: boolean;
}

export function Shimmer({ isTruncated }: ShimmerProps) {
  return (
    <div
      className={clsx(
        isTruncated ? "w-5/12" : "w-full",
        "animate-background-oscillate-slow rounded bg-gradient-to-r from-sand-200 via-sand-100 to-sand-200"
      )}
      style={{ backgroundSize: "200% 100%" }}
    >
      &nbsp;
    </div>
  );
}
