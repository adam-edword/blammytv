/**
 * Icon set — the exact "coolicons" (by Kryston Schwarze, github.com/krystonschwarze/coolicons)
 * used in the EPG Figma design. Inlined as components so they inherit color and
 * opacity from CSS via `stroke="currentColor"`, with no asset loading.
 * Source viewBox 24×24, stroke-width 2, round caps/joins — left untouched.
 */

import { useId } from "react";

type IconProps = { size?: number; className?: string };
/** Fluent icons ship two weights; `filled` picks the heavier one. */
type NavIconProps = IconProps & { filled?: boolean };

function Svg({
  size = 24,
  className,
  children,
}: IconProps & { children: import("react").ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Interface / Search — Fluent 16 (see the nav block for the source). */
export function SearchIcon({ size = 22, className, filled }: NavIconProps) {
  return (
    <Fluent
      size={size}
      className={className}
      filled={filled}
      reg={SEARCH_REG}
      fill={SEARCH_FILL}
    />
  );
}

/** User / User_03 */
export function AccountIcon({ size = 24, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M18 19C18 16.7909 15.3137 15 12 15C8.68629 15 6 16.7909 6 19M12 12C9.79086 12 8 10.2091 8 8C8 5.79086 9.79086 4 12 4C14.2091 4 16 5.79086 16 8C16 10.2091 14.2091 12 12 12Z" />
    </Svg>
  );
}

/** Interface / Settings — Fluent 16 (see the nav block for the source). */
export function SettingsIcon({ size = 22, className, filled }: NavIconProps) {
  return (
    <Fluent
      size={size}
      className={className}
      filled={filled}
      reg={SETTINGS_REG}
      fill={SETTINGS_FILL}
    />
  );
}

/** Interface / Star */
export function StarIcon({
  size = 19,
  className,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.33496 10.3368C2.02171 10.0471 2.19187 9.52339 2.61557 9.47316L8.61914 8.76107C8.79182 8.74059 8.94181 8.63215 9.01465 8.47425L11.5469 2.98446C11.7256 2.59703 12.2764 2.59695 12.4551 2.98439L14.9873 8.47413C15.0601 8.63204 15.2092 8.74077 15.3818 8.76124L21.3857 9.47316C21.8094 9.52339 21.9791 10.0472 21.6659 10.3369L17.2278 14.4419C17.1001 14.56 17.0433 14.7357 17.0771 14.9063L18.255 20.8359C18.3382 21.2544 17.8928 21.5787 17.5205 21.3703L12.2451 18.4166C12.0934 18.3317 11.9091 18.3321 11.7573 18.417L6.48144 21.3695C6.10913 21.5779 5.66294 21.2544 5.74609 20.8359L6.92414 14.9066C6.95803 14.7361 6.90134 14.5599 6.77367 14.4419L2.33496 10.3368Z" />
    </svg>
  );
}

/**
 * The heart, in the guide star's THREE treatments.
 *
 * Adam asked for "the same exact stroke and fill style as the favorites
 * star on the guide", and the first pass got that wrong: it copied
 * StarIcon, which is the mode rail's plain outline. The guide's star is
 * not that. It is a three-state rainbow, and the picture he sent is the
 * middle one.
 *
 *   at rest, row hovered   HeartGhostIcon          currentColor at 0.1
 *   the control hovered    HeartRainbowHollowIcon  dark core, gradient ring
 *   on                     RainbowHeartIcon        gradient fill and ring
 *
 * The gradient is the star's, stop for stop. Its coordinates are
 * userSpaceOnUse, so they are RESCALED from the star's 17-unit box into
 * this 24-unit one rather than copied: 18.8541/17 of the width becomes
 * 26.62/24, and so on. Copying the raw numbers would have run the whole
 * ramp across the middle third of the heart and left both ends flat.
 *
 * Stroke is 1.4 rather than the star's 1, for the same reason and in the
 * same direction: 1 in a 17-box is 1.4 in a 24-box, so this is the star's
 * line rather than a heavier one.
 */
const HEART_D =
  "M12 20.7 4.3 13a5.1 5.1 0 0 1 0-7.2 5.1 5.1 0 0 1 7.2 0l.5.5.5-.5a5.1 5.1 0 0 1 7.2 0 5.1 5.1 0 0 1 0 7.2L12 20.7Z";

/** The star's ramp, rescaled to a 24-unit box. Both rainbow hearts use it. */
function HeartGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient
        id={id}
        x1="26.62"
        y1="14.96"
        x2="-4.01"
        y2="11.0"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#FF7BF6" />
        <stop offset="0.259615" stopColor="#8696FF" />
        <stop offset="0.528846" stopColor="#84FFA9" />
        <stop offset="0.783654" stopColor="#FFE57F" />
        <stop offset="1" stopColor="#FF9B9B" />
      </linearGradient>
    </defs>
  );
}

/** Faint filled heart — at rest, while the row is hovered. StarGhostIcon's
 * opposite number, at its 0.1. */
export function HeartGhostIcon({ size = 19, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path opacity="0.1" d={HEART_D} fill="currentColor" />
    </svg>
  );
}

/** Dark-core heart ringed by the rainbow gradient — while the control
 * itself is hovered. StarRainbowHollowIcon's opposite number. Gradient ids
 * are per-instance so many can render at once. */
export function HeartRainbowHollowIcon({ size = 19, className }: IconProps) {
  const grad = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d={HEART_D} fill="#262626" />
      <path d={HEART_D} stroke={`url(#${grad})`} strokeWidth={1.4} />
      <HeartGradient id={grad} />
    </svg>
  );
}

/** Gradient-filled heart — the ON state. RainbowStarIcon's opposite
 * number, `vivid` included. */
export function RainbowHeartIcon({
  size = 19,
  className,
  vivid = false,
}: IconProps & { vivid?: boolean }) {
  const grad = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* No black understroke: at scaled sizes its antialiased fringe
       * peeks past the gradient stroke as a dark halo. */}
      <path d={HEART_D} fill="black" />
      <path
        d={HEART_D}
        fill={`url(#${grad})`}
        fillOpacity={vivid ? 1 : 0.7}
        stroke={`url(#${grad})`}
        strokeWidth={1.4}
      />
      <HeartGradient id={grad} />
    </svg>
  );
}

/** Arrow / Chevron_Down */
export function ChevronIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M19 9L12 16L5 9" />
    </Svg>
  );
}

/** Time / Recents — a clock face. */
export function RecentsIcon({ size = 19, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12L15 14" />
    </Svg>
  );
}

/** Interface / Close (X) */
export function CloseIcon({ size = 24, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 6L18 18M18 6L6 18" />
    </Svg>
  );
}

/** File / Copy — duplicate-to-clipboard. */
export function CopyIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

/** Media / Skip back 10s (counter-clockwise arrow). */
/**
 * A trophy, and deliberately not THE trophy: Adam's reference, which is
 * three splayed blades on a plinth rather than a cup with handles.
 *
 * How it got here, because the route matters more than the paths. First
 * ask: "not the usual trophy icon, something unique and cool". Then, on a
 * cup that had them, "i dont like the handles, just feels too generic",
 * which is exactly right — two round loops off a rim is the one detail
 * every trophy icon ever drawn shares, so keeping them meant the bowl
 * could be any shape and the thing still read as stock. Then two reference
 * images, and this is the second of them.
 *
 * FILLED, where every other icon in this file is a 1.8px stroke. That is a
 * deliberate exception and not an oversight: drawn as outlines the three
 * blades collapse into a blob at rail size, because each one is thinner
 * than two strokes plus a gap. Checked at 20px against the real Teams
 * shirt and Recents clock beside it — the blades are separated enough that
 * the ink works out comparable, so it reads as emphasis rather than as a
 * different icon set.
 *
 * PICKED BY LOOKING, at the size it is used. Eighteen candidates across
 * four rounds, rendered at 20, 40 and 72px. What died: a crest bowl read
 * as the stock icon, a laurel wreath turned to blobs, a fluted handleless
 * cup read as a goblet, a deep V went spindly, an inset star muddied, a
 * chevron read as an hourglass, and the angular monolith (Adam's first
 * reference) was lovely at 72px and mush at 20 — its engraved lines and
 * two-tier plinth have nowhere to go. The rail is 20px, so that is the
 * size that decides, not the one that flatters.
 *
 * Replaces an org-chart hierarchy that was placeholder-adjacent: it said
 * "structure", where the thing a league means to someone scanning a
 * sidebar is the thing you win.
 */
export function LeaguesIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden
    >
      {/* The centre blade, and the two that lean away from it.
        *
        * Their outer edges land on x 8.9 and 15.1, which are exactly the
        * plinth's top corners below. Adam's correction, twice: first that
        * the blades should meet the base rather than overhang it, then
        * that he meant HORIZONTALLY, "it can float". So they line up and
        * they do not touch, and the 1.8 units between them are the whole
        * difference between an object standing on a plinth and a shape
        * hovering near one. */}
      <path d="M9.4 3.2h5.2l-1.95 12.4h-1.3L9.4 3.2Z" />
      <path d="M4.5 4.2 7.7 3.6l2.35 12h-1.15L4.5 4.2Z" />
      <path d="M19.5 4.2 16.3 3.6l-2.35 12h1.15L19.5 4.2Z" />
      <path d="M8.9 17.4h6.2l1.5 3.6H7.4z" />
    </svg>
  );
}

/** A shirt. A team is people, and a kit is how you know which. */
export function TeamsIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 3 4 5.5 2.5 10l3 1.2V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.8l3-1.2L20 5.5 15 3" />
      <path d="M9 3a3 3 0 0 0 6 0" />
    </svg>
  );
}

/** A plain left arrow. The way OUT of a player, not a transport control:
 * SkipBackIcon below is about the media, this is about the screen. */
export function BackArrowIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export function SkipBackIcon({ size = 22, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v4.5h4.5" />
    </Svg>
  );
}

/** Media / Skip forward 10s (clockwise arrow). */
export function SkipFwdIcon({ size = 22, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M21 4v4.5h-4.5" />
    </Svg>
  );
}

/** Media / Audio language (globe). */
export function LanguageIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
    </Svg>
  );
}

/** Media / Subtitles (CC). */
export function CcIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" />
    </Svg>
  );
}

/** Media / Stats (bar chart). */
export function StatsIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </Svg>
  );
}

/** Interface / Sidebar — collapse/expand the side panel. */
/** Next episode — filled play glyph against an end bar (YouTube-style). */
export function NextEpisodeIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 5.9v12.2a1 1 0 0 0 1.55.83l9.2-6.1a1 1 0 0 0 0-1.66l-9.2-6.1A1 1 0 0 0 5 5.9z" />
      <rect x="17.5" y="5" width="2.4" height="14" rx="1.2" />
    </svg>
  );
}

export function PanelIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4V20" />
    </Svg>
  );
}

/* ---------------------------------------------------------------- nav
 * Fluent System Icons 16 (github.com/microsoft/fluentui-system-icons, MIT),
 * exported by Adam. The SVGs are kept verbatim in ./icons/ so the next one
 * gets added the same way, and the `d` strings below were generated from
 * them rather than transcribed.
 *
 * These are FILLED shapes on a 16 grid, not the 24-grid strokes above, so
 * they get their own wrapper.
 *
 * Each ships in two weights. The nav uses the regular one for a
 * destination you are not on and the filled one for the one you are: the
 * pill tells you where you are from across the bar, the weight confirms it
 * up close. Swapping weights cannot change an item's width (the CSS pins
 * every nav icon to 22px), so it cannot move the capsule.
 */
const GUIDE_REG =
  "M1.5 2C0.671573 2 0 2.67157 0 3.5V5.5C0 6.32843 0.671573 7 1.5 7H3.5C4.32843 7 5 6.32843 5 5.5V3.5C5 2.67157 4.32843 2 3.5 2H1.5ZM1 3.5C1 3.22386 1.22386 3 1.5 3H3.5C3.77614 3 4 3.22386 4 3.5V5.5C4 5.77614 3.77614 6 3.5 6H1.5C1.22386 6 1 5.77614 1 5.5V3.5ZM7.5 3C7.22386 3 7 3.22386 7 3.5C7 3.77614 7.22386 4 7.5 4H15.5C15.7761 4 16 3.77614 16 3.5C16 3.22386 15.7761 3 15.5 3H7.5ZM7.5 5C7.22386 5 7 5.22386 7 5.5C7 5.77614 7.22386 6 7.5 6H13.5C13.7761 6 14 5.77614 14 5.5C14 5.22386 13.7761 5 13.5 5H7.5ZM1.5 9C0.671573 9 0 9.67157 0 10.5V12.5C0 13.3284 0.671573 14 1.5 14H3.5C4.32843 14 5 13.3284 5 12.5V10.5C5 9.67157 4.32843 9 3.5 9H1.5ZM1 10.5C1 10.2239 1.22386 10 1.5 10H3.5C3.77614 10 4 10.2239 4 10.5V12.5C4 12.7761 3.77614 13 3.5 13H1.5C1.22386 13 1 12.7761 1 12.5V10.5ZM7.5 10C7.22386 10 7 10.2239 7 10.5C7 10.7761 7.22386 11 7.5 11H15.5C15.7761 11 16 10.7761 16 10.5C16 10.2239 15.7761 10 15.5 10H7.5ZM7.5 12C7.22386 12 7 12.2239 7 12.5C7 12.7761 7.22386 13 7.5 13H13.5C13.7761 13 14 12.7761 14 12.5C14 12.2239 13.7761 12 13.5 12H7.5Z";
const GUIDE_FILL =
  "M1.5 2C0.671573 2 0 2.67157 0 3.5V5.5C0 6.32843 0.671573 7 1.5 7H3.5C4.32843 7 5 6.32843 5 5.5V3.5C5 2.67157 4.32843 2 3.5 2H1.5ZM7.5 3C7.22386 3 7 3.22386 7 3.5C7 3.77614 7.22386 4 7.5 4H15.5C15.7761 4 16 3.77614 16 3.5C16 3.22386 15.7761 3 15.5 3H7.5ZM7.5 5C7.22386 5 7 5.22386 7 5.5C7 5.77614 7.22386 6 7.5 6H13.5C13.7761 6 14 5.77614 14 5.5C14 5.22386 13.7761 5 13.5 5H7.5ZM1.5 9C0.671573 9 0 9.67157 0 10.5V12.5C0 13.3284 0.671573 14 1.5 14H3.5C4.32843 14 5 13.3284 5 12.5V10.5C5 9.67157 4.32843 9 3.5 9H1.5ZM7.5 10C7.22386 10 7 10.2239 7 10.5C7 10.7761 7.22386 11 7.5 11H15.5C15.7761 11 16 10.7761 16 10.5C16 10.2239 15.7761 10 15.5 10H7.5ZM7.5 12C7.22386 12 7 12.2239 7 12.5C7 12.7761 7.22386 13 7.5 13H13.5C13.7761 13 14 12.7761 14 12.5C14 12.2239 13.7761 12 13.5 12H7.5Z";
const SPORTS_REG =
  "M13.0155 9.30838C13.6311 8.53862 13.9992 7.5623 13.9992 6.5C13.9992 6.32797 13.9895 6.15819 13.9707 5.99118C13.5978 6.1575 13.1847 6.24996 12.75 6.24996C12.1019 6.24996 11.5018 6.04443 11.0113 5.695L10.2067 6.49959L13.0155 9.30838ZM12.3085 10.0156L9.16327 6.87038C9.15729 6.86494 9.1514 6.85933 9.14562 6.85355C9.13984 6.84777 9.13423 6.84189 9.12879 6.8359L5.98359 3.6907C5.63133 4.13095 5.36004 4.63881 5.19231 5.19171C4.86816 5.11695 4.53597 5.0632 4.19727 5.03198C4.83956 2.70713 6.97001 1 9.49917 1C9.89001 1 10.2713 1.04077 10.6391 1.11828C10.6391 1.11824 10.6391 1.11832 10.6391 1.11828C11.0395 1.20261 11.4239 1.33037 11.787 1.49662C11.7869 1.49668 11.7872 1.49656 11.787 1.49662C12.9865 2.04592 13.9539 3.01406 14.5029 4.21368C14.5031 4.21341 14.5028 4.21395 14.5029 4.21368C14.6692 4.57678 14.7975 4.96032 14.8818 5.3607C14.8816 5.36093 14.8821 5.36047 14.8818 5.3607C14.9592 5.72807 14.9992 6.10963 14.9992 6.5C14.9992 9.02889 13.2924 11.1591 10.9679 11.8017C10.9367 11.463 10.8829 11.1308 10.8081 10.8067C11.3607 10.6389 11.8684 10.3677 12.3085 10.0156ZM13.7391 4.98866C13.57 4.5144 13.3236 4.07684 13.0151 3.69116L11.7335 4.97276C12.0314 5.14888 12.3789 5.24996 12.75 5.24996C13.1098 5.24996 13.4474 5.15495 13.7391 4.98866ZM11.0266 4.26545L12.308 2.98405C11.9226 2.67575 11.4854 2.4295 11.0115 2.26045C10.8451 2.55224 10.75 2.88999 10.75 3.24996C10.75 3.62066 10.8509 3.9678 11.0266 4.26545ZM10.0091 2.02857C9.84171 2.0097 9.67158 2 9.49917 2C8.43688 2 7.46055 2.36809 6.69079 2.98368L9.49959 5.79248L10.3043 4.98777C9.95527 4.49744 9.75 3.89767 9.75 3.24996C9.75 2.815 9.84257 2.40166 10.0091 2.02857ZM2.5 7C2.22386 7 2 7.22386 2 7.5V8.5C2 11.5376 4.46243 14 7.5 14H8.5C8.77614 14 9 13.7761 9 13.5V12.5C9 9.46243 6.53757 7 3.5 7H2.5ZM1 7.5C1 6.67157 1.67157 6 2.5 6H3.5C7.08985 6 10 8.91015 10 12.5V13.5C10 14.3284 9.32843 15 8.5 15H7.5C3.91015 15 1 12.0899 1 8.5V7.5ZM4.39645 9.39645C4.59171 9.20118 4.90829 9.20118 5.10355 9.39645L6.60355 10.8964C6.79882 11.0917 6.79882 11.4083 6.60355 11.6036C6.40829 11.7988 6.09171 11.7988 5.89645 11.6036L4.39645 10.1036C4.20118 9.90829 4.20118 9.59171 4.39645 9.39645Z";
const SPORTS_FILL =
  "M14.5339 4.28255C14.3254 3.80989 14.0523 3.37214 13.7258 2.98047L11.9832 4.72309C12.281 4.89904 12.6283 5 12.9992 5C13.6157 5 14.167 4.72108 14.5339 4.28255ZM11.2761 4.01598L13.0187 2.27337C12.6271 1.94687 12.1893 1.67379 11.7167 1.46531C11.2781 1.83219 10.9992 2.38352 10.9992 3C10.9992 3.3709 11.1002 3.71823 11.2761 4.01598ZM9.9992 3C9.9992 3.64792 10.2046 4.24786 10.5538 4.73827L9.7492 5.54289L6.26051 2.0542C7.169 1.39124 8.28841 1 9.4992 1C9.89713 1 10.2852 1.04226 10.6592 1.12254C10.2463 1.63652 9.9992 2.28941 9.9992 3ZM10.4563 6.25L11.2609 5.44537C11.7513 5.7946 12.3513 6 12.9992 6C13.7098 6 14.3627 5.75294 14.8767 5.34004C14.9569 5.714 14.9992 6.10206 14.9992 6.5C14.9992 7.71078 14.608 8.83019 13.945 9.73869L10.4563 6.25ZM13.2834 10.4913L9.74919 6.95711L9.14432 7.56198C10.1555 8.71702 10.8179 10.1851 10.9671 11.8019C11.8475 11.5587 12.6393 11.1021 13.2834 10.4913ZM4.19727 5.03206C4.44048 4.15169 4.89708 3.3599 5.50792 2.71584L9.04209 6.25L8.43722 6.85487C7.28217 5.84368 5.81406 5.18129 4.19727 5.03206ZM2.5 6C1.67157 6 1 6.67157 1 7.5V8.5C1 12.0899 3.91015 15 7.5 15H8.5C9.32843 15 10 14.3284 10 13.5V12.5C10 8.91015 7.08985 6 3.5 6H2.5ZM4.39645 9.39645C4.59171 9.20118 4.90829 9.20118 5.10355 9.39645L6.60355 10.8964C6.79882 11.0917 6.79882 11.4083 6.60355 11.6036C6.40829 11.7988 6.09171 11.7988 5.89645 11.6036L4.39645 10.1036C4.20118 9.90829 4.20118 9.59171 4.39645 9.39645Z";
const STREAM_REG =
  "M6.5 5.82056V10.1794C6.5 10.4293 6.77363 10.5828 6.98686 10.4525L10.246 8.46076C10.5906 8.2502 10.5906 7.74977 10.246 7.53921L6.98686 5.54751C6.77363 5.4172 6.5 5.57067 6.5 5.82056ZM4.5 3C3.11929 3 2 4.11929 2 5.5V10.5C2 11.8807 3.11929 13 4.5 13H11.5C12.8807 13 14 11.8807 14 10.5V5.5C14 4.11929 12.8807 3 11.5 3H4.5ZM3 5.5C3 4.67157 3.67157 4 4.5 4H11.5C12.3284 4 13 4.67157 13 5.5V10.5C13 11.3284 12.3284 12 11.5 12H4.5C3.67157 12 3 11.3284 3 10.5V5.5Z";
const STREAM_FILL =
  "M2 5.5C2 4.11929 3.11929 3 4.5 3H11.5C12.8807 3 14 4.11929 14 5.5V10.5C14 11.8807 12.8807 13 11.5 13H4.5C3.11929 13 2 11.8807 2 10.5V5.5ZM6.5 5.82056V10.1794C6.5 10.4293 6.77363 10.5828 6.98686 10.4525L10.246 8.46076C10.5906 8.2502 10.5906 7.74977 10.246 7.53921L6.98686 5.54751C6.77363 5.4172 6.5 5.57067 6.5 5.82056Z";
const DISCOVER_REG =
  "M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14ZM8 3C8.37372 3 8.87543 3.35608 9.31258 4.31781C9.4073 4.52619 9.49448 4.75446 9.57265 5H6.42735C6.50552 4.75446 6.5927 4.52619 6.68742 4.31781C7.12457 3.35608 7.62628 3 8 3ZM5.77705 3.90401C5.62614 4.23601 5.49428 4.6038 5.38411 5H3.99963C4.52341 4.30269 5.22525 3.74677 6.03766 3.39978C5.94287 3.56117 5.85596 3.7304 5.77705 3.90401ZM5.16299 6C5.05694 6.6275 5 7.30146 5 8C5 8.69854 5.05694 9.3725 5.16299 10H3.41604C3.14845 9.38754 3 8.7111 3 8C3 7.2889 3.14845 6.61246 3.41604 6H5.16299ZM5.38411 11C5.49428 11.3962 5.62614 11.764 5.77705 12.096C5.85596 12.2696 5.94287 12.4388 6.03766 12.6002C5.22525 12.2532 4.52341 11.6973 3.99963 11H5.38411ZM6.42735 11H9.57265C9.49448 11.2455 9.4073 11.4738 9.31258 11.6822C8.87543 12.6439 8.37372 13 8 13C7.62628 13 7.12457 12.6439 6.68742 11.6822C6.5927 11.4738 6.50552 11.2455 6.42735 11ZM9.82134 10H6.17866C6.06438 9.3892 6 8.71396 6 8C6 7.28604 6.06438 6.6108 6.17866 6H9.82134C9.93562 6.6108 10 7.28604 10 8C10 8.71396 9.93562 9.3892 9.82134 10ZM10.6159 11H12.0004C11.4766 11.6973 10.7747 12.2532 9.96234 12.6002C10.0571 12.4388 10.144 12.2696 10.2229 12.096C10.3739 11.764 10.5057 11.3962 10.6159 11ZM12.584 10H10.837C10.9431 9.3725 11 8.69854 11 8C11 7.30146 10.9431 6.6275 10.837 6H12.584C12.8516 6.61246 13 7.2889 13 8C13 8.7111 12.8516 9.38754 12.584 10ZM9.96234 3.39978C10.7747 3.74677 11.4766 4.30269 12.0004 5H10.6159C10.5057 4.6038 10.3739 4.23601 10.2229 3.90401C10.144 3.7304 10.0571 3.56117 9.96234 3.39978Z";
const DISCOVER_FILL =
  "M6 8C6 7.29718 6.04415 6.62474 6.12456 6H9.87544C9.95585 6.62474 10 7.29718 10 8C10 8.70282 9.95585 9.37526 9.87544 10H6.12456C6.04415 9.37526 6 8.70282 6 8ZM5.11686 10C5.0406 9.36521 5 8.69337 5 8C5 7.30663 5.0406 6.63479 5.11686 6H2.34141C2.12031 6.62556 2 7.29873 2 8C2 8.70127 2.12031 9.37444 2.34141 10H5.11686ZM2.80269 11H5.27206C5.39817 11.6551 5.56493 12.254 5.76556 12.7757C5.89989 13.125 6.05249 13.4476 6.22341 13.7326C4.76902 13.2824 3.55119 12.2939 2.80269 11ZM6.292 11H9.708C9.59779 11.5266 9.46003 12.0035 9.30109 12.4167C9.08782 12.9712 8.84611 13.3857 8.60319 13.6528C8.3604 13.9198 8.15584 14 8 14C7.84416 14 7.6396 13.9198 7.39681 13.6528C7.15389 13.3857 6.91218 12.9712 6.69891 12.4167C6.53997 12.0035 6.40221 11.5266 6.292 11ZM10.7279 11C10.6018 11.6551 10.4351 12.254 10.2344 12.7757C10.1001 13.125 9.94751 13.4476 9.77659 13.7326C11.231 13.2824 12.4488 12.2939 13.1973 11H10.7279ZM13.6586 10C13.8797 9.37444 14 8.70127 14 8C14 7.29873 13.8797 6.62556 13.6586 6H10.8831C10.9594 6.63479 11 7.30663 11 8C11 8.69337 10.9594 9.36521 10.8831 10H13.6586ZM9.30109 3.5833C9.46003 3.99654 9.59779 4.47343 9.708 5H6.292C6.40221 4.47343 6.53997 3.99654 6.69891 3.5833C6.91218 3.02877 7.15389 2.61433 7.39681 2.34719C7.6396 2.08019 7.84416 2 8 2C8.15584 2 8.3604 2.08019 8.60319 2.34719C8.84611 2.61433 9.08782 3.02877 9.30109 3.5833ZM10.7279 5H13.1973C12.4488 3.70607 11.231 2.7176 9.77658 2.26738C9.94751 2.55238 10.1001 2.87505 10.2344 3.22432C10.4351 3.74596 10.6018 4.34494 10.7279 5ZM2.80269 5H5.27206C5.39817 4.34494 5.56493 3.74596 5.76556 3.22432C5.89989 2.87505 6.05249 2.55238 6.22341 2.26738C4.76902 2.7176 3.55119 3.70607 2.80269 5Z";
const LIBRARY_REG =
  "M1 3.24941C1 2.55938 1.55917 2 2.24895 2H2.74852C3.4383 2 3.99747 2.55938 3.99747 3.24941V12.745C3.99747 13.435 3.4383 13.9944 2.74852 13.9944H2.24895C1.55917 13.9944 1 13.435 1 12.745V3.24941ZM2.24895 2.99953C2.11099 2.99953 1.99916 3.11141 1.99916 3.24941V12.745C1.99916 12.883 2.11099 12.9948 2.24895 12.9948H2.74852C2.88648 12.9948 2.99831 12.883 2.99831 12.745V3.24941C2.99831 3.11141 2.88648 2.99953 2.74852 2.99953H2.24895ZM4.99663 3.24941C4.99663 2.55938 5.5558 2 6.24557 2H6.74515C7.43492 2 7.9941 2.55938 7.9941 3.24941V12.745C7.9941 13.435 7.43492 13.9944 6.74515 13.9944H6.24557C5.5558 13.9944 4.99663 13.435 4.99663 12.745V3.24941ZM6.24557 2.99953C6.10762 2.99953 5.99578 3.11141 5.99578 3.24941V12.745C5.99578 12.883 6.10762 12.9948 6.24557 12.9948H6.74515C6.88311 12.9948 6.99494 12.883 6.99494 12.745V3.24941C6.99494 3.11141 6.88311 2.99953 6.74515 2.99953H6.24557ZM11.9723 4.77682C11.7231 4.15733 11.0311 3.84331 10.4011 4.06385L9.81888 4.26764C9.14658 4.50297 8.80684 5.25222 9.07268 5.91326L12.0098 13.2166C12.2589 13.8361 12.9509 14.1502 13.581 13.9296L14.1632 13.7258C14.8355 13.4904 15.1752 12.7412 14.9093 12.0802L11.9723 4.77682ZM10.7311 5.00729C10.8571 4.96318 10.9955 5.02598 11.0453 5.14988L13.9824 12.4532C14.0356 12.5854 13.9676 12.7353 13.8332 12.7823L13.251 12.9862C13.1249 13.0303 12.9865 12.9675 12.9367 12.8436L9.99964 5.5402C9.94647 5.40799 10.0144 5.25815 10.1489 5.21108L10.7311 5.00729Z";
const LIBRARY_FILL =
  "M2.24897 2C1.55918 2 1 2.55938 1 3.2494V12.7448C1 13.4349 1.55918 13.9942 2.24897 13.9942H2.74855C3.43834 13.9942 3.99752 13.4349 3.99752 12.7448V3.2494C3.99752 2.55938 3.43834 2 2.74855 2H2.24897ZM6.24566 2C5.55588 2 4.9967 2.55938 4.9967 3.2494V12.7448C4.9967 13.4349 5.55588 13.9942 6.24566 13.9942H6.74525C7.43504 13.9942 7.99422 13.4349 7.99422 12.7448V3.2494C7.99422 2.55938 7.43504 2 6.74525 2H6.24566ZM11.9722 4.77692C11.7231 4.15743 11.031 3.84341 10.401 4.06395L9.81879 4.26774C9.14648 4.50307 8.80673 5.2523 9.07258 5.91334L12.0097 13.2166C12.2588 13.8361 12.9509 14.1502 13.581 13.9296L14.1632 13.7258C14.8355 13.4904 15.1752 12.7412 14.9093 12.0802L11.9722 4.77692Z";
const SEARCH_REG =
  "M11.0195 11.7266C10.0658 12.5217 8.83875 13 7.5 13C4.46243 13 2 10.5376 2 7.5C2 4.46243 4.46243 2 7.5 2C10.5376 2 13 4.46243 13 7.5C13 8.83875 12.5217 10.0658 11.7266 11.0195L14.8535 14.1464C15.0488 14.3417 15.0488 14.6583 14.8535 14.8536C14.6583 15.0488 14.3417 15.0488 14.1464 14.8536L11.0195 11.7266ZM12 7.5C12 5.01472 9.98528 3 7.5 3C5.01472 3 3 5.01472 3 7.5C3 9.98528 5.01472 12 7.5 12C9.98528 12 12 9.98528 12 7.5Z";
const SEARCH_FILL =
  "M10.8226 11.8833C9.89957 12.5841 8.74835 13 7.5 13C4.46243 13 2 10.5376 2 7.5C2 4.46243 4.46243 2 7.5 2C10.5376 2 13 4.46243 13 7.5C13 8.74835 12.5841 9.89957 11.8833 10.8226L14.7803 13.7197C15.0732 14.0126 15.0732 14.4874 14.7803 14.7803C14.4874 15.0732 14.0126 15.0732 13.7197 14.7803L10.8226 11.8833ZM11.5 7.5C11.5 5.29086 9.70914 3.5 7.5 3.5C5.29086 3.5 3.5 5.29086 3.5 7.5C3.5 9.70914 5.29086 11.5 7.5 11.5C9.70914 11.5 11.5 9.70914 11.5 7.5Z";
const SETTINGS_REG =
  "M7.99994 6C6.89537 6 5.99994 6.89543 5.99994 8C5.99994 9.10457 6.89537 10 7.99994 10C9.10451 10 9.99994 9.10457 9.99994 8C9.99994 6.89543 9.10451 6 7.99994 6ZM6.99994 8C6.99994 7.44772 7.44765 7 7.99994 7C8.55222 7 8.99994 7.44772 8.99994 8C8.99994 8.55228 8.55222 9 7.99994 9C7.44765 9 6.99994 8.55228 6.99994 8ZM10.618 4.39833C10.233 4.46825 9.86392 4.21413 9.7937 3.83074L9.53397 2.41496C9.50816 2.27427 9.39961 2.16301 9.25912 2.13325C8.84818 2.04621 8.42685 2.00195 8 2.00195C7.57289 2.00195 7.1513 2.04627 6.74013 2.13341C6.5996 2.1632 6.49104 2.27452 6.46529 2.41527L6.20629 3.8308C6.1994 3.86844 6.18942 3.90551 6.17647 3.9416C6.04476 4.30859 5.6392 4.49978 5.27062 4.36863L3.91115 3.88463C3.77603 3.83652 3.62511 3.87431 3.52891 3.98033C2.96005 4.60729 2.52892 5.34708 2.2672 6.15302C2.22305 6.28899 2.26562 6.43805 2.37502 6.53053L3.47694 7.46206C3.50626 7.48685 3.53352 7.51399 3.55843 7.5432C3.81177 7.84027 3.77528 8.28558 3.47693 8.53783L2.37502 9.46935C2.26562 9.56183 2.22305 9.71089 2.2672 9.84685C2.52892 10.6528 2.96005 11.3926 3.52891 12.0196C3.62511 12.1256 3.77603 12.1634 3.91115 12.1153L5.27068 11.6312C5.30687 11.6184 5.3441 11.6084 5.38196 11.6015C5.76701 11.5316 6.13608 11.7857 6.2063 12.1691L6.46529 13.5846C6.49104 13.7254 6.5996 13.8367 6.74013 13.8665C7.1513 13.9536 7.57289 13.9979 8 13.9979C8.42685 13.9979 8.84818 13.9537 9.25912 13.8666C9.39961 13.8369 9.50816 13.7256 9.53397 13.5849L9.79368 12.1692C9.8006 12.1314 9.81058 12.0944 9.82353 12.0583C9.95524 11.6913 10.3608 11.5001 10.7294 11.6312L12.0888 12.1153C12.224 12.1634 12.3749 12.1256 12.4711 12.0196C13.04 11.3926 13.4711 10.6528 13.7328 9.84685C13.777 9.71089 13.7344 9.56183 13.625 9.46935L12.5231 8.53782C12.4937 8.51303 12.4665 8.48589 12.4416 8.45667C12.1882 8.1596 12.2247 7.71429 12.5231 7.46205L13.625 6.53053C13.7344 6.43805 13.777 6.28899 13.7328 6.15302C13.4711 5.34708 13.04 4.60729 12.4711 3.98033C12.3749 3.87431 12.224 3.83652 12.0888 3.88463L10.7293 4.36865C10.6931 4.38152 10.6559 4.39146 10.618 4.39833ZM3.99863 4.97726L4.93522 5.3107C5.82017 5.62559 6.79872 5.16815 7.11769 4.2794C7.14903 4.19207 7.17324 4.1021 7.18996 4.01078L7.36738 3.04113C7.5757 3.01512 7.78684 3.00195 8 3.00195C8.213 3.00195 8.42397 3.0151 8.63214 3.04107L8.81011 4.01117C8.98053 4.9408 9.87266 5.55003 10.7967 5.38225C10.8877 5.36572 10.9775 5.34176 11.0647 5.31073L12.0014 4.97726C12.2564 5.31084 12.4684 5.67476 12.6319 6.06064L11.8774 6.6984C11.1566 7.30787 11.0675 8.38649 11.6807 9.10555C11.7408 9.17609 11.8067 9.24166 11.8775 9.3015L12.6319 9.93924C12.4684 10.3251 12.2564 10.689 12.0014 11.0226L11.0646 10.6891C10.1797 10.3742 9.20128 10.8317 8.88231 11.7205C8.85096 11.8078 8.82677 11.8978 8.81004 11.9891L8.63214 12.9588C8.42397 12.9848 8.213 12.9979 8 12.9979C7.78684 12.9979 7.5757 12.9848 7.36738 12.9587L7.18994 11.989C7.01965 11.0592 6.12743 10.4498 5.2033 10.6176C5.11227 10.6342 5.0225 10.6581 4.93528 10.6892L3.99863 11.0226C3.74357 10.689 3.53161 10.3251 3.36814 9.93924L4.12257 9.30148C4.84343 8.69201 4.93254 7.61339 4.31933 6.89433C4.25917 6.82378 4.19332 6.75822 4.12254 6.69838L3.36814 6.06064C3.53161 5.67476 3.74357 5.31084 3.99863 4.97726Z";
const SETTINGS_FILL =
  "M2.2672 6.15302C2.52892 5.34708 2.96005 4.60729 3.52891 3.98033C3.62511 3.87431 3.77603 3.83652 3.91115 3.88463L5.27062 4.36863C5.6392 4.49978 6.04476 4.30859 6.17647 3.9416C6.18942 3.90551 6.1994 3.86844 6.20629 3.8308L6.46529 2.41527C6.49104 2.27452 6.5996 2.1632 6.74013 2.13341C7.1513 2.04627 7.57289 2.00195 8 2.00195C8.42685 2.00195 8.84818 2.04621 9.25912 2.13325C9.39961 2.16301 9.50816 2.27427 9.53397 2.41496L9.7937 3.83074C9.86392 4.21413 10.233 4.46825 10.618 4.39833C10.6559 4.39146 10.6931 4.38153 10.7293 4.36865L12.0888 3.88463C12.224 3.83652 12.3749 3.87431 12.4711 3.98033C13.04 4.60729 13.4711 5.34708 13.7328 6.15302C13.777 6.28899 13.7344 6.43805 13.625 6.53053L12.5231 7.46205C12.2247 7.7143 12.1882 8.1596 12.4416 8.45667C12.4665 8.48589 12.4937 8.51303 12.5231 8.53782L13.625 9.46935C13.7344 9.56183 13.777 9.71089 13.7328 9.84685C13.4711 10.6528 13.04 11.3926 12.4711 12.0196C12.3749 12.1256 12.224 12.1634 12.0888 12.1153L10.7294 11.6312C10.3608 11.5001 9.95524 11.6913 9.82353 12.0583C9.81058 12.0944 9.8006 12.1314 9.79368 12.1692L9.53397 13.5849C9.50816 13.7256 9.39961 13.8369 9.25912 13.8666C8.84818 13.9537 8.42685 13.9979 8 13.9979C7.57289 13.9979 7.1513 13.9536 6.74013 13.8665C6.5996 13.8367 6.49104 13.7254 6.46529 13.5846L6.2063 12.1691C6.13608 11.7857 5.76701 11.5316 5.38196 11.6015C5.3441 11.6084 5.30687 11.6184 5.27068 11.6312L3.91115 12.1153C3.77603 12.1634 3.62511 12.1256 3.52891 12.0196C2.96005 11.3926 2.52892 10.6528 2.2672 9.84685C2.22305 9.71089 2.26562 9.56183 2.37502 9.46935L3.47693 8.53783C3.77528 8.28558 3.81177 7.84027 3.55843 7.5432C3.53352 7.51399 3.50626 7.48685 3.47694 7.46206L2.37502 6.53053C2.26562 6.43805 2.22305 6.28899 2.2672 6.15302ZM6.24988 7.99988C6.24988 8.96638 7.03338 9.74988 7.99988 9.74988C8.96638 9.74988 9.74988 8.96638 9.74988 7.99988C9.74988 7.03338 8.96638 6.24988 7.99988 6.24988C7.03338 6.24988 6.24988 7.03338 6.24988 7.99988Z";

function Fluent({
  size = 22,
  className,
  filled,
  reg,
  fill,
}: NavIconProps & { reg: string; fill: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={filled ? fill : reg} />
    </svg>
  );
}

/** Guide: the EPG's channel rows. */
export function GuideIcon(p: NavIconProps) {
  return <Fluent {...p} reg={GUIDE_REG} fill={GUIDE_FILL} />;
}

/** Sports. */
export function SportsIcon(p: NavIconProps) {
  return <Fluent {...p} reg={SPORTS_REG} fill={SPORTS_FILL} />;
}

/** Stream: the VOD landing page. */
export function StreamIcon(p: NavIconProps) {
  return <Fluent {...p} reg={STREAM_REG} fill={STREAM_FILL} />;
}

/** Discover: browsing the whole catalog. */
export function DiscoverIcon(p: NavIconProps) {
  return <Fluent {...p} reg={DISCOVER_REG} fill={DISCOVER_FILL} />;
}

/** Library: what you have saved. */
export function LibraryIcon(p: NavIconProps) {
  return <Fluent {...p} reg={LIBRARY_REG} fill={LIBRARY_FILL} />;
}

/** Devices / TV — the playlist mode chip. */
export function TvIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 3L12 7L8 3" />
    </Svg>
  );
}

/** The design's rainbow favorite star: dark core under a rainbow
 * gradient, gradient stroke. `vivid` fills at full strength (the guide's
 * starred state) instead of the sidebar's muted 70%. Gradient ids are
 * per-instance so many stars can render at once. */
export function RainbowStarIcon({
  size = 16,
  className,
  vivid = false,
}: IconProps & { vivid?: boolean }) {
  const grad = useId();
  const d =
    "M9.51964 2.92705C9.81899 2.00574 11.1224 2.00574 11.4218 2.92705L12.597 6.54409C12.7309 6.95611 13.1148 7.23507 13.5481 7.23507H17.3512C18.32 7.23507 18.7227 8.47469 17.939 9.04409L14.8622 11.2795C14.5117 11.5342 14.365 11.9856 14.4989 12.3976L15.6742 16.0146C15.9735 16.9359 14.919 17.702 14.1353 17.1326L11.0585 14.8972C10.708 14.6425 10.2334 14.6425 9.88291 14.8972L6.80607 17.1326C6.02236 17.702 4.96788 16.9359 5.26723 16.0146L6.44248 12.3976C6.57635 11.9856 6.42969 11.5342 6.07921 11.2795L3.00237 9.04409C2.21866 8.47469 2.62143 7.23507 3.59015 7.23507H7.39333C7.82656 7.23507 8.21052 6.95611 8.34439 6.54409L9.51964 2.92705Z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 21 21"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* No black understroke: at scaled sizes its antialiased fringe
       * peeks past the gradient stroke as a dark halo. */}
      <path d={d} fill="black" />
      <path
        d={d}
        fill={`url(#${grad})`}
        fillOpacity={vivid ? 1 : 0.7}
        stroke={`url(#${grad})`}
      />
      <defs>
        <linearGradient
          id={grad}
          x1="20.9414"
          y1="12.3353"
          x2="-0.750952"
          y2="9.52432"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF7BF6" />
          <stop offset="0.259615" stopColor="#8696FF" />
          <stop offset="0.528846" stopColor="#84FFA9" />
          <stop offset="0.783654" stopColor="#FFE57F" />
          <stop offset="1" stopColor="#FF9B9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Faint filled star — the guide card's favorite at rest while the card
 * is hovered (Figma 131:213 "Card Hover"). Fills with currentColor so it
 * follows the theme. */
export function StarGhostIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        opacity="0.1"
        d="M6.93138 0.690967C7.23073 -0.230344 8.53414 -0.230344 8.83349 0.690967L10.0087 4.308C10.1426 4.72003 10.5266 4.99899 10.9598 4.99899H14.763C15.7317 4.99899 16.1345 6.2386 15.3508 6.808L12.2739 9.04346C11.9234 9.2981 11.7768 9.74947 11.9107 10.1615L13.0859 13.7785C13.3853 14.6998 12.3308 15.466 11.5471 14.8966L8.47022 12.6611C8.11973 12.4065 7.64514 12.4065 7.29465 12.6611L4.21781 14.8966C3.4341 15.466 2.37962 14.6998 2.67897 13.7785L3.85422 10.1615C3.98809 9.74947 3.84144 9.2981 3.49095 9.04346L0.414113 6.808C-0.369601 6.2386 0.0331748 4.99899 1.0019 4.99899H4.80508C5.2383 4.99899 5.62226 4.72003 5.75613 4.308L6.93138 0.690967Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Dark-core star ringed by the rainbow gradient — the guide card's
 * favorite while the star itself is hovered (Figma 131:230 "Star Hover").
 * Gradient ids are per-instance so many stars can render at once. */
export function StarRainbowHollowIcon({ size = 17, className }: IconProps) {
  const grad = useId();
  const d =
    "M7.43236 1.19097C7.73171 0.269656 9.03512 0.269656 9.33447 1.19097L10.5097 4.808C10.6436 5.22003 11.0275 5.49899 11.4608 5.49899H15.264C16.2327 5.49899 16.6355 6.7386 15.8517 7.308L12.7749 9.54346C12.4244 9.7981 12.2778 10.2495 12.4116 10.6615L13.5869 14.2785C13.8862 15.1998 12.8317 15.966 12.048 15.3966L8.9712 13.1611C8.62071 12.9065 8.14612 12.9065 7.79563 13.1611L4.71879 15.3966C3.93508 15.966 2.8806 15.1998 3.17995 14.2785L4.3552 10.6615C4.48907 10.2495 4.34241 9.7981 3.99193 9.54346L0.915089 7.308C0.131376 6.7386 0.534151 5.49899 1.50287 5.49899H5.30605C5.73928 5.49899 6.12324 5.22003 6.25711 4.808L7.43236 1.19097Z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d={d} fill="#262626" />
      <path d={d} stroke={`url(#${grad})`} />
      <defs>
        <linearGradient
          id={grad}
          x1="18.8541"
          y1="10.5993"
          x2="-2.83823"
          y2="7.78823"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF7BF6" />
          <stop offset="0.259615" stopColor="#8696FF" />
          <stop offset="0.528846" stopColor="#84FFA9" />
          <stop offset="0.783654" stopColor="#FFE57F" />
          <stop offset="1" stopColor="#FF9B9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Interface / Check — the active-accent tick. */
/**
 * Warning triangle — the carriage line's "we named it but could not link
 * it" pill (plan 010 #43).
 *
 * Drawn at the set's own geometry (24 box, stroke 2, round joins) so it
 * sits with the rest, but it renders at 11px, which is why the bar and the
 * dot are short and far apart: at that size a full-height exclamation
 * closes up into a single blob.
 */
export function WarnIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 4 21 19.5H3L12 4Z" />
      <path d="M12 10.5v3.2" />
      <path d="M12 16.6v.1" />
    </Svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 12L10 18L20 6" />
    </Svg>
  );
}

/** Sun — the light half of the Themes panel's theme-style pill. */
export function SunIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Svg>
  );
}

/** Moon — the dark half of the Themes panel's theme-style pill. */
export function MoonIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Box-with-arrow — "opens an external checkout link" on premium theme prices. */
export function ExternalLinkIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </Svg>
  );
}

/** Edit / Pipette — the color-picker eyedropper. */
/* (pipette doc comment restored below — EyeOffIcon slotted in above it) */
/** Crossed-out eye — the sidebar's hover-revealed "hide this folder". */
export function EyeOffIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a16.2 16.2 0 0 1-3.2 4.2M6.6 6.6A16.4 16.4 0 0 0 2 12s3 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}

export function EyeDropperIcon({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m2 22 1-1h3l9-9M3 21v-3l9-9m0 0 3.5-3.5a2.121 2.121 0 1 1 3 3L15 12m-3-3 3 3" />
    </Svg>
  );
}

/** Filled heart — the supporters/Themes-Pass mark on the secret theme card. */
export function HeartIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

/** Media / Play (filled triangle) — for the Stream hero's Watch Now button. */
export function PlayIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.8-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

/** Media / Pause */
export function PauseIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

/** Media / Volume */
export function VolumeIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a8 8 0 0 1 0 12" />
    </Svg>
  );
}

/** Media / Volume muted */
export function MuteIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </Svg>
  );
}

/** Media / Pop out (open in external window) */
export function PopoutIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </Svg>
  );
}

/** Media / Fullscreen (corner arrows) */
export function FullscreenIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    </Svg>
  );
}

export function ExitFullscreenIcon({ size = 20, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    </Svg>
  );
}

