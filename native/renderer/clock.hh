#pragma once
#include <string>
#include "gl.hh"
#include "json.hh"

/** Clock style and preformatted text from the main process (Intl formatting stays in TypeScript). */
struct ClockSpec {
  bool enabled = false;
  std::string position = "center";
  /** Pango family list, e.g. "Georgia, Liberation Serif, serif". */
  std::string family = "sans-serif";
  int weight = 300;
  double color[3] = {1, 1, 1};
  double opacity = 0.95;
  /** Percentages of the output's shorter side. */
  double size = 12, margin = 5;
  bool shadow = true;
  std::string time, period, date;
};

ClockSpec parseClock(const Json& message);
/** Lay out the clock for a buffer of this size; empty when disabled. */
ClockImage renderClock(const ClockSpec& spec, int width, int height);
