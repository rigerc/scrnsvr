// Clock overlay text, laid out like the Electron overlay's CSS (src/renderer/clock.css).
#include "clock.hh"
#include <algorithm>
#include <cmath>
#include <pango/pangocairo.h>

ClockSpec parseClock(const Json& message) {
  ClockSpec spec;
  spec.enabled = message["enabled"].flag();
  spec.position = message["position"].str("center");
  spec.family = message["family"].str("sans-serif");
  spec.weight = int(message["weight"].num(300));
  const Json& color = message["color"];
  for (size_t i = 0; i < 3 && i < color.items.size(); i++) spec.color[i] = color.items[i].num(1);
  spec.opacity = message["opacity"].num(0.95);
  spec.size = message["size"].num(12);
  spec.margin = message["margin"].num(5);
  spec.shadow = message["shadow"].flag(true);
  spec.time = message["time"].str();
  spec.period = message["period"].str();
  spec.date = message["date"].str();
  return spec;
}

namespace {

struct Text {
  PangoLayout* layout = nullptr;
  double width = 0, height = 0, baseline = 0;
};

/** One run of text at an absolute pixel size; letter spacing is in device units too. */
Text layoutText(cairo_t* cr, const ClockSpec& spec, const std::string& value, double pixels, double letterSpacingEm) {
  Text text;
  if (value.empty() || pixels <= 0) return text;
  text.layout = pango_cairo_create_layout(cr);
  PangoFontDescription* font = pango_font_description_from_string(spec.family.c_str());
  pango_font_description_set_absolute_size(font, pixels * PANGO_SCALE);
  pango_font_description_set_weight(font, PangoWeight(std::clamp(spec.weight, 100, 1000)));
  pango_layout_set_font_description(text.layout, font);
  pango_font_description_free(font);
  PangoAttrList* attributes = pango_attr_list_new();
  pango_attr_list_insert(attributes, pango_attr_letter_spacing_new(int(std::lround(letterSpacingEm * pixels * PANGO_SCALE))));
  pango_layout_set_attributes(text.layout, attributes);
  pango_attr_list_unref(attributes);
  pango_layout_set_text(text.layout, value.c_str(), -1);
  PangoRectangle logical;
  pango_layout_get_pixel_extents(text.layout, nullptr, &logical);
  text.width = logical.width;
  text.height = logical.height;
  text.baseline = double(pango_layout_get_baseline(text.layout)) / PANGO_SCALE;
  return text;
}

void release(Text& text) {
  if (text.layout) g_object_unref(text.layout);
  text.layout = nullptr;
}

struct Block {
  Text digits, period, date;
  double size = 0, width = 0, height = 0, timeHeight = 0, dateTop = 0, dateHeight = 0, periodGap = 0;
};

Block measure(cairo_t* cr, const ClockSpec& spec, double size) {
  Block block;
  block.size = size;
  block.digits = layoutText(cr, spec, spec.time, size, -0.035);
  block.period = layoutText(cr, spec, spec.period, size * 0.25, 0.04);
  block.date = layoutText(cr, spec, spec.date, size * 0.22, 0.06);
  // .clock-period margin-inline-start: .5em of its own 0.25em font.
  block.periodGap = block.period.layout ? size * 0.125 : 0;
  double timeWidth = block.digits.width + block.periodGap + block.period.width;
  block.timeHeight = size * 1.1;
  block.dateTop = block.timeHeight + (block.date.layout ? size * 0.22 * 0.65 : 0);
  block.dateHeight = block.date.layout ? size * 0.22 * 1.4 : 0;
  block.width = std::max(timeWidth, block.date.width);
  block.height = block.dateTop + block.dateHeight;
  return block;
}

void releaseBlock(Block& block) {
  release(block.digits);
  release(block.period);
  release(block.date);
}

/** Draw the block's text at origin, aligned within its width. */
void drawBlock(cairo_t* cr, const Block& block, double x, double y, int align) {
  auto offset = [&](double width) { return align == 0 ? 0.0 : align == 1 ? (block.width - width) / 2 : block.width - width; };
  double timeWidth = block.digits.width + block.periodGap + block.period.width;
  double lineX = x + offset(timeWidth);
  // Half-leading centers the glyph box in its 1.1em line.
  double baseline = y + (block.timeHeight - block.digits.height) / 2 + block.digits.baseline;
  for (PangoLayout* layout : {block.digits.layout, block.period.layout, block.date.layout}) if (layout) pango_cairo_update_layout(cr, layout);
  if (block.digits.layout) {
    cairo_move_to(cr, lineX, baseline - block.digits.baseline);
    pango_cairo_show_layout(cr, block.digits.layout);
  }
  if (block.period.layout) {
    cairo_move_to(cr, lineX + block.digits.width + block.periodGap, baseline - block.period.baseline);
    pango_cairo_show_layout(cr, block.period.layout);
  }
  if (block.date.layout) {
    double top = y + block.dateTop + (block.dateHeight - block.date.height) / 2;
    cairo_move_to(cr, x + offset(block.date.width), top);
    pango_cairo_show_layout(cr, block.date.layout);
  }
}

/** Three box-blur passes approximate a Gaussian on an 8-bit alpha mask. */
void blur(cairo_surface_t* surface, int radius) {
  if (radius < 1) return;
  cairo_surface_flush(surface);
  int width = cairo_image_surface_get_width(surface), height = cairo_image_surface_get_height(surface);
  int stride = cairo_image_surface_get_stride(surface);
  unsigned char* data = cairo_image_surface_get_data(surface);
  std::vector<unsigned char> line(size_t(std::max(width, height)));
  for (int iteration = 0; iteration < 3; iteration++) {
    for (int y = 0; y < height; y++) {
      unsigned char* row = data + y * stride;
      int sum = 0;
      for (int x = -radius; x <= radius; x++) sum += row[std::clamp(x, 0, width - 1)];
      for (int x = 0; x < width; x++) {
        line[size_t(x)] = static_cast<unsigned char>(sum / (2 * radius + 1));
        sum += row[std::min(x + radius + 1, width - 1)] - row[std::max(x - radius, 0)];
      }
      std::copy(line.begin(), line.begin() + width, row);
    }
    for (int x = 0; x < width; x++) {
      int sum = 0;
      for (int y = -radius; y <= radius; y++) sum += data[std::clamp(y, 0, height - 1) * stride + x];
      for (int y = 0; y < height; y++) {
        line[size_t(y)] = static_cast<unsigned char>(sum / (2 * radius + 1));
        sum += data[std::min(y + radius + 1, height - 1) * stride + x] - data[std::max(y - radius, 0) * stride + x];
      }
      for (int y = 0; y < height; y++) data[y * stride + x] = line[size_t(y)];
    }
  }
  cairo_surface_mark_dirty(surface);
}

}  // namespace

ClockImage renderClock(const ClockSpec& spec, int width, int height) {
  ClockImage image;
  if (!spec.enabled || width <= 0 || height <= 0 || (spec.time.empty() && spec.date.empty())) return image;
  cairo_surface_t* scratch = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 1, 1);
  cairo_t* measureContext = cairo_create(scratch);
  double shorter = std::min(width, height);
  double padding = shorter * spec.margin / 100;
  double size = shorter * spec.size / 100;
  Block block = measure(measureContext, spec, size);
  // Keep long dates, custom fonts and large 12-hour clocks inside the display.
  double fit = std::min({1.0, (width - 2 * padding) / std::max(1.0, block.width), (height - 2 * padding) / std::max(1.0, block.height)});
  if (fit < 1) {
    releaseBlock(block);
    block = measure(measureContext, spec, size * std::max(fit, 0.01));
  }
  double shadowBlur = spec.shadow ? block.size * 0.15 : 0;
  double shadowOffset = spec.shadow ? block.size * 0.025 : 0;
  int pad = int(std::ceil(shadowBlur * 2 + shadowOffset)) + 2;
  int imageWidth = int(std::ceil(block.width)) + pad * 2;
  int imageHeight = int(std::ceil(block.height)) + pad * 2;
  const std::string& position = spec.position;
  int align = position.size() >= 4 && position.compare(position.size() - 4, 4, "left") == 0 ? 0
      : position.size() >= 5 && position.compare(position.size() - 5, 5, "right") == 0 ? 2 : 1;
  int vertical = position.rfind("top", 0) == 0 ? 0 : position.rfind("bottom", 0) == 0 ? 2 : 1;
  double blockX = align == 0 ? padding : align == 2 ? width - padding - block.width : (width - block.width) / 2;
  double blockY = vertical == 0 ? padding : vertical == 2 ? height - padding - block.height : (height - block.height) / 2;

  cairo_surface_t* surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, imageWidth, imageHeight);
  cairo_t* cr = cairo_create(surface);
  cairo_push_group(cr);
  if (spec.shadow) {
    // text-shadow: 0 0.025em 0.15em rgb(0 0 0 / 55%)
    cairo_surface_t* mask = cairo_image_surface_create(CAIRO_FORMAT_A8, imageWidth, imageHeight);
    cairo_t* maskContext = cairo_create(mask);
    drawBlock(maskContext, block, pad, pad + shadowOffset, align);
    cairo_destroy(maskContext);
    blur(mask, std::max(1, int(std::lround(shadowBlur / 2))));
    cairo_set_source_rgba(cr, 0, 0, 0, 0.55);
    cairo_mask_surface(cr, mask, 0, 0);
    cairo_surface_destroy(mask);
  }
  cairo_set_source_rgb(cr, spec.color[0], spec.color[1], spec.color[2]);
  drawBlock(cr, block, pad, pad, align);
  cairo_pop_group_to_source(cr);
  cairo_paint_with_alpha(cr, std::clamp(spec.opacity, 0.0, 1.0));
  cairo_destroy(cr);
  cairo_surface_flush(surface);

  // Cairo ARGB32 is native-endian premultiplied; GLES wants RGBA bytes.
  image.width = imageWidth;
  image.height = imageHeight;
  image.x = int(std::lround(blockX)) - pad;
  image.y = int(std::lround(blockY)) - pad;
  image.pixels.resize(size_t(imageWidth) * size_t(imageHeight) * 4);
  const unsigned char* data = cairo_image_surface_get_data(surface);
  int stride = cairo_image_surface_get_stride(surface);
  for (int y = 0; y < imageHeight; y++) {
    const uint32_t* row = reinterpret_cast<const uint32_t*>(data + y * stride);
    unsigned char* out = image.pixels.data() + size_t(y) * size_t(imageWidth) * 4;
    for (int x = 0; x < imageWidth; x++) {
      uint32_t pixel = row[x];
      out[x * 4 + 0] = (pixel >> 16) & 255;
      out[x * 4 + 1] = (pixel >> 8) & 255;
      out[x * 4 + 2] = pixel & 255;
      out[x * 4 + 3] = (pixel >> 24) & 255;
    }
  }
  cairo_surface_destroy(surface);
  releaseBlock(block);
  cairo_destroy(measureContext);
  cairo_surface_destroy(scratch);
  return image;
}
