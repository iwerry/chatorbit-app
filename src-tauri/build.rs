fn main() {
    println!("cargo:rerun-if-env-changed=ORBI_UPDATER_PUBLIC_KEY");
    println!(
        "cargo:rustc-env=ORBI_UPDATER_PUBLIC_KEY={}",
        std::env::var("ORBI_UPDATER_PUBLIC_KEY").unwrap_or_default()
    );
    println!(
        "cargo:rustc-env=ORBI_BUILD_UNIX={}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    tauri_build::build()
}
