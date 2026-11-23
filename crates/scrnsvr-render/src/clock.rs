//! Clock overlay text, laid out like the Electron overlay's CSS
//! (`src/renderer/clock.css`). Ported from `native/renderer/clock.cc`.

use scrnsvr_core::ClockSpec;

/// Clock text rendered by Pango: premultiplied RGBA rows from the top.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClockImage {
    pub pixels: Vec<u8>,
    pub width: i32,
    pub height: i32,
    /// Top-left corner in buffer pixels.
    pub x: i32,
    pub y: i32,
}

#[derive(Default)]
struct Text {
    layout: Option<pango::Layout>,
    width: f64,
    height: f64,
    baseline: f64,
}

/// One run of text at an absolute pixel size; letter spacing is in device units too.
fn layout_text(cr: &cairo::Context, spec: &ClockSpec, value: &str, pixels: f64, letter_spacing_em: f64) -> Text {
    if value.is_empty() || pixels <= 0.0 {
        return Text::default();
    }
    let layout = pangocairo::functions::create_layout(cr);
    let mut font = pango::FontDescription::from_string(&spec.family);
    font.set_absolute_size(pixels * f64::from(pango::SCALE));
    font.set_weight(pango::Weight::__Unknown(spec.weight.clamp(100, 1000)));
    layout.set_font_description(Some(&font));
    let attributes = pango::AttrList::new();
    attributes.insert(pango::AttrInt::new_letter_spacing((letter_spacing_em * pixels * f64::from(pango::SCALE)).round() as i32));
    layout.set_attributes(Some(&attributes));
    layout.set_text(value);
    let (_, logical) = layout.pixel_extents();
    Text {
        width: f64::from(logical.width()),
        height: f64::from(logical.height()),
        baseline: f64::from(layout.baseline()) / f64::from(pango::SCALE),
        layout: Some(layout),
    }
}

#[derive(Default)]
struct Block {
    digits: Text,
    period: Text,
    date: Text,
    size: f64,
    width: f64,
    height: f64,
    time_height: f64,
    date_top: f64,
    date_height: f64,
    period_gap: f64,
}

impl Block {
    fn time_width(&self) -> f64 {
        self.digits.width + self.period_gap + self.period.width
    }
}

fn measure(cr: &cairo::Context, spec: &ClockSpec, size: f64) -> Block {
    let digits = layout_text(cr, spec, &spec.time, size, -0.035);
    let period = layout_text(cr, spec, &spec.period, size * 0.25, 0.04);
    let date = layout_text(cr, spec, &spec.date, size * 0.22, 0.06);
    // .clock-period margin-inline-start: .5em of its own 0.25em font.
    let period_gap = if period.layout.is_some() { size * 0.125 } else { 0.0 };
    let time_height = size * 1.1;
    let date_top = time_height + if date.layout.is_some() { size * 0.22 * 0.65 } else { 0.0 };
    let date_height = if date.layout.is_some() { size * 0.22 * 1.4 } else { 0.0 };
    let mut block = Block { digits, period, date, size, time_height, date_top, date_height, period_gap, ..Block::default() };
    block.width = block.time_width().max(block.date.width);
    block.height = block.date_top + block.date_height;
    block
}

#[derive(Clone, Copy, PartialEq)]
enum Align {
    Start,
    Center,
    End,
}

/// Draw the block's text at an origin, aligned within its width.
fn draw_block(cr: &cairo::Context, block: &Block, x: f64, y: f64, align: Align) {
    let offset = |width: f64| match align {
        Align::Start => 0.0,
        Align::Center => (block.width - width) / 2.0,
        Align::End => block.width - width,
    };
    let line_x = x + offset(block.time_width());
    // Half-leading centers the glyph box in its 1.1em line.
    let baseline = y + (block.time_height - block.digits.height) / 2.0 + block.digits.baseline;
    for layout in [&block.digits.layout, &block.period.layout, &block.date.layout].into_iter().flatten() {
        pangocairo::functions::update_layout(cr, layout);
    }
    if let Some(layout) = &block.digits.layout {
        cr.move_to(line_x, baseline - block.digits.baseline);
        pangocairo::functions::show_layout(cr, layout);
    }
    if let Some(layout) = &block.period.layout {
        cr.move_to(line_x + block.digits.width + block.period_gap, baseline - block.period.baseline);
        pangocairo::functions::show_layout(cr, layout);
    }
    if let Some(layout) = &block.date.layout {
        let top = y + block.date_top + (block.date_height - block.date.height) / 2.0;
        cr.move_to(x + offset(block.date.width), top);
        pangocairo::functions::show_layout(cr, layout);
    }
}

/// Three box-blur passes approximate a Gaussian on an 8-bit alpha mask.
fn blur(data: &mut [u8], width: usize, height: usize, stride: usize, radius: usize) {
    if radius < 1 || width == 0 || height == 0 {
        return;
    }
    let span = (2 * radius + 1) as i32;
    let r = radius as isize;
    let mut line = vec![0u8; width.max(height)];
    let clamp = |value: isize, max: usize| value.clamp(0, max as isize - 1) as usize;
    for _ in 0..3 {
        for y in 0..height {
            let row = &mut data[y * stride..y * stride + width];
            let mut sum: i32 = (-r..=r).map(|x| i32::from(row[clamp(x, width)])).sum();
            for x in 0..width {
                line[x] = (sum / span) as u8;
                sum += i32::from(row[clamp(x as isize + r + 1, width)]) - i32::from(row[clamp(x as isize - r, width)]);
            }
            row.copy_from_slice(&line[..width]);
        }
        for x in 0..width {
            let at = |y: usize| y * stride + x;
            let mut sum: i32 = (-r..=r).map(|y| i32::from(data[at(clamp(y, height))])).sum();
            for y in 0..height {
                line[y] = (sum / span) as u8;
                sum += i32::from(data[at(clamp(y as isize + r + 1, height))]) - i32::from(data[at(clamp(y as isize - r, height))]);
            }
            for y in 0..height {
                data[at(y)] = line[y];
            }
        }
    }
}

/// Lay out the clock for a buffer of this size; `None` when disabled or empty.
pub fn render_clock(spec: &ClockSpec, width: i32, height: i32) -> Result<Option<ClockImage>, cairo::Error> {
    if !spec.enabled || width <= 0 || height <= 0 || (spec.time.is_empty() && spec.date.is_empty()) {
        return Ok(None);
    }
    let scratch = cairo::ImageSurface::create(cairo::Format::ARgb32, 1, 1)?;
    let measure_context = cairo::Context::new(&scratch)?;
    let shorter = f64::from(width.min(height));
    let padding = shorter * spec.margin / 100.0;
    let size = shorter * spec.size / 100.0;
    let mut block = measure(&measure_context, spec, size);
    // Keep long dates, custom fonts and large 12-hour clocks inside the display.
    let fit = 1f64
        .min((f64::from(width) - 2.0 * padding) / block.width.max(1.0))
        .min((f64::from(height) - 2.0 * padding) / block.height.max(1.0));
    if fit < 1.0 {
        block = measure(&measure_context, spec, size * fit.max(0.01));
    }
    let shadow_blur = if spec.shadow { block.size * 0.15 } else { 0.0 };
    let shadow_offset = if spec.shadow { block.size * 0.025 } else { 0.0 };
    let pad = (shadow_blur * 2.0 + shadow_offset).ceil() as i32 + 2;
    let image_width = block.width.ceil() as i32 + pad * 2;
    let image_height = block.height.ceil() as i32 + pad * 2;
    let position = spec.position.as_str();
    let align = if position.ends_with("left") {
        Align::Start
    } else if position.ends_with("right") {
        Align::End
    } else {
        Align::Center
    };
    let block_x = match align {
        Align::Start => padding,
        Align::End => f64::from(width) - padding - block.width,
        Align::Center => (f64::from(width) - block.width) / 2.0,
    };
    let block_y = if position.starts_with("top") {
        padding
    } else if position.starts_with("bottom") {
        f64::from(height) - padding - block.height
    } else {
        (f64::from(height) - block.height) / 2.0
    };

    let mut surface = cairo::ImageSurface::create(cairo::Format::ARgb32, image_width, image_height)?;
    {
        let cr = cairo::Context::new(&surface)?;
        cr.push_group();
        if spec.shadow {
            // text-shadow: 0 0.025em 0.15em rgb(0 0 0 / 55%)
            let mut mask = cairo::ImageSurface::create(cairo::Format::A8, image_width, image_height)?;
            {
                let mask_context = cairo::Context::new(&mask)?;
                draw_block(&mask_context, &block, f64::from(pad), f64::from(pad) + shadow_offset, align);
            }
            mask.flush();
            let stride = mask.stride() as usize;
            {
                let mut data = mask.data().map_err(|_| cairo::Error::SurfaceFinished)?;
                blur(&mut data, image_width as usize, image_height as usize, stride, ((shadow_blur / 2.0).round() as usize).max(1));
            }
            mask.mark_dirty();
            cr.set_source_rgba(0.0, 0.0, 0.0, 0.55);
            cr.mask_surface(&mask, 0.0, 0.0)?;
        }
        cr.set_source_rgb(spec.color[0], spec.color[1], spec.color[2]);
        draw_block(&cr, &block, f64::from(pad), f64::from(pad), align);
        cr.pop_group_to_source()?;
        cr.paint_with_alpha(spec.opacity.clamp(0.0, 1.0))?;
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().map_err(|_| cairo::Error::SurfaceFinished)?;
    // Cairo ARGB32 is native-endian premultiplied; GLES wants RGBA bytes.
    let mut pixels = Vec::with_capacity(image_width as usize * image_height as usize * 4);
    for y in 0..image_height as usize {
        for x in 0..image_width as usize {
            let at = y * stride + x * 4;
            let pixel = u32::from_ne_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]);
            pixels.extend_from_slice(&[(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8, (pixel >> 24) as u8]);
        }
    }
    Ok(Some(ClockImage {
        pixels,
        width: image_width,
        height: image_height,
        x: block_x.round() as i32 - pad,
        y: block_y.round() as i32 - pad,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(position: &str) -> ClockSpec {
        ClockSpec {
            enabled: true,
            position: position.into(),
            time: "12:34".into(),
            date: "Friday, 14 November".into(),
            ..ClockSpec::default()
        }
    }

    #[test]
    fn skips_disabled_or_empty_clocks() {
        assert_eq!(render_clock(&ClockSpec::default(), 100, 100).unwrap(), None);
        assert_eq!(render_clock(&ClockSpec { enabled: true, ..ClockSpec::default() }, 100, 100).unwrap(), None);
        assert_eq!(render_clock(&spec("center"), 0, 100).unwrap(), None);
    }

    #[test]
    fn positions_the_block_and_paints_premultiplied_text() {
        let center = render_clock(&spec("center"), 1920, 1080).unwrap().unwrap();
        assert_eq!(center.pixels.len(), (center.width * center.height * 4) as usize);
        let middle = center.x + center.width / 2;
        assert!((middle - 960).abs() <= 2, "centered horizontally: {middle}");
        assert!(center.pixels.as_chunks::<4>().0.iter().any(|p| p[3] > 200), "text is drawn");
        assert!(center.pixels.as_chunks::<4>().0.iter().all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]), "premultiplied");
        let corner = render_clock(&spec("top-left"), 1920, 1080).unwrap().unwrap();
        let padding = (1080.0 * 0.05) as i32;
        assert!(corner.x < padding && corner.y < padding && corner.x + corner.width > padding);
        let right = render_clock(&spec("bottom-right"), 1920, 1080).unwrap().unwrap();
        assert!(right.x + right.width > 1920 - padding && right.y + right.height > 1080 - padding);
    }

    #[test]
    fn shrinks_oversized_clocks_to_fit() {
        let big = ClockSpec { size: 80.0, ..spec("center") };
        let image = render_clock(&big, 400, 300).unwrap().unwrap();
        assert!(image.x >= -40 && image.x + image.width <= 440, "fits horizontally: {} + {}", image.x, image.width);
    }

    #[test]
    fn blur_preserves_flat_regions() {
        let mut data = vec![200u8; 16 * 4];
        blur(&mut data, 4, 4, 16, 2);
        assert!(data.chunks(16).all(|row| row[..4].iter().all(|v| *v == 200)));
        assert!(data.chunks(16).all(|row| row[4..].iter().all(|v| *v == 200)), "padding beyond width untouched");
    }
}
