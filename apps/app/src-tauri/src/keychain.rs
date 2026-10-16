//! The macOS Keychain, as the same three calls credman.rs has on Windows
//! (`read`, `write`, `delete`, by name): what trakt.rs, mal.rs and aiojf.rs keep
//! their sessions in. One generic password per name, in the user's login
//! keychain, under the service "BlammyTV".

use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

const SERVICE: &str = "BlammyTV";

pub fn read(target: &str) -> Option<Vec<u8>> {
    get_generic_password(SERVICE, target).ok()
}

pub fn write(target: &str, blob: &[u8]) -> Result<(), String> {
    set_generic_password(SERVICE, target, blob).map_err(|e| e.to_string())
}

pub fn delete(target: &str) {
    let _ = delete_generic_password(SERVICE, target);
}
