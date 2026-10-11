import { useRef, useState } from "react";
import { EYEBROW } from "../../ui/eyebrow";
import { Segmented } from "../../ui/Segmented";
import { Combobox, type ComboboxOption } from "../../ui/Combobox";
import { Toggle } from "../../ui/Toggle";
import { loadAioConn } from "../aiojf/conn";
import { loadOneClickPlay, saveOneClickPlay } from "./oneClickPlay";
import { loadSourceFailover, saveSourceFailover } from "./failover";
import {
  AUTO,
  LANGUAGES,
  SUBS_OFF,
  loadAudioLang,
  loadSubLang,
  saveAudioLang,
  saveSubLang,
} from "./languagePrefs";
import {
  SKIP_LINES,
  SKIP_MODES,
  loadSkipping,
  saveSkipping,
  type SkipMode,
  type SkipType,
  type Skipping,
} from "./skipping";
import {
  AUTOPLAY_TABS,
  UP_NEXT_CARD_TABS,
  loadAutoplayNext,
  loadUpNextCard,
  saveAutoplayNext,
  saveUpNextCard,
  type AutoplayNext,
  type UpNextCard,
} from "./upNext";
import { SignInNote } from "./SignInNote";

/**
 * The language pickers' options. Built once at module scope, not per render:
 * the list is 28 entries and never changes, and rebuilding it every render
 * would hand Combobox a new array identity each time for nothing.
 *
 * The code rides along as a search keyword so typing "es" finds Spanish as
 * well as typing "Spanish" does. That is the one thing the native <select>
 * did that a plain label list would have lost.
 */
const LANG_OPTIONS: ComboboxOption[] = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  keywords: [l.code],
}));
const AUDIO_OPTIONS: ComboboxOption[] = [
  { value: AUTO, label: "No preference" },
  ...LANG_OPTIONS,
];
const SUB_OPTIONS: ComboboxOption[] = [
  { value: AUTO, label: "No preference" },
  { value: SUBS_OFF, label: "Off" },
  ...LANG_OPTIONS,
];

/**
 * Playback: how it plays. What the app DOES when you press play, filed here
 * and not with how it looks (the 0.8.0 rule). One-Click Play, Failover,
 * Language and Skip Behavior sat in Customize's Stream panel, under "how it
 * looks", until the five pages (v0.11.26). Up Next and Skipping (which
 * replaced Skip Behavior) are plan 025's P3a.
 *
 * Stream only for now: Live TV has no playback rows yet, so there is no
 * Live TV / Stream pill, and the group is named for the world it governs.
 * Still gated on an AIOStreams, because with none there is nothing to play
 * and nothing for them to govern. Read once per mount, and a page mounts
 * each time you arrive, so signing in on Sources reveals them on your way
 * here.
 */
export function PlaybackPage() {
  const hasAddon = useRef(!!loadAioConn()).current;

  const [oneClick, setOneClick] = useState<boolean>(loadOneClickPlay);
  const [failover, setFailover] = useState<boolean>(loadSourceFailover);
  const [autoplay, setAutoplay] = useState<AutoplayNext>(loadAutoplayNext);
  const [upNextCard, setUpNextCard] = useState<UpNextCard>(loadUpNextCard);
  const [skipping, setSkipping] = useState<Skipping>(loadSkipping);
  const [audioLang, setAudioLang] = useState<string>(loadAudioLang);
  const [subLang, setSubLang] = useState<string>(loadSubLang);

  const pickSkip = (type: SkipType, mode: SkipMode) => {
    const next = { ...skipping, [type]: mode };
    setSkipping(next);
    saveSkipping(next);
  };

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>Stream</h3>
      {!hasAddon && <SignInNote />}

      {hasAddon && (
        <section className="settings-section">
          <div className="customize-row" data-setting="one-click-play">
            <div>
              <h4 className="customize-row__title">One-Click Play Movies</h4>
              <p className="settings__section-note settings__section-note--dim">
                Clicking a movie plays the best cached source right away.
                Uncached is never auto-played.
              </p>
            </div>
            <Toggle
              on={oneClick}
              onChange={() => {
                const next = !oneClick;
                setOneClick(next);
                saveOneClickPlay(next);
              }}
              label="One-click play"
            />
          </div>

          <div className="customize-row" data-setting="source-failover">
            <div>
              <h4 className="customize-row__title">Auto Source Failover</h4>
              <p className="settings__section-note settings__section-note--dim">
                A source dying mid-play jumps to the next cached one. Off shows
                a button instead.
              </p>
            </div>
            <Toggle
              on={failover}
              onChange={() => {
                const next = !failover;
                setFailover(next);
                saveSourceFailover(next);
              }}
              label="Auto source failover"
            />
          </div>

          <div className="customize-row" data-setting="autoplay-next">
            <div>
              <h4 className="customize-row__title">Autoplay Next Episode</h4>
              <p className="settings__section-note settings__section-note--dim">
                The next episode starts by itself when one ends, after the
                countdown. Off waits for you.
              </p>
            </div>
            <Segmented
              label="Autoplay next episode"
              options={AUTOPLAY_TABS}
              value={String(autoplay)}
              onChange={(k) => {
                const next = Number(k) as AutoplayNext;
                setAutoplay(next);
                saveAutoplayNext(next);
              }}
            />
          </div>

          {/* Stacked, not a row: three options, two of them wordy. */}
          <div className="customize-stack" data-setting="up-next-card">
            <div>
              <h4 className="customize-row__title">Up Next Card</h4>
              <p className="settings__section-note settings__section-note--dim">
                The corner card that offers the next episode while one is
                still playing. At the credits goes by the file&rsquo;s own
                markers and chapters; Last minute is the final 60 seconds.
              </p>
            </div>
            <Segmented
              className="self-start"
              label="Up next card"
              options={UP_NEXT_CARD_TABS}
              value={upNextCard}
              onChange={(k: UpNextCard) => {
                setUpNextCard(k);
                saveUpNextCard(k);
              }}
            />
          </div>

          {/* Stacked: four lines of three options, and a switch under them. */}
          <div className="customize-stack" data-setting="skipping">
            <div>
              <h4 className="customize-row__title">Skipping</h4>
              <p className="settings__section-note settings__section-note--dim">
                What happens at an intro, recap, credits or preview, from the
                file&rsquo;s chapters and skip markers: a button, skipped for
                you, or nothing. Combine makes the credits and the preview
                after them one jump.
              </p>
            </div>
            <div className="skip-lines">
              {SKIP_LINES.map(({ type, label }) => (
                <div className="skip-line" key={type}>
                  <span className="skip-line__label">{label}</span>
                  <Segmented
                    label={label}
                    options={SKIP_MODES}
                    value={skipping[type]}
                    onChange={(k: SkipMode) => pickSkip(type, k)}
                  />
                </div>
              ))}
              <div className="skip-line">
                <span className="skip-line__label">Combine Credits &amp; Preview</span>
                <Toggle
                  on={skipping.combine}
                  onChange={(on) => {
                    const next = { ...skipping, combine: on };
                    setSkipping(next);
                    saveSkipping(next);
                  }}
                  label="Combine credits and preview"
                />
              </div>
            </div>
          </div>

          {/* Stacked, not a row: two pickers do not fit beside a label in the
            * page's column (the rail takes 208px of the card), and the label
            * was squeezed to a sliver. */}
          <div className="customize-stack" data-setting="preferred-language">
            <div>
              <h4 className="customize-row__title">Preferred Language</h4>
              <p className="settings__section-note settings__section-note--dim">
                Every stream tries to load these. A track you pick by hand on a
                particular show still wins for that show, and anything the
                stream doesn&rsquo;t carry is left alone.
              </p>
            </div>
            <div className="customize-langs">
              <div className="customize-lang">
                <span>Audio</span>
                <Combobox
                  className="customize-lang__select w-44"
                  ariaLabel="Preferred audio language"
                  options={AUDIO_OPTIONS}
                  value={audioLang}
                  placeholder="No preference"
                  emptyText="No language found."
                  onChange={(v) => {
                    setAudioLang(v);
                    saveAudioLang(v);
                  }}
                />
              </div>
              <div className="customize-lang">
                <span>Subtitles</span>
                <Combobox
                  className="customize-lang__select w-44"
                  ariaLabel="Preferred subtitle language"
                  options={SUB_OPTIONS}
                  value={subLang}
                  placeholder="No preference"
                  emptyText="No language found."
                  onChange={(v) => {
                    setSubLang(v);
                    saveSubLang(v);
                  }}
                />
              </div>
            </div>
          </div>

        </section>
      )}
    </>
  );
}
