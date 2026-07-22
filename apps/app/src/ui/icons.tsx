/**
 * Icon set — the exact "coolicons" (by Kryston Schwarze, github.com/krystonschwarze/coolicons)
 * used in the EPG Figma design. Inlined as components so they inherit color and
 * opacity from CSS via `stroke="currentColor"`, with no asset loading.
 * Source viewBox 24×24, stroke-width 2, round caps/joins — left untouched.
 */

import { useId } from "react";

type IconProps = { size?: number; className?: string };

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

/** Interface / Search_Magnifying_Glass */
export function SearchIcon({ size = 22, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M15 15L21 21M10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10C17 13.866 13.866 17 10 17Z" />
    </Svg>
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

/** Interface / Settings (cog) */
export function SettingsIcon({ size = 24, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20.3499 8.92293L19.9837 8.7192C19.9269 8.68756 19.8989 8.67169 19.8714 8.65524C19.5983 8.49165 19.3682 8.26564 19.2002 7.99523C19.1833 7.96802 19.1674 7.93949 19.1348 7.8831C19.1023 7.82677 19.0858 7.79823 19.0706 7.76998C18.92 7.48866 18.8385 7.17515 18.8336 6.85606C18.8331 6.82398 18.8332 6.79121 18.8343 6.72604L18.8415 6.30078C18.8529 5.62025 18.8587 5.27894 18.763 4.97262C18.6781 4.70053 18.536 4.44993 18.3462 4.23725C18.1317 3.99685 17.8347 3.82534 17.2402 3.48276L16.7464 3.1982C16.1536 2.85658 15.8571 2.68571 15.5423 2.62057C15.2639 2.56294 14.9765 2.56561 14.6991 2.62789C14.3859 2.69819 14.0931 2.87351 13.5079 3.22396L13.5045 3.22555L13.1507 3.43741C13.0948 3.47091 13.0665 3.48779 13.0384 3.50338C12.7601 3.6581 12.4495 3.74365 12.1312 3.75387C12.0992 3.7549 12.0665 3.7549 12.0013 3.7549C11.9365 3.7549 11.9024 3.7549 11.8704 3.75387C11.5515 3.74361 11.2402 3.65759 10.9615 3.50224C10.9334 3.48658 10.9056 3.46956 10.8496 3.4359L10.4935 3.22213C9.90422 2.86836 9.60915 2.69121 9.29427 2.62057C9.0157 2.55807 8.72737 2.55634 8.44791 2.61471C8.13236 2.68062 7.83577 2.85276 7.24258 3.19703L7.23994 3.1982L6.75228 3.48124L6.74688 3.48454C6.15904 3.82572 5.86441 3.99672 5.6517 4.23614C5.46294 4.4486 5.32185 4.69881 5.2374 4.97018C5.14194 5.27691 5.14703 5.61896 5.15853 6.3027L5.16568 6.72736C5.16676 6.79166 5.16864 6.82362 5.16817 6.85525C5.16343 7.17499 5.08086 7.48914 4.92974 7.77096C4.9148 7.79883 4.8987 7.8267 4.86654 7.88237C4.83436 7.93809 4.81877 7.96579 4.80209 7.99268C4.63336 8.26452 4.40214 8.49186 4.12733 8.65572C4.10015 8.67193 4.0715 8.68752 4.01521 8.71871L3.65365 8.91908C3.05208 9.25245 2.75137 9.41928 2.53256 9.65669C2.33898 9.86672 2.19275 10.1158 2.10349 10.3872C2.00259 10.6939 2.00267 11.0378 2.00424 11.7255L2.00551 12.2877C2.00706 12.9708 2.00919 13.3122 2.11032 13.6168C2.19979 13.8863 2.34495 14.134 2.53744 14.3427C2.75502 14.5787 3.05274 14.7445 3.64974 15.0766L4.00808 15.276C4.06907 15.3099 4.09976 15.3266 4.12917 15.3444C4.40148 15.5083 4.63089 15.735 4.79818 16.0053C4.81625 16.0345 4.8336 16.0648 4.8683 16.1255C4.90256 16.1853 4.92009 16.2152 4.93594 16.2452C5.08261 16.5229 5.16114 16.8315 5.16649 17.1455C5.16707 17.1794 5.16658 17.2137 5.16541 17.2827L5.15853 17.6902C5.14695 18.3763 5.1419 18.7197 5.23792 19.0273C5.32287 19.2994 5.46484 19.55 5.65463 19.7627C5.86915 20.0031 6.16655 20.1745 6.76107 20.5171L7.25478 20.8015C7.84763 21.1432 8.14395 21.3138 8.45869 21.379C8.73714 21.4366 9.02464 21.4344 9.30209 21.3721C9.61567 21.3017 9.90948 21.1258 10.4964 20.7743L10.8502 20.5625C10.9062 20.5289 10.9346 20.5121 10.9626 20.4965C11.2409 20.3418 11.5512 20.2558 11.8695 20.2456C11.9015 20.2446 11.9342 20.2446 11.9994 20.2446C12.0648 20.2446 12.0974 20.2446 12.1295 20.2456C12.4484 20.2559 12.7607 20.3422 13.0394 20.4975C13.0639 20.5112 13.0885 20.526 13.1316 20.5519L13.5078 20.7777C14.0971 21.1315 14.3916 21.3081 14.7065 21.3788C14.985 21.4413 15.2736 21.4438 15.5531 21.3855C15.8685 21.3196 16.1657 21.1471 16.7586 20.803L17.2536 20.5157C17.8418 20.1743 18.1367 20.0031 18.3495 19.7636C18.5383 19.5512 18.6796 19.3011 18.764 19.0297C18.8588 18.7252 18.8531 18.3858 18.8417 17.7119L18.8343 17.2724C18.8332 17.2081 18.8331 17.1761 18.8336 17.1445C18.8383 16.8247 18.9195 16.5104 19.0706 16.2286C19.0856 16.2007 19.1018 16.1726 19.1338 16.1171C19.166 16.0615 19.1827 16.0337 19.1994 16.0068C19.3681 15.7349 19.5995 15.5074 19.8744 15.3435C19.9012 15.3275 19.9289 15.3122 19.9838 15.2818L19.9857 15.2809L20.3472 15.0805C20.9488 14.7472 21.2501 14.5801 21.4689 14.3427C21.6625 14.1327 21.8085 13.8839 21.8978 13.6126C21.9981 13.3077 21.9973 12.9658 21.9958 12.2861L21.9945 11.7119C21.9929 11.0287 21.9921 10.6874 21.891 10.3828C21.8015 10.1133 21.6555 9.86561 21.463 9.65685C21.2457 9.42111 20.9475 9.25526 20.3517 8.92378L20.3499 8.92293Z" />
      <path d="M8.00033 12C8.00033 14.2091 9.79119 16 12.0003 16C14.2095 16 16.0003 14.2091 16.0003 12C16.0003 9.79082 14.2095 7.99996 12.0003 7.99996C9.79119 7.99996 8.00033 9.79082 8.00033 12Z" />
    </Svg>
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

