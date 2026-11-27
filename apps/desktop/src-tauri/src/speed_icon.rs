//! Tray icon renderer for the live transfer rate.
//!
//! Windows cannot render arbitrary text next to the tray icon, so the rate is
//! drawn into the icon itself: an upload row on top, a download row below.
//! A compact 3×5 bitmap font keeps this self-contained — the build runs offline
//! and cannot add a text rasterizer crate.

/// Icon edge length in physical pixels. Windows scales it for the DPI in use.
pub(crate) const ICON_SIZE: u32 = 32;

const GLYPH_WIDTH: usize = 3;
const GLYPH_HEIGHT: usize = 5;
const GLYPH_SPACING: u32 = 1;
const SCALE: u32 = 2;

/// Upload row colour, matching `--chart-upload` in the Cyber Flow theme.
const UPLOAD_RGB: [u8; 3] = [0x35, 0xd7, 0xff];
/// Download row colour, matching `--chart-download`.
const DOWNLOAD_RGB: [u8; 3] = [0x7c, 0x65, 0xff];
/// Colour used by the rows that have no text yet (stopped core).
const IDLE_RGB: [u8; 3] = [0x68, 0x78, 0x9f];

/// Formats a byte-per-second rate into at most four characters, e.g. `1.2M`.
///
/// The glyph set has no space, so the unit letter is always attached. Kilo
/// values keep all three digits (`340K`); larger units clamp at `99M`/`99G`
/// because a fourth character would not fit the icon.
pub(crate) fn format_speed(bytes_per_second: u64) -> String {
    const KIB: f64 = 1024.0;
    let value = bytes_per_second as f64;

    if value < KIB {
        return "0".to_owned();
    }
    if value < KIB * KIB {
        return format_scaled(value / KIB, "K", 999.0);
    }
    if value < KIB * KIB * KIB {
        return format_scaled(value / (KIB * KIB), "M", 99.0);
    }
    format_scaled(value / (KIB * KIB * KIB), "G", 99.0)
}

/// One decimal below ten (`9.9M`), no decimal above (`12M`), clamped to `max`.
fn format_scaled(value: f64, unit: &str, max: f64) -> String {
    let value = value.min(max);
    if value >= 10.0 {
        format!("{}{unit}", value.round() as u32)
    } else {
        let tenths = (value * 10.0).round() / 10.0;
        // `9.0M` reads as `9M`; the trailing `.0` would waste a glyph.
        if (tenths.fract() * 10.0).round() == 0.0 {
            format!("{}{unit}", tenths as u32)
        } else {
            format!("{tenths:.1}{unit}")
        }
    }
}

/// Renders a 32×32 RGBA icon with the upload row above the download row.
///
/// `None` rows (a stopped core) render as an idle underline instead of text so
/// the icon still reads as "CapybaraProxy is here, nothing is flowing".
pub(crate) fn render(upload: Option<u64>, download: Option<u64>) -> tauri::image::Image<'static> {
    let mut rgba = vec![0_u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    draw_row(&mut rgba, upload, UPLOAD_RGB, 6);
    draw_row(&mut rgba, download, DOWNLOAD_RGB, 19);

    tauri::image::Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

fn draw_row(rgba: &mut [u8], rate: Option<u64>, color: [u8; 3], top: u32) {
    match rate {
        Some(rate) => {
            let text = format_speed(rate);
            let width = text_width(&text);
            // Centre the glyph run; a four-character rate fills the icon.
            let left = ICON_SIZE.saturating_sub(width) / 2;
            draw_text(rgba, &text, left, top, color);
        }
        None => {
            // A short idle dash keeps both halves visually balanced.
            fill_rect(rgba, 12, top + GLYPH_HEIGHT as u32 / 2, 8, SCALE, IDLE_RGB);
        }
    }
}

fn text_width(text: &str) -> u32 {
    let glyphs = text.chars().count() as u32;
    glyphs * GLYPH_WIDTH as u32 * SCALE + glyphs.saturating_sub(1) * GLYPH_SPACING
}

fn draw_text(rgba: &mut [u8], text: &str, left: u32, top: u32, color: [u8; 3]) {
    let mut cursor = left;
    for character in text.chars() {
        if let Some(glyph) = glyph(character) {
            draw_glyph(rgba, &glyph, cursor, top, color);
        }
        cursor += GLYPH_WIDTH as u32 * SCALE + GLYPH_SPACING;
    }
}

fn draw_glyph(rgba: &mut [u8], rows: &[&str; GLYPH_HEIGHT], left: u32, top: u32, color: [u8; 3]) {
    for (row, pattern) in rows.iter().enumerate() {
        for (column, cell) in pattern.chars().enumerate() {
            if cell == '#' {
                fill_rect(
                    rgba,
                    left + column as u32 * SCALE,
                    top + row as u32 * SCALE,
                    SCALE,
                    SCALE,
                    color,
                );
            }
        }
    }
}

fn fill_rect(rgba: &mut [u8], left: u32, top: u32, width: u32, height: u32, color: [u8; 3]) {
    for y in top..top + height {
        for x in left..left + width {
            if x >= ICON_SIZE || y >= ICON_SIZE {
                continue;
            }
            let offset = ((y * ICON_SIZE + x) * 4) as usize;
            rgba[offset] = color[0];
            rgba[offset + 1] = color[1];
            rgba[offset + 2] = color[2];
            rgba[offset + 3] = 0xff;
        }
    }
}

/// 3×5 glyphs for the characters [`format_speed`] can produce.
fn glyph(character: char) -> Option<[&'static str; GLYPH_HEIGHT]> {
    Some(match character {
        '0' => ["###", "#.#", "#.#", "#.#", "###"],
        '1' => ["..#", "..#", "..#", "..#", "..#"],
        '2' => ["###", "..#", "###", "#..", "###"],
        '3' => ["###", "..#", "###", "..#", "###"],
        '4' => ["#.#", "#.#", "###", "..#", "..#"],
        '5' => ["###", "#..", "###", "..#", "###"],
        '6' => ["###", "#..", "###", "#.#", "###"],
        '7' => ["###", "..#", "..#", "..#", "..#"],
        '8' => ["###", "#.#", "###", "#.#", "###"],
        '9' => ["###", "#.#", "###", "..#", "###"],
        '.' => ["...", "...", "...", "...", "..#"],
        'K' => ["#.#", "#.#", "##.", "#.#", "#.#"],
        'M' => ["#.#", "###", "###", "#.#", "#.#"],
        'G' => ["###", "#..", "#.#", "#.#", "###"],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{format_speed, glyph, render, ICON_SIZE};

    #[test]
    fn formats_rates_into_at_most_four_characters() {
        assert_eq!(format_speed(0), "0");
        assert_eq!(format_speed(900), "0");
        assert_eq!(format_speed(1_024), "1K");
        assert_eq!(format_speed(1_536), "1.5K");
        assert_eq!(format_speed(340 * 1_024), "340K");
        assert_eq!(format_speed(1_048_576), "1M");
        assert_eq!(format_speed(1_258_291), "1.2M");
        assert_eq!(format_speed(1024 * 1024 * 1024), "1G");
        assert_eq!(format_speed(u64::MAX), "99G");

        for rate in [0, 500, 1_024, 12_345, 1_000_000, 1_073_741_824, u64::MAX] {
            assert!(format_speed(rate).chars().count() <= 4);
        }
    }

    #[test]
    fn every_formatted_character_has_a_glyph() {
        for rate in [
            0,
            999,
            1_024,
            20_480,
            1_572_864,
            4_194_304,
            1_073_741_824,
            50_000_000_000,
        ] {
            for character in format_speed(rate).chars() {
                assert!(glyph(character).is_some(), "missing glyph for {character}");
            }
        }
    }

    #[test]
    fn rendered_icon_has_the_expected_shape_and_pixels() {
        let image = render(Some(1_048_576), Some(0));
        assert_eq!(image.width(), ICON_SIZE);
        assert_eq!(image.height(), ICON_SIZE);
        assert_eq!(image.rgba().len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
        assert!(image.rgba().chunks(4).any(|pixel| pixel[3] == 0xff));
    }

    #[test]
    fn a_stopped_core_renders_idle_marks_instead_of_text() {
        let image = render(None, None);
        assert!(image.rgba().chunks(4).any(|pixel| pixel[3] == 0xff));
        assert_eq!(image.rgba().len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
    }
}
