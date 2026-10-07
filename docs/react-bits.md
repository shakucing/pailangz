# Landing-page interaction

The landing page uses adapted React Bits components from the official project by David Haz:

- [SpotlightCard](https://reactbits.dev/components/spotlight-card): subtle lime pointer light on the community cards; keyboard focus uses a centered spotlight without making decorative cards extra tab stops.
- [FadeContent](https://reactbits.dev/animations/fade-content): brief GSAP section reveals, with a small vertical movement and readable initial opacity.

Source: [official React Bits repository](https://github.com/DavidHDev/react-bits). The vendored adaptations and upstream license live in `src/components/react-bits/`. GSAP is installed through npm and pinned in the lockfile.

The adaptations leave content visible during server rendering and without JavaScript. They respect `prefers-reduced-motion`; pointer motion is limited to a mouse, and decorative layers cannot intercept clicks. Animations run once per section and clean up their scroll triggers. No particles, autoplay media or continuous WebGL loop were added.
