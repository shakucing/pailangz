import Image from "next/image";
export function Wordmark({ hero = false }: { hero?: boolean }) {
  return (
    <Image
      className={hero ? "wordmark-hero" : "wordmark"}
      src="/brand/pailangz-wordmark.webp"
      width={1600}
      height={533}
      alt="PAILANGZ"
      sizes={
        hero
          ? "(max-width: 800px) 85vw, 520px"
          : "(max-width: 480px) 115px, 175px"
      }
      priority={hero}
    />
  );
}
