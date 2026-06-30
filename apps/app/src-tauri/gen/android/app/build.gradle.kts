import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.blammytv.app"
    defaultConfig {
        // IPTV streams are frequently plain HTTP (or HTTPS that 302s to an HTTP
        // CDN), so cleartext must be allowed for playback — in release too, not
        // just debug.
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "com.blammytv.app"
        minSdk = 24
        targetSdk = 36
        // Test-build version label. Set here (not derived from tauri.conf.json,
        // which stays valid semver "0.2.4" for the updater) so the "a" suffix is
        // allowed. Bump versionCode for every new build you sideload, so it
        // installs over the previous one instead of being rejected as a downgrade.
        versionCode = 20240
        versionName = "0.2.4a"
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // M1 player: Media3 PlayerView (custom BlammyTV controller layout) rendered
    // on top of the WebView, fullscreen, while watching.
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    // Loads the clearlogo (a remote URL from the catalog) into the player chrome.
    implementation("io.coil-kt:coil:2.7.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")