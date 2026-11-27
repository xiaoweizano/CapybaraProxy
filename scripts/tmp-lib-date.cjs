const fs = require("fs");
const p = "apps/desktop/src-tauri/src/lib.rs";
let s = fs.readFileSync(p, "utf8");

function replace(a, b, label) {
  if (!s.includes(a)) throw new Error("missing " + label);
  s = s.replace(a, b);
}

// Local calendar date for the ledger key.
replace(
  [
    "fn now_ms() -> i64 {",
    "    std::time::SystemTime::now()",
    "        .duration_since(std::time::UNIX_EPOCH)",
    "        .ok()",
    "        .and_then(|duration| i64::try_from(duration.as_millis()).ok())",
    "        .unwrap_or(0)",
    "}",
  ].join("\n"),
  [
    "fn now_ms() -> i64 {",
    "    std::time::SystemTime::now()",
    "        .duration_since(std::time::UNIX_EPOCH)",
    "        .ok()",
    "        .and_then(|duration| i64::try_from(duration.as_millis()).ok())",
    "        .unwrap_or(0)",
    "}",
    "",
    "/// Today's date as `YYYY-MM-DD` in local time.",
    "///",
    "/// The traffic ledger is keyed by this rather than by an epoch, so a day",
    "/// boundary matches the operator's clock instead of UTC.",
    "fn local_date() -> String {",
    "    let seconds = std::time::SystemTime::now()",
    "        .duration_since(std::time::UNIX_EPOCH)",
    "        .map(|duration| duration.as_secs())",
    "        .unwrap_or(0);",
    "    let offset = local_utc_offset_seconds();",
    "    format_date(seconds as i64 + offset)",
    "}",
    "",
    "/// Converts a Unix timestamp in seconds to `YYYY-MM-DD`.",
    "///",
    "/// Implemented here rather than through a date crate: the ledger only needs",
    "/// a stable day key, and `chrono` would be a new dependency for one call.",
    "fn format_date(unix_seconds: i64) -> String {",
    "    let days = unix_seconds.div_euclid(86_400);",
    "    // Civil-from-days, after Howard Hinnant's algorithm.",
    "    let z = days + 719_468;",
    "    let era = z.div_euclid(146_097);",
    "    let day_of_era = z - era * 146_097;",
    "    let year_of_era =",
    "        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096)",
    "            / 365;",
    "    let mut year = year_of_era + era * 400;",
    "    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);",
    "    let month_prime = (5 * day_of_year + 2) / 153;",
    "    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;",
    "    let month = if month_prime < 10 {",
    "        month_prime + 3",
    "    } else {",
    "        month_prime - 9",
    "    };",
    "    if month <= 2 {",
    "        year += 1;",
    "    }",
    '    format!("{year:04}-{month:02}-{day:02}")',
    "}",
    "",
    "#[cfg(windows)]",
    "fn local_utc_offset_seconds() -> i64 {",
    "    // `GetTimeZoneInformation` reports the bias in minutes west of UTC.",
    "    use windows_sys::Win32::System::Time::GetTimeZoneInformation;",
    "    let mut info: windows_sys::Win32::System::Time::TIME_ZONE_INFORMATION =",
    "        unsafe { std::mem::zeroed() };",
    "    let status = unsafe { GetTimeZoneInformation(&mut info) };",
    "    // TIME_ZONE_ID_DAYLIGHT = 2 means the daylight bias applies.",
    "    let bias = if status == 2 {",
    "        info.Bias + info.DaylightBias",
    "    } else {",
    "        info.Bias + info.StandardBias",
    "    };",
    "    -i64::from(bias) * 60",
    "}",
    "",
    "#[cfg(not(windows))]",
    "fn local_utc_offset_seconds() -> i64 {",
    "    0",
    "}",
  ].join("\n"),
  "date helpers",
);

// Setup: pass the config directory through.
replace(
  [
    "            app.manage(AppState::new(",
    "                runtime,",
    "                system_integration,",
    "                settings_store,",
    "                loaded_settings.settings.clone(),",
    "                logs,",
    "            ));",
  ].join("\n"),
  [
    "            app.manage(AppState::new(",
    "                runtime,",
    "                system_integration,",
    "                settings_store,",
    "                loaded_settings.settings.clone(),",
    "                logs,",
    "                Some(config_directory.clone()),",
    "            ));",
  ].join("\n"),
  "setup ctor",
);

replace(
  "        AppState::new(runtime, system_integration, store, settings, logs)",
  "        AppState::new(",
  "test ctor anchor",
);
replace(
  [
    "        AppState::new(runtime, system_integration, store, settings, logs)",
  ].join("\n"),
  [
    "        AppState::new(",
    "            runtime,",
    "            system_integration,",
    "            store,",
    "            settings,",
    "            logs,",
    "            Some(directory.to_path_buf()),",
    "        )",
  ].join("\n"),
  "test ctor",
);

fs.writeFileSync(p, s);
console.log("ok");
