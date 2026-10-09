# Solo tournament showcase

The `/solo` page presents the supplied community announcement as seven scroll chapters. The public navigation and home page link to it. Malay and English follow the existing language preference. This is announcement content, independent of editable tournament configuration and live registration status; its final action opens the tournament hub.

The page uses a self-hosted Barlow Condensed display font, CSS animations, intersection-based reveals, and animation-frame-batched scroll parallax. Scrolling remains native. The sticky chapter bar includes reading progress and a motion pause control. The device's reduced-motion preference disables motion; server-rendered content remains readable without JavaScript.

Verification: the production build, TypeScript check, and diff whitespace check pass. Browser previews were checked at desktop, 768px, 390px, and 320px widths. The 320px English and Malay layouts have no page overflow or overflowing headings. All chapter anchors resolve. Pausing stops the trophy and ticker animations and makes all 39 reveal elements visible. Chapter navigation, active chapter tracking, and the language switch were exercised without browser console warnings or errors.

Reading typography uses 16px paragraphs at 1.8 line height, 18px explanatory subheadings, 14px navigation/actions/supporting text, and generally 12px short labels. Small decorative coordinates remain secondary. These sizes stay consistent across breakpoints. The mobile hero uses normal document flow to accommodate larger text without overlapping the artwork. A 390px reading preview is saved at `docs/screenshots/solo-showcase/readable-mobile.jpg`.

## Artwork

- Final project asset: `public/solo/chrome-trophy.webp` (1000 × 1000, transparent WebP).
- Created using the built-in ImageGen tool and the `imagegen` skill; optimized with Sharp while preserving alpha.
- Font: `public/fonts/barlow-condensed-black-italic.ttf`, with its Open Font License in `public/fonts/barlow-condensed-OFL.txt`.
- The decorative reward diamond is native SVG.

Final ImageGen prompt:

> Use case: stylized-concept. Asset type: transparent cutout hero artwork for a premium experimental gaming tournament website. Create a single spectacular sculptural esports trophy, centered, full object visible, slight dynamic 12-degree tilt, three-quarter view. A polished liquid-chrome silver trophy cup with angular pointed swept handles, an angular crown-like rim, narrow sculpted stem, and chunky faceted dark chrome plinth. A large luminous hot-pink faceted diamond is suspended in the cup. Restrained pink light reflections across mirror metal with hard studio specular highlights and black reflections, photorealistic high-end 3D Octane product render, beautiful luxury industrial design. Two or three small floating pink crystal shards close to the trophy add dynamic energy. Strong sharp silhouette. Entire sculpture occupies 85 percent of a square frame with safe margin. Actual transparent background, no ground, no backdrop, no text, no letters, no logos, no watermark. Beautiful detailed chrome surfaces, hot-pink gemstone, white highlights.
