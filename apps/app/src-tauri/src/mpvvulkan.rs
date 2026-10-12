//! Which Vulkan loader the player runs against, and in what order they are
//! tried.
//!
//! The pinned libmpv imports `vulkan-1.dll` (scripts/deps.json), so on a
//! Windows machine with no Vulkan loader (some VMs, a basic display driver)
//! libmpv cannot be loaded at all and the player never starts. The installer
//! ships LunarG's loader in a `vulkan` folder beside libmpv
//! (scripts/fetch-vulkan.mjs). mpv.rs loads one of these before libmpv, and
//! this file is the decision: Windows' own first, ours only when Windows has
//! none.
//!
//! The order matters both ways. A driver's loader knows its driver and ours
//! does not, so ours must never stand in for one that is there. And ours
//! sits in a subfolder, so Windows' normal search never finds it: it has to
//! be asked for by its full path, and once loaded it is what libmpv's own
//! import of `vulkan-1.dll` resolves to.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! mpv.rs does the loading and cannot be built on Linux.

use std::path::{Path, PathBuf};

/// The loader's file name, as libmpv imports it.
pub const DLL: &str = "vulkan-1.dll";

/// Where a loader comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Loader {
    /// By Windows' normal search: a driver's, or one in System32.
    System,
    /// Ours, by this full path.
    Bundled(PathBuf),
}

impl Loader {
    /// What Settings → App → About calls it. Never the path: "BlammyTV's" is
    /// all a person needs to know, and the path has their user name in it.
    pub fn label(&self) -> &'static str {
        match self {
            Loader::System => "Windows' own",
            Loader::Bundled(_) => "BlammyTV's",
        }
    }
}

/// About's word when the search came up empty (`first_loaded` was None): not
/// an error by itself, as libmpv may not have needed one.
pub const NONE_FOUND: &str = "None found";
/// About's word before libmpv has been asked for at all, so the search has not
/// been made.
pub const NOT_LOADED_YET: &str = "Not loaded yet";

/// Where the installer puts ours, in the order they are tried: beside the exe,
/// then in a bundled `resources/` folder. The same two places `load_libmpv`
/// looks for libmpv, so wherever the bundler drops the one it drops the other.
pub fn bundled(exe_dir: &Path) -> [PathBuf; 2] {
    [
        exe_dir.join("vulkan").join(DLL),
        exe_dir.join("resources").join("vulkan").join(DLL),
    ]
}

/// Try the loaders in order and stop at the first that loads. `load` does the
/// loading (mpv.rs, with libloading) and says whether it worked; what it
/// returns comes back with the loader it came from, so the caller can keep it
/// loaded and say which one it was.
///
/// The system's is asked first and ours only after it said no, so a machine
/// with a loader never loads ours. With no `exe_dir` there is no place for
/// ours to be, and the system's is the only one asked. None when nothing
/// loaded: libmpv's own load then fails with an error of its own, which names
/// libmpv, as it always did.
pub fn first_loaded<T>(
    exe_dir: Option<&Path>,
    mut load: impl FnMut(&Loader) -> Option<T>,
) -> Option<(Loader, T)> {
    let mut order = vec![Loader::System];
    if let Some(dir) = exe_dir {
        order.extend(bundled(dir).into_iter().map(Loader::Bundled));
    }
    order.into_iter().find_map(|from| {
        let got = load(&from)?;
        Some((from, got))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exe() -> PathBuf {
        PathBuf::from("app").join("BlammyTV")
    }

    fn vulkan() -> Loader {
        Loader::Bundled(exe().join("vulkan").join("vulkan-1.dll"))
    }

    fn resources() -> Loader {
        Loader::Bundled(exe().join("resources").join("vulkan").join("vulkan-1.dll"))
    }

    /// Run `first_loaded` with a machine where only the loaders in `works`
    /// load, and say what it picked and everything it was asked to try.
    fn run(exe_dir: Option<&Path>, works: &[Loader]) -> (Option<Loader>, Vec<Loader>) {
        let mut asked = Vec::new();
        let got = first_loaded(exe_dir, |from| {
            asked.push(from.clone());
            works.contains(from).then_some(())
        });
        (got.map(|(from, _)| from), asked)
    }

    #[test]
    fn the_places_are_beside_the_exe_then_resources() {
        let [a, b] = bundled(&exe());
        assert_eq!(a, exe().join("vulkan").join("vulkan-1.dll"));
        assert_eq!(
            b,
            exe().join("resources").join("vulkan").join("vulkan-1.dll")
        );
    }

    #[test]
    fn a_machine_with_a_loader_keeps_it_and_never_asks_for_ours() {
        // Everything would load, ours included: the system's still wins, and
        // is the only one asked.
        let (picked, asked) = run(Some(&exe()), &[Loader::System, vulkan(), resources()]);
        assert_eq!(picked, Some(Loader::System));
        assert_eq!(asked, vec![Loader::System]);
    }

    #[test]
    fn with_none_of_its_own_the_machine_gets_ours_from_beside_the_exe() {
        let (picked, asked) = run(Some(&exe()), &[vulkan(), resources()]);
        assert_eq!(picked, Some(vulkan()));
        // The system's was asked first, said no, and the resources copy was
        // never needed.
        assert_eq!(asked, vec![Loader::System, vulkan()]);
    }

    #[test]
    fn a_copy_beside_the_exe_that_will_not_load_is_passed_over_for_resources() {
        // An empty placeholder is a file that exists and does not load, which
        // is all `load` can say about it: the resources copy is tried next.
        let (picked, asked) = run(Some(&exe()), &[resources()]);
        assert_eq!(picked, Some(resources()));
        assert_eq!(asked, vec![Loader::System, vulkan(), resources()]);
    }

    #[test]
    fn nothing_loads_nothing_is_kept_and_every_place_was_tried() {
        let (picked, asked) = run(Some(&exe()), &[]);
        assert_eq!(picked, None);
        assert_eq!(asked, vec![Loader::System, vulkan(), resources()]);
    }

    #[test]
    fn with_no_exe_dir_only_the_systems_is_asked() {
        let (picked, asked) = run(None, &[vulkan()]);
        assert_eq!(picked, None);
        assert_eq!(asked, vec![Loader::System]);
        let (picked, asked) = run(None, &[Loader::System]);
        assert_eq!(picked, Some(Loader::System));
        assert_eq!(asked, vec![Loader::System]);
    }

    #[test]
    fn about_says_which_loader_without_saying_where() {
        assert_eq!(Loader::System.label(), "Windows' own");
        assert_eq!(vulkan().label(), "BlammyTV's");
        assert_eq!(resources().label(), "BlammyTV's");
        // The path is a user's folder, and has no business on the page: two
        // different ones say the same word.
        let elsewhere =
            Loader::Bundled(PathBuf::from("C:\\Users\\someone\\BlammyTV\\vulkan-1.dll"));
        assert_eq!(elsewhere.label(), vulkan().label());
        assert_eq!(NONE_FOUND, "None found");
        assert_eq!(NOT_LOADED_YET, "Not loaded yet");
    }

    #[test]
    fn what_loaded_comes_back_with_the_loader_it_came_from() {
        let got = first_loaded(Some(&exe()), |from| match from {
            Loader::System => None,
            Loader::Bundled(p) => Some(p.to_string_lossy().into_owned()),
        });
        let (from, tag) = got.unwrap();
        assert_eq!(from, vulkan());
        assert!(tag.ends_with("vulkan-1.dll"));
    }
}
