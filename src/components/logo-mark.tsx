import Image from "next/image";

type LogoMarkProps = {
  className?: string;
  size: number;
};

// LogoMark renders the shared Vosio SVG mark wherever brand identity is needed.
export function LogoMark({ className, size }: LogoMarkProps) {
  return (
    <Image
      alt="Vosio"
      className={className}
      height={size}
      priority
      src="/vosio-logo.svg"
      width={size}
    />
  );
}
