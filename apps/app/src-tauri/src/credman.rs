//! Windows Credential Manager, as three calls on one generic credential per
//! name: what trakt.rs and mal.rs keep their sessions in. Per user, on this
//! machine only. A blob holds at most 2,560 bytes
//! (CRED_MAX_CREDENTIAL_BLOB_SIZE), which is why MAL's session takes two.

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn read(target: &str) -> Option<Vec<u8>> {
    let target = wide(target);
    let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut cred).ok()?;
        let c = &*cred;
        // An empty credential has a null blob, and a slice from a null
        // pointer is undefined behaviour even at length 0.
        let blob = if c.CredentialBlob.is_null() || c.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec()
        };
        CredFree(cred as *const _);
        Some(blob)
    }
}

pub fn write(target: &str, blob: &[u8]) -> Result<(), String> {
    let mut blob = blob.to_vec();
    let mut target = wide(target);
    let mut user = wide("BlammyTV");
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    unsafe { CredWriteW(&cred, 0) }.map_err(|e| e.to_string())
}

pub fn delete(target: &str) {
    let target = wide(target);
    let _ = unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) };
}
