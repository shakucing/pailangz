# PAILANGZ wordmark

The reference image supplied by the user was edited with the built-in ChatGPT ImageGen tool, using the `imagegen` skill. Only the PAILANGZ lettering remains; the people, weapons, crowns, banner and black background were removed. The generated PNG has a real transparent alpha channel.

Assets:
- `public/brand/pailangz-wordmark.png` — full-resolution transparent source, 2172 × 724.
- `public/brand/pailangz-wordmark.webp` — optimized transparent website asset, 1600 × 533.
- `src/components/wordmark.tsx` — reusable accessible website component.

The wordmark appears in public navigation, the landing-page hero, footer, login and staff navigation. Layout sizing creates the large and compact variations from the same lettering. The WebP is a resized and compressed copy, not a separate design.

Exact ImageGen prompt:

> Use case: background-extraction / logo-brand. Input image 1 is the edit target and exact typography reference. Create a production-ready transparent horizontal wordmark cutout containing ONLY the exact lettering 'PAILANGZ' (P A I L A N G Z) from the center of the attached logo. Preserve the distinctive sharp, slanted, jagged gothic gaming letter shapes, distressed brushed silver/chrome texture, dark bevel depth, and restrained thin red outer edge from the reference. Remove ALL people, guns, skyline, crowns, banner, motto, icons, shield, ornament, and black background completely. No additional text, no extra letters, no surrounding badge, no white or black rectangle, no checkerboard baked into pixels. The only opaque pixels should be the eight letters and their closely fitted black/red stroke and subtle bevel. Compose a wide horizontal logo, all letters complete and highly readable, tightly framed with a small transparent safety margin. Genuine transparent alpha background.
