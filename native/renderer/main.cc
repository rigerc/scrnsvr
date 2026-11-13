// scrnsvr-renderer: draws the screensaver directly into wlr-layer-shell surfaces.
//
// The Electron main process resolves everything a scene needs (presets, color
// schemes, uniform values, custom-shader wrapping, effect passes, clock text)
// and streams it here as JSON lines on stdin. This program owns presentation:
// EGL surfaces, frame pacing from compositor frame callbacks, fades, and input.
//
// stdin:  {"type":"scene",...} {"type":"clock",...} {"type":"audio","value":[l,b,m,t]} {"type":"dismiss"}
// stdout: {"type":"ready"} once every output has presented a frame.
// exit:   0 closed, 1 runtime failure, 2 layer-shell/EGL unavailable, 3 initial scene failed.
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <wayland-client.h>
#include <wayland-egl.h>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <map>
#include <memory>
#include <poll.h>
#include <string>
#include <unistd.h>
#include "clock.hh"
#include "gl.hh"
#include "json.hh"
// The generated C header names a parameter `namespace`.
#define namespace namespace_
#include "wlr-layer-shell-unstable-v1-client-protocol.h"
#undef namespace

namespace {

enum ExitCode { Closed = 0, Failed = 1, Unavailable = 2, SceneFailed = 3 };

double nowMs() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return double(ts.tv_sec) * 1e3 + double(ts.tv_nsec) / 1e6;
}
double clamp01(double value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

struct Fatal {
  ExitCode code;
  std::string message;
};

volatile sig_atomic_t terminated = 0;
/** SCRNSVR_RENDERER_DEBUG=1 prints per-second frame statistics to stderr. */
bool debugStats = false;
struct Stats { long frames = 0, callbacks = 0; double since = 0; } stats;

struct Options {
  double fps = 60;
  double fadeMs = 1000;
  bool allOutputs = false;
  std::string outputName;
  bool hasPosition = false;
  int outputX = 0, outputY = 0;
  bool compileCheck = false;
};

struct App;

struct Output {
  App* app = nullptr;
  uint32_t id = 0;
  wl_output* proxy = nullptr;
  std::string name, description;
  int x = 0, y = 0, scale = 1;
  bool selected = false;
  wl_surface* surface = nullptr;
  zwlr_layer_surface_v1* layer = nullptr;
  wl_egl_window* window = nullptr;
  EGLSurface eglSurface = EGL_NO_SURFACE;
  EGLContext context = EGL_NO_CONTEXT;
  int width = 0, height = 0;
  bool frameReady = false;
  wl_callback* callback = nullptr;
  double firstFrame = -1, lastFrame = -1;
  double exitFrom = 0;
  double lastAlpha = 0;
  bool opaque = false;
  bool clockDirty = true;
  uint64_t sceneVersion = 0;
  std::unique_ptr<Renderer> renderer;
};

struct App {
  Options options;
  wl_display* display = nullptr;
  wl_registry* registry = nullptr;
  wl_compositor* compositor = nullptr;
  zwlr_layer_shell_v1* shell = nullptr;
  wl_seat* seat = nullptr;
  wl_pointer* pointer = nullptr;
  wl_keyboard* keyboard = nullptr;
  wl_touch* touch = nullptr;
  std::map<uint32_t, std::unique_ptr<Output>> outputs;
  bool initializing = true;
  EGLDisplay egl = EGL_NO_DISPLAY;
  EGLConfig config = nullptr;
  bool surfacesOpen = false;
  std::shared_ptr<const SceneSpec> scene;
  uint64_t sceneVersion = 0;
  std::shared_ptr<const SceneSpec> pending;
  enum Phase { Idle, Out, In } phase = Idle;
  double phaseStart = 0, overlayFrom = 0;
  ClockSpec clock;
  float audio[4] = {0, 0, 0, 0};
  bool exiting = false;
  double exitStart = 0;
  bool readySent = false;
  bool done = false;
  bool pointerOrigin = false;
  double pointerX = 0, pointerY = 0;
  std::string input;
  bool stdinOpen = true;
  /** Set inside C callbacks, where exceptions must not unwind; rethrown after dispatch. */
  std::unique_ptr<Fatal> fatal;

  double interval() const { return 1000.0 / (options.fps > 0 ? options.fps : 60); }
  double half() const { return std::max(options.fadeMs / 2, 1000.0 / 60); }

  void dismiss() {
    if (exiting) return;
    exiting = true;
    exitStart = nowMs();
    pending.reset();
    for (auto& [id, output] : outputs) output->exitFrom = entryAlpha(*output, exitStart);
    if (options.fadeMs <= 0) done = true;
  }
  double entryAlpha(const Output& output, double now) const {
    if (output.firstFrame < 0) return 0;
    return options.fadeMs <= 0 ? 1 : clamp01((now - output.firstFrame) / options.fadeMs);
  }
  double alpha(const Output& output, double now) const {
    if (!exiting) return entryAlpha(output, now);
    if (options.fadeMs <= 0) return 0;
    return output.exitFrom * (1 - clamp01((now - exitStart) / options.fadeMs));
  }
  double overlay(double now) const {
    if (phase == Out) return overlayFrom + (1 - overlayFrom) * clamp01((now - phaseStart) / half());
    if (phase == In) return 1 - clamp01((now - phaseStart) / half());
    return 0;
  }
  void advanceTransition(double now) {
    if (phase == Out && overlay(now) >= 1) {
      // Swap behind black; outputs compile the new scene on their next frame.
      if (pending) { scene = pending; sceneVersion++; pending.reset(); }
      phase = In;
      phaseStart = now;
    } else if (phase == In && now - phaseStart >= half()) phase = Idle;
  }
  void setScene(std::shared_ptr<const SceneSpec> next) {
    if (exiting) return;
    if (!scene || options.fadeMs <= 0) { scene = std::move(next); sceneVersion++; return; }
    double now = nowMs();
    // Coalesce picks during a fade-out; only the latest is mounted at black.
    if (phase != Out) { overlayFrom = overlay(now); phase = Out; phaseStart = now; }
    pending = std::move(next);
  }
};

void emit(const std::string& line) {
  fputs(line.c_str(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

// --- Wayland listeners ---------------------------------------------------

const wl_callback_listener frameListener = {
  [](void* data, wl_callback* callback, uint32_t) {
    auto output = static_cast<Output*>(data);
    wl_callback_destroy(callback);
    output->callback = nullptr;
    output->frameReady = true;
    stats.callbacks++;
  },
};

void createSurfaceResources(Output& output);

const zwlr_layer_surface_v1_listener layerListener = {
  [](void* data, zwlr_layer_surface_v1* layer, uint32_t serial, uint32_t width, uint32_t height) {
    auto output = static_cast<Output*>(data);
    zwlr_layer_surface_v1_ack_configure(layer, serial);
    if (output->app->fatal) return;
    if (width == 0 || height == 0) { output->app->fatal = std::make_unique<Fatal>(Fatal{Failed, "Invalid layer-shell output size"}); return; }
    bool resized = int(width) != output->width || int(height) != output->height;
    output->width = int(width);
    output->height = int(height);
    if (!output->window) {
      try { createSurfaceResources(*output); }
      catch (const Fatal& fatal) { output->app->fatal = std::make_unique<Fatal>(fatal); return; }
      output->frameReady = true;
    } else if (resized) {
      wl_egl_window_resize(output->window, output->width * output->scale, output->height * output->scale, 0, 0);
      output->clockDirty = true;
    }
  },
  [](void* data, zwlr_layer_surface_v1*) { static_cast<Output*>(data)->app->done = true; },
};

const wl_output_listener outputListener = {
  [](void* data, wl_output*, int32_t x, int32_t y, int32_t, int32_t, int32_t, const char*, const char*, int32_t) {
    auto output = static_cast<Output*>(data);
    output->x = x;
    output->y = y;
  },
  [](void*, wl_output*, uint32_t, int32_t, int32_t, int32_t) {},
  [](void* data, wl_output*) {
    // A changed output after startup closes the screensaver; the daemon reselects next launch.
    auto output = static_cast<Output*>(data);
    if (!output->app->initializing && output->app->surfacesOpen && output->selected && output->window) output->app->done = true;
  },
  [](void* data, wl_output*, int32_t scale) { static_cast<Output*>(data)->scale = scale < 1 ? 1 : scale; },
  [](void* data, wl_output*, const char* name) { static_cast<Output*>(data)->name = name; },
  [](void* data, wl_output*, const char* description) { static_cast<Output*>(data)->description = description; },
};

const wl_pointer_listener pointerListener = [] {
  wl_pointer_listener l{};
  l.enter = [](void* data, wl_pointer* pointer, uint32_t serial, wl_surface*, wl_fixed_t x, wl_fixed_t y) {
    auto app = static_cast<App*>(data);
    wl_pointer_set_cursor(pointer, serial, nullptr, 0, 0);
    app->pointerOrigin = true;
    app->pointerX = wl_fixed_to_double(x);
    app->pointerY = wl_fixed_to_double(y);
  };
  l.leave = [](void* data, wl_pointer*, uint32_t, wl_surface*) { static_cast<App*>(data)->pointerOrigin = false; };
  l.motion = [](void* data, wl_pointer*, uint32_t, wl_fixed_t x, wl_fixed_t y) {
    auto app = static_cast<App*>(data);
    double px = wl_fixed_to_double(x), py = wl_fixed_to_double(y);
    double dx = px - app->pointerX, dy = py - app->pointerY;
    // Pointer movement must travel 12 logical pixels before it dismisses.
    if (app->pointerOrigin && dx * dx + dy * dy > 144) app->dismiss();
    if (!app->pointerOrigin) { app->pointerOrigin = true; app->pointerX = px; app->pointerY = py; }
  };
  l.button = [](void* data, wl_pointer*, uint32_t, uint32_t, uint32_t, uint32_t state) {
    if (state == WL_POINTER_BUTTON_STATE_PRESSED) static_cast<App*>(data)->dismiss();
  };
  l.axis = [](void* data, wl_pointer*, uint32_t, uint32_t, wl_fixed_t) { static_cast<App*>(data)->dismiss(); };
  l.frame = [](void*, wl_pointer*) {};
  l.axis_source = [](void*, wl_pointer*, uint32_t) {};
  l.axis_stop = [](void*, wl_pointer*, uint32_t, uint32_t) {};
  l.axis_discrete = [](void*, wl_pointer*, uint32_t, int32_t) {};
  return l;
}();

const wl_keyboard_listener keyboardListener = {
  [](void*, wl_keyboard*, uint32_t, int32_t fd, uint32_t) { close(fd); },
  [](void*, wl_keyboard*, uint32_t, wl_surface*, wl_array*) {},
  [](void*, wl_keyboard*, uint32_t, wl_surface*) {},
  [](void* data, wl_keyboard*, uint32_t, uint32_t, uint32_t, uint32_t state) {
    if (state == WL_KEYBOARD_KEY_STATE_PRESSED) static_cast<App*>(data)->dismiss();
  },
  [](void*, wl_keyboard*, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t) {},
  [](void*, wl_keyboard*, int32_t, int32_t) {},
};

const wl_touch_listener touchListener = [] {
  wl_touch_listener l{};
  l.down = [](void* data, wl_touch*, uint32_t, uint32_t, wl_surface*, int32_t, wl_fixed_t, wl_fixed_t) { static_cast<App*>(data)->dismiss(); };
  l.up = [](void*, wl_touch*, uint32_t, uint32_t, int32_t) {};
  l.motion = [](void*, wl_touch*, uint32_t, int32_t, wl_fixed_t, wl_fixed_t) {};
  l.frame = [](void*, wl_touch*) {};
  l.cancel = [](void*, wl_touch*) {};
  return l;
}();

const wl_seat_listener seatListener = {
  [](void* data, wl_seat* seat, uint32_t capabilities) {
    auto app = static_cast<App*>(data);
    bool pointer = capabilities & WL_SEAT_CAPABILITY_POINTER, keyboard = capabilities & WL_SEAT_CAPABILITY_KEYBOARD, touch = capabilities & WL_SEAT_CAPABILITY_TOUCH;
    if (pointer && !app->pointer) { app->pointer = wl_seat_get_pointer(seat); wl_pointer_add_listener(app->pointer, &pointerListener, app); }
    if (!pointer && app->pointer) { wl_pointer_destroy(app->pointer); app->pointer = nullptr; }
    if (keyboard && !app->keyboard) { app->keyboard = wl_seat_get_keyboard(seat); wl_keyboard_add_listener(app->keyboard, &keyboardListener, app); }
    if (!keyboard && app->keyboard) { wl_keyboard_destroy(app->keyboard); app->keyboard = nullptr; }
    if (touch && !app->touch) { app->touch = wl_seat_get_touch(seat); wl_touch_add_listener(app->touch, &touchListener, app); }
    if (!touch && app->touch) { wl_touch_destroy(app->touch); app->touch = nullptr; }
  },
  [](void*, wl_seat*, const char*) {},
};

const wl_registry_listener registryListener = {
  [](void* data, wl_registry* registry, uint32_t id, const char* interface, uint32_t version) {
    auto app = static_cast<App*>(data);
    if (!strcmp(interface, wl_compositor_interface.name)) app->compositor = static_cast<wl_compositor*>(wl_registry_bind(registry, id, &wl_compositor_interface, std::min(version, 4u)));
    else if (!strcmp(interface, zwlr_layer_shell_v1_interface.name)) app->shell = static_cast<zwlr_layer_shell_v1*>(wl_registry_bind(registry, id, &zwlr_layer_shell_v1_interface, 1));
    else if (!strcmp(interface, wl_seat_interface.name) && !app->seat) {
      app->seat = static_cast<wl_seat*>(wl_registry_bind(registry, id, &wl_seat_interface, std::min(version, 5u)));
      wl_seat_add_listener(app->seat, &seatListener, app);
    } else if (!strcmp(interface, wl_output_interface.name)) {
      auto output = std::make_unique<Output>();
      output->app = app;
      output->id = id;
      output->proxy = static_cast<wl_output*>(wl_registry_bind(registry, id, &wl_output_interface, std::min(version, 4u)));
      wl_output_add_listener(output->proxy, &outputListener, output.get());
      app->outputs[id] = std::move(output);
      if (!app->initializing && app->surfacesOpen) app->done = true;
    }
  },
  [](void* data, wl_registry*, uint32_t id) {
    auto app = static_cast<App*>(data);
    if (app->outputs.count(id) && app->outputs[id]->selected) app->done = true;
  },
};

// --- EGL -----------------------------------------------------------------

void initEgl(App& app) {
  app.egl = eglGetDisplay(reinterpret_cast<EGLNativeDisplayType>(app.display));
  if (app.egl == EGL_NO_DISPLAY || !eglInitialize(app.egl, nullptr, nullptr)) throw Fatal{Unavailable, "EGL is unavailable on this Wayland display"};
  if (!eglBindAPI(EGL_OPENGL_ES_API)) throw Fatal{Unavailable, "OpenGL ES is unavailable"};
  const EGLint attributes[] = {
    EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
    EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE,
  };
  EGLint count = 0;
  if (!eglChooseConfig(app.egl, attributes, &app.config, 1, &count) || count < 1) throw Fatal{Unavailable, "No RGBA8 EGL config for OpenGL ES 2"};
}

EGLContext createContext(App& app) {
  const EGLint attributes[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
  EGLContext context = eglCreateContext(app.egl, app.config, EGL_NO_CONTEXT, attributes);
  if (context == EGL_NO_CONTEXT) throw Fatal{Unavailable, "Could not create an OpenGL ES 2 context"};
  return context;
}

void createSurfaceResources(Output& output) {
  App& app = *output.app;
  output.window = wl_egl_window_create(output.surface, output.width * output.scale, output.height * output.scale);
  if (!output.window) throw Fatal{Unavailable, "Could not create a Wayland EGL window"};
  output.eglSurface = eglCreateWindowSurface(app.egl, app.config, reinterpret_cast<EGLNativeWindowType>(output.window), nullptr);
  if (output.eglSurface == EGL_NO_SURFACE) throw Fatal{Unavailable, "Could not create an EGL window surface"};
  output.context = createContext(app);
  if (!eglMakeCurrent(app.egl, output.eglSurface, output.eglSurface, output.context)) throw Fatal{Unavailable, "Could not activate the EGL context"};
  // Frame callbacks pace rendering; swaps must never block the event loop.
  eglSwapInterval(app.egl, 0);
  output.renderer = std::make_unique<Renderer>();
  try { output.renderer->init(); }
  catch (const std::exception& error) { throw Fatal{Unavailable, error.what()}; }
}

void openSurfaces(App& app) {
  for (auto& [id, output] : app.outputs) {
    if (!output->selected) continue;
    output->surface = wl_compositor_create_surface(app.compositor);
    wl_surface_set_buffer_scale(output->surface, output->scale);
    output->layer = zwlr_layer_shell_v1_get_layer_surface(app.shell, output->surface, output->proxy, ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY, "scrnsvr");
    zwlr_layer_surface_v1_add_listener(output->layer, &layerListener, output.get());
    zwlr_layer_surface_v1_set_anchor(output->layer, 15);
    zwlr_layer_surface_v1_set_size(output->layer, 0, 0);
    zwlr_layer_surface_v1_set_exclusive_zone(output->layer, -1);
    zwlr_layer_surface_v1_set_keyboard_interactivity(output->layer, 1);
    wl_surface_commit(output->surface);
  }
  app.surfacesOpen = true;
}

void selectOutputs(App& app) {
  if (app.outputs.empty()) throw Fatal{Unavailable, "No Wayland outputs are available"};
  if (app.options.allOutputs) { for (auto& [id, output] : app.outputs) output->selected = true; return; }
  Output* match = nullptr;
  // Electron's label may be the connector name or the monitor description.
  if (!app.options.outputName.empty())
    for (auto& [id, output] : app.outputs) if (output->name == app.options.outputName || output->description == app.options.outputName) { match = output.get(); break; }
  if (!match && app.options.hasPosition)
    for (auto& [id, output] : app.outputs) if (output->x == app.options.outputX && output->y == app.options.outputY) { match = output.get(); break; }
  if (!match) {
    fprintf(stderr, "scrnsvr could not identify the primary output; using %s\n", app.outputs.begin()->second->name.c_str());
    match = app.outputs.begin()->second.get();
  }
  match->selected = true;
}

// --- Frames ----------------------------------------------------------------

void renderOutput(App& app, Output& output, double now) {
  if (!eglMakeCurrent(app.egl, output.eglSurface, output.eglSurface, output.context)) throw Fatal{Failed, "Could not activate the EGL context"};
  if (output.sceneVersion != app.sceneVersion && app.scene) {
    bool initial = !output.renderer->hasScene();
    output.sceneVersion = app.sceneVersion;
    try { output.renderer->setScene(app.scene); }
    catch (const std::exception& error) {
      if (initial) throw Fatal{SceneFailed, std::string("Scene ") + app.scene->key + " failed: " + error.what()};
      fprintf(stderr, "scrnsvr could not switch to %s; keeping the current scene: %s\n", app.scene->key.c_str(), error.what());
    }
  }
  int width = output.width * output.scale, height = output.height * output.scale;
  if (output.clockDirty) {
    ClockImage image = renderClock(app.clock, width, height);
    output.renderer->setClock(&image);
    output.clockDirty = false;
  }
  if (output.firstFrame < 0) output.firstFrame = now;
  double delta = output.lastFrame < 0 ? 0 : now - output.lastFrame;
  double alpha = app.alpha(output, now);
  output.renderer->render(width, height, delta, app.audio, float(app.overlay(now)), float(alpha));
  // An opaque region lets the compositor skip what is underneath once the fade completes.
  if (alpha >= 1 && !output.opaque) {
    wl_region* region = wl_compositor_create_region(app.compositor);
    wl_region_add(region, 0, 0, output.width, output.height);
    wl_surface_set_opaque_region(output.surface, region);
    wl_region_destroy(region);
    output.opaque = true;
  } else if (alpha < 1 && output.opaque) {
    wl_surface_set_opaque_region(output.surface, nullptr);
    output.opaque = false;
  }
  output.callback = wl_surface_frame(output.surface);
  wl_callback_add_listener(output.callback, &frameListener, &output);
  output.frameReady = false;
  if (!eglSwapBuffers(app.egl, output.eglSurface)) throw Fatal{Failed, "eglSwapBuffers failed"};
  output.lastFrame = now;
  output.lastAlpha = alpha;
  stats.frames++;
}

/** Render due outputs; returns the poll timeout in milliseconds (-1 waits for events). */
int frame(App& app) {
  double now = nowMs();
  if (debugStats && now - stats.since >= 1000) {
    if (stats.since > 0) fprintf(stderr, "scrnsvr-renderer: %ld frames, %ld callbacks, overlay %.2f\n", stats.frames, stats.callbacks, app.overlay(now));
    stats = Stats{0, 0, now};
  }
  app.advanceTransition(now);
  double next = -1;
  auto wake = [&](double at) { if (next < 0 || at < next) next = at; };
  if (app.scene && app.surfacesOpen) {
    double interval = app.interval(), tolerance = std::min(2.0, interval * 0.1);
    for (auto& [id, output] : app.outputs) {
      if (!output->selected || !output->window || !output->frameReady) continue;
      double due = output->lastFrame < 0 ? now : output->lastFrame + interval;
      if (now + tolerance >= due) renderOutput(app, *output, now);
      else wake(due);
    }
  }
  if (app.exiting) {
    // Finished: every output presented a transparent frame or stopped presenting altogether.
    bool finished = true;
    for (auto& [id, output] : app.outputs) {
      if (!output->selected || !output->window) continue;
      bool stalled = !output->frameReady && output->lastFrame >= 0 && now - output->lastFrame > 1000;
      if (output->lastFrame >= 0 && output->lastAlpha > 0 && !stalled) finished = false;
    }
    if (finished || now - app.exitStart > app.options.fadeMs + 1500) app.done = true;
    wake(app.exitStart + app.options.fadeMs + 1500);
    wake(now + 250);
  }
  if (!app.readySent && app.surfacesOpen) {
    bool ready = true;
    for (auto& [id, output] : app.outputs) if (output->selected && output->lastFrame < 0) ready = false;
    if (ready) { app.readySent = true; emit("{\"type\":\"ready\"}"); }
  }
  if (next < 0) return -1;
  return int(std::max(0.0, next - nowMs()) + 0.999);
}

// --- Protocol --------------------------------------------------------------

void handleMessage(App& app, const std::string& line) {
  Json message;
  try { message = parseJson(line); }
  catch (const std::exception& error) { fprintf(stderr, "scrnsvr ignored a malformed message: %s\n", error.what()); return; }
  std::string type = message["type"].str();
  if (type == "scene") {
    std::shared_ptr<const SceneSpec> spec;
    try { spec = std::make_shared<SceneSpec>(parseScene(message)); }
    catch (const std::exception& error) { fprintf(stderr, "scrnsvr ignored a scene: %s\n", error.what()); return; }
    app.setScene(std::move(spec));
    if (!app.surfacesOpen && !app.exiting) openSurfaces(app);
  } else if (type == "clock") {
    app.clock = parseClock(message);
    for (auto& [id, output] : app.outputs) output->clockDirty = true;
  } else if (type == "audio") {
    const Json& value = message["value"];
    for (size_t i = 0; i < 4 && i < value.items.size(); i++) app.audio[i] = float(value.items[i].num());
  } else if (type == "dismiss") {
    app.dismiss();
  }
}

void readInput(App& app) {
  char buffer[65536];
  for (;;) {
    ssize_t count = read(STDIN_FILENO, buffer, sizeof buffer);
    if (count > 0) { app.input.append(buffer, size_t(count)); continue; }
    if (count == 0) { app.stdinOpen = false; break; }
    if (errno == EINTR) continue;
    if (errno != EAGAIN && errno != EWOULDBLOCK) app.stdinOpen = false;
    break;
  }
  size_t start = 0;
  for (size_t end; (end = app.input.find('\n', start)) != std::string::npos; start = end + 1)
    if (end > start) handleMessage(app, app.input.substr(start, end - start));
  app.input.erase(0, start);
  // Without its controller the screensaver has no way to be supervised; leave gracefully.
  if (!app.stdinOpen) app.dismiss();
}

// --- Compile check ---------------------------------------------------------

/** Compile each {"id","source"} line with a headless context and report the result. */
int compileCheck(App& app) {
  app.egl = eglGetDisplay(reinterpret_cast<EGLNativeDisplayType>(app.display));
  if (app.egl == EGL_NO_DISPLAY || !eglInitialize(app.egl, nullptr, nullptr) || !eglBindAPI(EGL_OPENGL_ES_API)) throw Fatal{Unavailable, "EGL is unavailable"};
  const EGLint attributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
  EGLint count = 0;
  if (!eglChooseConfig(app.egl, attributes, &app.config, 1, &count) || count < 1) throw Fatal{Unavailable, "No pbuffer EGL config"};
  EGLContext context = createContext(app);
  const EGLint size[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
  EGLSurface surface = eglCreatePbufferSurface(app.egl, app.config, size);
  if (!eglMakeCurrent(app.egl, surface, surface, context)) throw Fatal{Unavailable, "Could not activate a headless context"};
  std::string line;
  int failures = 0;
  for (int c; (c = getchar()) != EOF;) {
    if (c != '\n') { line += char(c); continue; }
    if (line.empty()) continue;
    Json item = parseJson(line);
    line.clear();
    std::string error = compileError(item["source"].str());
    if (!error.empty()) failures++;
    emit("{\"id\":" + jsonQuote(item["id"].str()) + ",\"ok\":" + (error.empty() ? "true" : "false") + (error.empty() ? "" : ",\"error\":" + jsonQuote(error)) + "}");
  }
  return failures ? Failed : Closed;
}

/** "x,y" with optional signs. Avoids sscanf, which glibc 2.38 redirects to a newer symbol. */
bool parsePosition(const std::string& text, int& x, int& y) {
  size_t i = 0;
  auto integer = [&](int& out) {
    bool negative = i < text.size() && text[i] == '-';
    if (i < text.size() && (text[i] == '-' || text[i] == '+')) i++;
    size_t start = i;
    long value = 0;
    while (i < text.size() && text[i] >= '0' && text[i] <= '9' && value < 1000000) value = value * 10 + (text[i++] - '0');
    out = int(negative ? -value : value);
    return i > start;
  };
  if (!integer(x) || i >= text.size() || text[i++] != ',' || !integer(y)) return false;
  return i == text.size();
}

Options parseOptions(int argc, char** argv) {
  Options options;
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    auto value = [&]() -> std::string {
      if (i + 1 >= argc) throw Fatal{Failed, arg + " requires a value"};
      return argv[++i];
    };
    if (arg == "--fps") options.fps = std::max(1.0, std::atof(value().c_str()));
    else if (arg == "--fade") options.fadeMs = std::max(0.0, std::atof(value().c_str()) * 1000);
    else if (arg == "--all-outputs") options.allOutputs = true;
    else if (arg == "--output") options.outputName = value();
    else if (arg == "--output-at") {
      std::string position = value();
      options.hasPosition = parsePosition(position, options.outputX, options.outputY);
    } else if (arg == "--compile-check") options.compileCheck = true;
    else throw Fatal{Failed, "Unknown option " + arg};
  }
  return options;
}

void dispatchPending(App& app) {
  if (wl_display_dispatch_pending(app.display) < 0) throw Fatal{Failed, "Wayland compositor disconnected or rejected the surface"};
  if (app.fatal) throw *app.fatal;
}

int run(App& app) {
  app.display = wl_display_connect(nullptr);
  if (!app.display) throw Fatal{Unavailable, "Cannot connect to Wayland"};
  app.registry = wl_display_get_registry(app.display);
  wl_registry_add_listener(app.registry, &registryListener, &app);
  wl_display_roundtrip(app.display);
  wl_display_roundtrip(app.display);
  app.initializing = false;
  if (app.options.compileCheck) return compileCheck(app);
  if (!app.compositor || !app.shell) throw Fatal{Unavailable, "Compositor does not provide wlr-layer-shell"};
  selectOutputs(app);
  initEgl(app);
  fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);
  int fd = wl_display_get_fd(app.display);
  while (!app.done && !terminated) {
    dispatchPending(app);
    int timeout = frame(app);
    if (app.done) break;
    // EGL may have read events (such as our frame callbacks) into the queue while
    // swapping. Dispatching them can make a frame due, so schedule again first.
    if (wl_display_prepare_read(app.display) != 0) { dispatchPending(app); continue; }
    if (wl_display_flush(app.display) < 0 && errno != EAGAIN) { wl_display_cancel_read(app.display); throw Fatal{Failed, "Could not flush the Wayland connection"}; }
    pollfd fds[2] = {{fd, POLLIN, 0}, {STDIN_FILENO, short(app.stdinOpen ? POLLIN : 0), 0}};
    int ready = poll(fds, app.stdinOpen ? 2 : 1, timeout);
    if (ready < 0) {
      wl_display_cancel_read(app.display);
      if (errno == EINTR) continue;
      throw Fatal{Failed, "poll failed"};
    }
    if (fds[0].revents & POLLIN) { if (wl_display_read_events(app.display) < 0) throw Fatal{Failed, "Wayland compositor disconnected"}; dispatchPending(app); }
    else wl_display_cancel_read(app.display);
    if (fds[0].revents & (POLLERR | POLLHUP)) throw Fatal{Failed, "Wayland compositor disconnected"};
    if (app.stdinOpen && (fds[1].revents & (POLLIN | POLLHUP | POLLERR))) readInput(app);
  }
  return Closed;
}

void cleanup(App& app) {
  for (auto& [id, output] : app.outputs) {
    if (output->context != EGL_NO_CONTEXT) {
      eglMakeCurrent(app.egl, output->eglSurface, output->eglSurface, output->context);
      output->renderer.reset();
      eglMakeCurrent(app.egl, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
      eglDestroyContext(app.egl, output->context);
    }
    if (output->eglSurface != EGL_NO_SURFACE) eglDestroySurface(app.egl, output->eglSurface);
    if (output->window) wl_egl_window_destroy(output->window);
    if (output->callback) wl_callback_destroy(output->callback);
    if (output->layer) zwlr_layer_surface_v1_destroy(output->layer);
    if (output->surface) wl_surface_destroy(output->surface);
  }
  if (app.egl != EGL_NO_DISPLAY) eglTerminate(app.egl);
  if (app.display) { wl_display_flush(app.display); wl_display_disconnect(app.display); }
}

}  // namespace

int main(int argc, char** argv) {
  struct sigaction action {};
  action.sa_handler = [](int) { terminated = 1; };
  sigaction(SIGTERM, &action, nullptr);
  sigaction(SIGINT, &action, nullptr);
  signal(SIGPIPE, SIG_IGN);
  App app;
  int code = Closed;
  debugStats = getenv("SCRNSVR_RENDERER_DEBUG") != nullptr;
  try {
    app.options = parseOptions(argc, argv);
    code = run(app);
  } catch (const Fatal& fatal) {
    fprintf(stderr, "scrnsvr-renderer: %s\n", fatal.message.c_str());
    code = fatal.code;
  } catch (const std::exception& error) {
    fprintf(stderr, "scrnsvr-renderer: %s\n", error.what());
    code = Failed;
  }
  cleanup(app);
  return code;
}
