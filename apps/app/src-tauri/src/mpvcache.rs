//! Live TV's disk cache: where it lives, what mpv is told for it, and when it
//! stops growing (plan 029, phase 1).
//!
//! A live channel's rewind buffer used to be mpv's in-memory cache, 256MiB back,
//! so minutes. On disk it can hold hours. mpv.rs sets the options; this file is
//! the decisions, so the host crate (scripts/mvproxy-host) can run their tests.
//! mpv.rs cannot be built on Linux.
//!
//! What mpv's own docs and demuxer say, checked against a real mpv 0.37 (a
//! looped MPEG-TS over HTTP, 25 fps video and AAC, 72 packets a second):
//!
//! - With `cache-on-disk`, `demuxer-max-bytes`, `demuxer-max-back-bytes` and
//!   `demuxer-donate-buffer` apply to packet METADATA only (options.rst, under
//!   `--cache-on-disk`). Measured: 256 bytes a packet, 66MB an hour. A 2MiB back
//!   limit kept a 112s window, which is 2MiB at 18.4KB a second.
//! - The cache FILE is append-only and is never trimmed: "the file space freed
//!   by it is not reused". Measured: the window start moved on as it was
//!   pruned and the file stayed the size of everything read. So a time limit
//!   bounds what can be rewound to, not what is on the disk, and a channel left
//!   on grows the file for as long as it is open. `MAX_FILE_BYTES` and
//!   `MIN_FREE_BYTES` are the only bounds the disk has.
//! - `cache-on-disk=no` at runtime stops the file growing and carries on in
//!   memory with the window intact (measured: the file froze, the seekable range
//!   kept going from 0 to 30s). The file stays open until the media is closed.
//! - `demuxer-cache-dir` is where the file goes; mpv makes the folder and
//!   unlinks the file as soon as it is created, and deletes it when the media
//!   closes. On Windows libmpv found no default folder (Phase 0, no
//!   `file-cache-bytes`), so the app picks one and empties it at startup, for
//!   whatever a crash left.

use std::path::{Path, PathBuf};

/// How far back a live channel can be rewound, at least.
pub const BACK_SECS: u64 = 2 * 60 * 60;
/// Packets a second the limit is sized for, all streams: 60 fps video and two
/// audio tracks is about 150. Measured on a 25 fps stream with one audio track:
/// 72. A channel with fewer keeps a longer window than `BACK_SECS`.
pub const PACKETS_PER_SEC: u64 = 150;
/// Bytes of metadata mpv counts for one packet on disk. Measured: 256. A newer
/// mpv may count differently, hence the margin.
pub const PACKET_BYTES: u64 = 320;
/// The disk cache stops growing under this much free space.
pub const MIN_FREE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// The file stops growing at this size, because mpv never trims it. 2 hours at
/// 13 Mbit/s, so a channel left on overnight cannot fill the disk.
pub const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024 * 1024;

/// The folder under the app's data folder.
const FOLDER: &str = "rewind-cache";

/// Where the cache files go, under `base` (the app's local data folder).
pub fn dir_under(base: &Path) -> PathBuf {
    base.join(FOLDER)
}

/// mpv's name for a cache file (`mpv-cache-XXXXXX.dat`, demux/cache.c).
fn is_cache_file(name: &str) -> bool {
    name.starts_with("mpv-cache-") && name.ends_with(".dat")
}

/// Make `dir` and empty it of cache files, which only a crash leaves (mpv
/// removes its own). Anything else in it is left alone. Returns how many it
/// removed.
pub fn prepare(dir: &Path) -> std::io::Result<usize> {
    std::fs::create_dir_all(dir)?;
    let mut removed = 0;
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name();
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        let ours = name.to_str().is_some_and(is_cache_file);
        if is_file && ours && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// The size mpv is given for a live channel's forward and back limits, in KiB:
/// `BACK_SECS` of packets, sized generously.
fn live_kib() -> u64 {
    BACK_SECS * PACKETS_PER_SEC * PACKET_BYTES / 1024
}

/// The per-file cache options, set before every `loadfile` (and at startup, for
/// the in-memory kind).
///
/// On disk, both limits are the same: the forward one is what a long pause fills
/// (the reader keeps going while paused, and all of it is ahead of the playhead),
/// and the back one is what a long watch fills. `demuxer-donate-buffer=no` keeps
/// them apart, or the back buffer would use the unused forward one as well and
/// the window could reach twice as far.
///
/// In memory, the numbers the player has always had (see mpv.rs).
pub fn options(disk: bool) -> [(&'static str, String); 4] {
    if disk {
        let limit = format!("{}KiB", live_kib());
        [
            ("cache-on-disk", "yes".into()),
            ("demuxer-max-bytes", limit.clone()),
            ("demuxer-max-back-bytes", limit),
            ("demuxer-donate-buffer", "no".into()),
        ]
    } else {
        [
            ("cache-on-disk", "no".into()),
            ("demuxer-max-bytes", "512MiB".into()),
            ("demuxer-max-back-bytes", "256MiB".into()),
            ("demuxer-donate-buffer", "yes".into()),
        ]
    }
}

/// Whether the disk cache may be used or go on growing. `free` is the free space
/// on the volume, None when it could not be read (then no: the memory cache
/// risks nothing). `file` is the cache file's size so far, 0 at the start of a
/// file.
pub fn keep_disk(free: Option<u64>, file: u64) -> bool {
    free.is_some_and(|f| f >= MIN_FREE_BYTES) && file < MAX_FILE_BYTES
}

/// The cache file's size in a `demuxer-cache-state` reading, or None when
/// there is no file (the field is left out unless the media has one).
pub fn file_bytes(state: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(state)
        .ok()?
        .get("file-cache-bytes")?
        .as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("blammytv-mpvcache-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn get<'a>(o: &'a [(&'static str, String); 4], k: &str) -> &'a str {
        &o.iter().find(|(n, _)| *n == k).unwrap().1
    }

    #[test]
    fn live_goes_to_disk_with_a_time_sized_limit() {
        let o = options(true);
        assert_eq!(get(&o, "cache-on-disk"), "yes");
        // 7200s x 150 packets x 320 bytes = 337500KiB, spelled out so a change
        // to any of the three is a change to this line.
        assert_eq!(get(&o, "demuxer-max-bytes"), "337500KiB");
        assert_eq!(get(&o, "demuxer-max-back-bytes"), "337500KiB");
        // Strict, or the back buffer takes the forward one too.
        assert_eq!(get(&o, "demuxer-donate-buffer"), "no");
    }

    #[test]
    fn vod_keeps_the_in_memory_numbers_it_always_had() {
        let o = options(false);
        assert_eq!(get(&o, "cache-on-disk"), "no");
        assert_eq!(get(&o, "demuxer-max-bytes"), "512MiB");
        assert_eq!(get(&o, "demuxer-max-back-bytes"), "256MiB");
        assert_eq!(get(&o, "demuxer-donate-buffer"), "yes");
    }

    #[test]
    fn both_kinds_set_the_same_four_options() {
        let names = |o: [(&'static str, String); 4]| o.map(|(n, _)| n);
        assert_eq!(names(options(true)), names(options(false)));
    }

    #[test]
    fn the_limit_holds_two_hours_of_a_busy_stream() {
        // The measured stream: 72 packets a second at 256 bytes is 66MB an hour.
        let per_hour = 72 * 3600 * 256;
        let limit = live_kib() * 1024;
        assert!(limit >= 2 * per_hour * 2, "{limit} holds under 4 hours of the measured stream");
        // And a worse one than any measured: 150 packets a second at 320.
        assert!(limit >= BACK_SECS * 150 * 320);
    }

    #[test]
    fn the_folder_is_under_the_apps_own() {
        assert_eq!(dir_under(Path::new("/data/app")), Path::new("/data/app/rewind-cache"));
    }

    #[test]
    fn startup_empties_only_cache_files() {
        let d = temp("empty");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        std::fs::write(d.join("mpv-cache-a1B2c3.dat"), b"x").unwrap();
        std::fs::write(d.join("mpv-cache-zzzzzz.dat"), b"y").unwrap();
        std::fs::write(d.join("notes.txt"), b"keep").unwrap();
        std::fs::write(d.join("mpv-cache-x.txt"), b"keep").unwrap();
        // A folder that looks like one is not a file.
        std::fs::create_dir_all(d.join("mpv-cache-dir.dat")).unwrap();
        assert_eq!(prepare(&d).unwrap(), 2);
        let mut left: Vec<String> = std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["mpv-cache-dir.dat", "mpv-cache-x.txt", "notes.txt", "sub"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn startup_makes_the_folder_when_it_is_not_there() {
        let d = temp("make").join("deep").join("rewind-cache");
        assert_eq!(prepare(&d).unwrap(), 0);
        assert!(d.is_dir());
        let _ = std::fs::remove_dir_all(temp("make"));
    }

    #[test]
    fn startup_says_so_when_the_folder_cannot_be_made() {
        // A file where the folder should be.
        let d = temp("blocked");
        std::fs::create_dir_all(&d).unwrap();
        let blocker = d.join("rewind-cache");
        std::fs::write(&blocker, b"x").unwrap();
        assert!(prepare(&blocker).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    const GB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn disk_needs_two_gigabytes_free() {
        assert!(keep_disk(Some(2 * GB), 0));
        assert!(keep_disk(Some(500 * GB), 0));
        assert!(!keep_disk(Some(2 * GB - 1), 0));
        assert!(!keep_disk(Some(0), 0));
    }

    #[test]
    fn disk_is_off_when_free_space_is_unknown() {
        assert!(!keep_disk(None, 0));
    }

    #[test]
    fn disk_stops_at_the_file_cap_however_much_is_free() {
        assert!(keep_disk(Some(500 * GB), MAX_FILE_BYTES - 1));
        assert!(!keep_disk(Some(500 * GB), MAX_FILE_BYTES));
        assert_eq!(MAX_FILE_BYTES, 12 * GB);
    }

    #[test]
    fn the_cache_file_size_is_read_from_the_state() {
        let on = r#"{"total-bytes":6637056,"file-cache-bytes":96779493,"seekable-ranges":[]}"#;
        assert_eq!(file_bytes(on), Some(96_779_493));
        // No file: the field is not there.
        assert_eq!(file_bytes(r#"{"total-bytes":1}"#), None);
        assert_eq!(file_bytes("not json"), None);
        assert_eq!(file_bytes(r#"{"file-cache-bytes":-1}"#), None);
    }
}
