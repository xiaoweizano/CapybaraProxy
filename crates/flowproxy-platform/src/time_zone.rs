//! Local time-zone offset.
//!
//! The traffic ledger keys rows by the operator's calendar day, so it needs the
//! offset from UTC rather than the wall clock alone. Kept in this crate because
//! it already depends on `windows-sys`; the desktop crate would otherwise need
//! its own Windows dependency for one call.

/// Current offset from UTC, in seconds, including daylight time.
///
/// On non-Windows targets this returns `0`: those platforms stay `unverified`
/// for system integration, so a UTC day key is the honest answer there.
#[cfg(windows)]
pub fn local_utc_offset_seconds() -> i64 {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};

    let mut info: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
    // The return value is TIME_ZONE_ID_DAYLIGHT (2) while daylight time is in
    // effect, which is when the daylight bias applies on top of the base bias.
    let status = unsafe { GetTimeZoneInformation(&mut info) };
    let bias = if status == 2 {
        info.Bias + info.DaylightBias
    } else {
        info.Bias + info.StandardBias
    };
    // The reported bias is in minutes *west* of UTC, so the sign is inverted.
    -i64::from(bias) * 60
}

#[cfg(not(windows))]
pub fn local_utc_offset_seconds() -> i64 {
    0
}

#[cfg(test)]
mod tests {
    use super::local_utc_offset_seconds;

    #[test]
    fn offset_stays_within_a_plausible_range() {
        // Real zones run from UTC-12 to UTC+14; anything outside means the
        // bias arithmetic (or its sign) is wrong.
        let offset = local_utc_offset_seconds();
        assert!(
            (-12 * 3_600..=14 * 3_600).contains(&offset),
            "offset {offset}s is outside the real-world range"
        );
        assert_eq!(offset % 60, 0, "offsets are whole minutes");
    }
}
