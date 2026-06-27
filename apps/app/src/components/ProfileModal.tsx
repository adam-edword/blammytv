import { useEffect, useRef } from "react";
import { AccountIcon, CloseIcon } from "./icons";
import { fileToAvatar, type Profile } from "../lib/profile";

/** A small, purely-cosmetic "account": a name + avatar, stored on-device.
 * Changes apply immediately (and the header icon becomes the avatar). */
export function ProfileModal({
  open,
  profile,
  onChange,
  onClose,
}: {
  open: boolean;
  profile: Profile;
  onChange: (p: Profile) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    try {
      onChange({ ...profile, avatar: await fileToAvatar(file) });
    } catch {
      /* ignore unreadable images */
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-btn profile-modal__close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="profile-modal__avatar">
          {profile.avatar ? (
            <img src={profile.avatar} alt="" />
          ) : (
            <AccountIcon size={44} />
          )}
        </div>

        <div className="profile-modal__photo-actions">
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => fileRef.current?.click()}
          >
            {profile.avatar ? "Change photo" : "Add photo"}
          </button>
          {profile.avatar && (
            <button
              className="btn btn--sm"
              type="button"
              onClick={() => onChange({ ...profile, avatar: null })}
            >
              Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={pickPhoto}
          />
        </div>

        <label className="field profile-modal__name">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            type="text"
            value={profile.name}
            placeholder="Your name"
            maxLength={40}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
          />
        </label>

        <button
          className="btn btn--primary profile-modal__done"
          type="button"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
