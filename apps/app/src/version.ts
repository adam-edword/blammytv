/** Displayed build version (shown in the header). The Android build's
 * versionName is set to match in gen/android/app/build.gradle.kts. Kept distinct
 * from tauri.conf.json > version ("0.2.4", what the self-updater compares) so
 * this can carry a non-semver test-build suffix like "a". */
export const APP_VERSION = "0.2.4a";
