// Electron owns rendering; this host owns the Wayland connection and surface roles.
// All Wayland work runs on Node's event loop. JS notifications are deferred through
// a TSFN so a listener cannot destroy a surface inside a Wayland dispatch callback.
#include <node_api.h>
#include <uv.h>
#include <wayland-client.h>
#define namespace namespace_
#include "wlr-layer-shell-unstable-v1-client-protocol.h"
#undef namespace
#include "linux-dmabuf-unstable-v1-client-protocol.h"
#include <sys/mman.h>
#include <poll.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

struct Session;
struct Output {
  Session* session;
  uint32_t id;
  wl_output* proxy = nullptr;
  std::string name, description;
  int x = 0, y = 0, scale = 1;
  wl_surface* surface = nullptr;
  zwlr_layer_surface_v1* layer = nullptr;
  int width = 0, height = 0;
  unsigned frames = 0;
  uint32_t finalToken = 0;
  wl_callback* finalCallback = nullptr;
};
struct Frame {
  Session* session;
  uint32_t output, token;
  wl_buffer* buffer = nullptr;
  zwp_linux_buffer_params_v1* params = nullptr;
  void* memory = MAP_FAILED;
  size_t bytes = 0;
  ~Frame() {
    if (params) zwp_linux_buffer_params_v1_destroy(params);
    if (buffer) wl_buffer_destroy(buffer);
    if (memory != MAP_FAILED) munmap(memory, bytes);
  }
};
struct Event {
  std::string type, message = "";
  uint32_t output = 0, token = 0;
  int width = 0, height = 0, scale = 1;
};
struct Session {
  wl_display* display = nullptr;
  wl_registry* registry = nullptr;
  wl_compositor* compositor = nullptr;
  wl_shm* shm = nullptr;
  zwlr_layer_shell_v1* shell = nullptr;
  zwp_linux_dmabuf_v1* dmabuf = nullptr;
  wl_seat* seat = nullptr;
  wl_pointer* pointer = nullptr;
  wl_keyboard* keyboard = nullptr;
  wl_touch* touch = nullptr;
  uv_poll_t* poll = nullptr;
  napi_threadsafe_function callback = nullptr;
  std::map<uint32_t, std::unique_ptr<Output>> outputs;
  std::map<uint32_t, std::unique_ptr<Frame>> frames;
  std::set<std::pair<uint32_t, uint64_t>> formats;
  bool initializing = true, closed = false, dismissed = false;
  bool pointerOrigin = false;
  double pointerX = 0, pointerY = 0;
  void emit(Event event) {
    if (!callback) return;
    auto data = new Event(std::move(event));
    if (napi_call_threadsafe_function(callback, data, napi_tsfn_nonblocking) != napi_ok) delete data;
  }
  void dismiss() {
    if (!dismissed) { dismissed = true; emit({"dismiss"}); }
  }
  void release(uint32_t token) {
    auto it = frames.find(token);
    if (it == frames.end()) return;
    auto out = outputs.find(it->second->output);
    if (out != outputs.end() && out->second->frames) --out->second->frames;
    emit({"release", "", it->second->output, token});
    frames.erase(it);
  }
  void close() {
    if (closed) return;
    closed = true;
    if (poll) {
      uv_poll_stop(poll);
      uv_close(reinterpret_cast<uv_handle_t*>(poll), [](uv_handle_t* handle) { delete reinterpret_cast<uv_poll_t*>(handle); });
      poll = nullptr;
    }
    while (!frames.empty()) release(frames.begin()->first);
    for (auto& [id, out] : outputs) {
      if (out->finalCallback) wl_callback_destroy(out->finalCallback);
      if (out->layer) zwlr_layer_surface_v1_destroy(out->layer);
      if (out->surface) wl_surface_destroy(out->surface);
      if (out->proxy) wl_output_destroy(out->proxy);
    }
    outputs.clear();
    if (pointer) wl_pointer_destroy(pointer);
    if (keyboard) wl_keyboard_destroy(keyboard);
    if (touch) wl_touch_destroy(touch);
    if (seat) wl_seat_destroy(seat);
    if (dmabuf) zwp_linux_dmabuf_v1_destroy(dmabuf);
    // The manager's wire destroy request was added in v3; we bind v1.
    if (shell) wl_proxy_destroy(reinterpret_cast<wl_proxy*>(shell));
    if (shm) wl_shm_destroy(shm);
    if (compositor) wl_compositor_destroy(compositor);
    if (registry) wl_registry_destroy(registry);
    if (display) { wl_display_flush(display); wl_display_disconnect(display); display = nullptr; }
    if (callback) { napi_release_threadsafe_function(callback, napi_tsfn_release); callback = nullptr; }
  }
  ~Session() { close(); }
};

static napi_value number(napi_env env, double value) { napi_value out; napi_create_double(env, value, &out); return out; }
static napi_value string(napi_env env, const std::string& value) { napi_value out; napi_create_string_utf8(env, value.c_str(), value.size(), &out); return out; }
static void set(napi_env env, napi_value obj, const char* name, napi_value value) { napi_set_named_property(env, obj, name, value); }
static napi_value get(napi_env env, napi_value obj, const char* name) { napi_value out; if (napi_get_named_property(env, obj, name, &out) != napi_ok) throw std::runtime_error("Invalid frame metadata"); return out; }
static uint32_t integer(napi_env env, napi_value value) { uint32_t out; if (napi_get_value_uint32(env, value, &out) != napi_ok) throw std::runtime_error("Expected an integer"); return out; }
static Session* session(napi_env env, napi_value value) {
  Session* out = nullptr;
  if (napi_get_value_external(env, value, reinterpret_cast<void**>(&out)) != napi_ok || !out) throw std::runtime_error("Invalid Wayland session");
  return out;
}
static void notify(napi_env env, napi_value callback, void*, void* data) {
  std::unique_ptr<Event> event(static_cast<Event*>(data));
  if (!env || !callback) return;
  napi_value obj, receiver, result;
  napi_create_object(env, &obj);
  set(env, obj, "type", string(env, event->type));
  set(env, obj, "message", string(env, event->message));
  set(env, obj, "output", number(env, event->output));
  set(env, obj, "token", number(env, event->token));
  set(env, obj, "width", number(env, event->width));
  set(env, obj, "height", number(env, event->height));
  set(env, obj, "scale", number(env, event->scale));
  napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, callback, 1, &obj, &result);
}

// Bound discovery so an unresponsive compositor cannot hang application startup.
static void roundtrip(wl_display* display) {
  bool done = false;
  auto sync = wl_display_sync(display);
  static const wl_callback_listener listener = { [](void* data, wl_callback* cb, uint32_t) { *static_cast<bool*>(data) = true; wl_callback_destroy(cb); } };
  wl_callback_add_listener(sync, &listener, &done);
  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(1500);
  while (!done) {
    if (wl_display_dispatch_pending(display) < 0) break;
    if (done) return;
    if (wl_display_prepare_read(display) != 0) continue;
    int flushed = wl_display_flush(display);
    short events = POLLIN | ((flushed < 0 && errno == EAGAIN) ? POLLOUT : 0);
    pollfd fd{wl_display_get_fd(display), events, 0};
    int remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
    int result = remaining > 0 ? ::poll(&fd, 1, remaining) : 0;
    if (result < 0 && errno == EINTR) { wl_display_cancel_read(display); continue; }
    if (result <= 0 || (fd.revents & (POLLERR | POLLHUP | POLLNVAL))) { wl_display_cancel_read(display); break; }
    if (fd.revents & POLLIN) {
      if (wl_display_read_events(display) < 0) break;
    } else wl_display_cancel_read(display);
  }
  if (!done) { wl_callback_destroy(sync); throw std::runtime_error("Wayland discovery failed or timed out"); }
}

static wl_pointer_listener pointerListener = [] {
  wl_pointer_listener l{};
  l.enter = [](void* data, wl_pointer* pointer, uint32_t serial, wl_surface*, wl_fixed_t x, wl_fixed_t y) {
    auto s = static_cast<Session*>(data);
    wl_pointer_set_cursor(pointer, serial, nullptr, 0, 0);
    s->pointerOrigin = true; s->pointerX = wl_fixed_to_double(x); s->pointerY = wl_fixed_to_double(y);
  };
  l.leave = [](void* data, wl_pointer*, uint32_t, wl_surface*) { static_cast<Session*>(data)->pointerOrigin = false; };
  l.motion = [](void* data, wl_pointer*, uint32_t, wl_fixed_t x, wl_fixed_t y) {
    auto s = static_cast<Session*>(data);
    double px = wl_fixed_to_double(x), py = wl_fixed_to_double(y);
    double dx = px - s->pointerX, dy = py - s->pointerY;
    if (s->pointerOrigin && dx * dx + dy * dy > 144) s->dismiss();
    if (!s->pointerOrigin) { s->pointerOrigin = true; s->pointerX = px; s->pointerY = py; }
  };
  l.button = [](void* data, wl_pointer*, uint32_t, uint32_t, uint32_t, uint32_t state) { if (state == WL_POINTER_BUTTON_STATE_PRESSED) static_cast<Session*>(data)->dismiss(); };
  l.axis = [](void* data, wl_pointer*, uint32_t, uint32_t, wl_fixed_t) { static_cast<Session*>(data)->dismiss(); };
  l.frame = [](void*, wl_pointer*) {};
  l.axis_source = [](void*, wl_pointer*, uint32_t) {};
  l.axis_stop = [](void*, wl_pointer*, uint32_t, uint32_t) {};
  l.axis_discrete = [](void*, wl_pointer*, uint32_t, int32_t) {};
  return l;
}();
static const wl_keyboard_listener keyboardListener = {
  [](void*, wl_keyboard*, uint32_t, int32_t fd, uint32_t) { ::close(fd); },
  [](void*, wl_keyboard*, uint32_t, wl_surface*, wl_array*) {},
  [](void*, wl_keyboard*, uint32_t, wl_surface*) {},
  [](void* data, wl_keyboard*, uint32_t, uint32_t, uint32_t, uint32_t state) { if (state == WL_KEYBOARD_KEY_STATE_PRESSED) static_cast<Session*>(data)->dismiss(); },
  [](void*, wl_keyboard*, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t) {},
  [](void*, wl_keyboard*, int32_t, int32_t) {},
};
static wl_touch_listener touchListener = [] {
  wl_touch_listener l{};
  l.down = [](void* data, wl_touch*, uint32_t, uint32_t, wl_surface*, int32_t, wl_fixed_t, wl_fixed_t) { static_cast<Session*>(data)->dismiss(); };
  l.up = [](void*, wl_touch*, uint32_t, uint32_t, int32_t) {};
  l.motion = [](void*, wl_touch*, uint32_t, int32_t, wl_fixed_t, wl_fixed_t) {};
  l.frame = [](void*, wl_touch*) {};
  l.cancel = [](void*, wl_touch*) {};
  return l;
}();
static const wl_seat_listener seatListener = {
  [](void* data, wl_seat* seat, uint32_t capabilities) {
    auto s = static_cast<Session*>(data);
    if ((capabilities & WL_SEAT_CAPABILITY_POINTER) && !s->pointer) { s->pointer = wl_seat_get_pointer(seat); wl_pointer_add_listener(s->pointer, &pointerListener, s); }
    if (!(capabilities & WL_SEAT_CAPABILITY_POINTER) && s->pointer) { wl_pointer_destroy(s->pointer); s->pointer = nullptr; }
    if ((capabilities & WL_SEAT_CAPABILITY_KEYBOARD) && !s->keyboard) { s->keyboard = wl_seat_get_keyboard(seat); wl_keyboard_add_listener(s->keyboard, &keyboardListener, s); }
    if (!(capabilities & WL_SEAT_CAPABILITY_KEYBOARD) && s->keyboard) { wl_keyboard_destroy(s->keyboard); s->keyboard = nullptr; }
    if ((capabilities & WL_SEAT_CAPABILITY_TOUCH) && !s->touch) { s->touch = wl_seat_get_touch(seat); wl_touch_add_listener(s->touch, &touchListener, s); }
    if (!(capabilities & WL_SEAT_CAPABILITY_TOUCH) && s->touch) { wl_touch_destroy(s->touch); s->touch = nullptr; }
  },
  [](void*, wl_seat*, const char*) {},
};
static const wl_output_listener outputListener = {
  [](void* data, wl_output*, int32_t x, int32_t y, int32_t, int32_t, int32_t, const char*, const char*, int32_t) { auto o = static_cast<Output*>(data); o->x = x; o->y = y; },
  [](void*, wl_output*, uint32_t, int32_t, int32_t, int32_t) {},
  [](void* data, wl_output*) { auto o = static_cast<Output*>(data); if (!o->session->initializing) o->session->emit({"topology"}); },
  [](void* data, wl_output*, int32_t scale) { static_cast<Output*>(data)->scale = std::max(1, scale); },
  [](void* data, wl_output*, const char* name) { static_cast<Output*>(data)->name = name; },
  [](void* data, wl_output*, const char* description) { static_cast<Output*>(data)->description = description; },
};
static const zwp_linux_dmabuf_v1_listener dmabufListener = {
  [](void* data, zwp_linux_dmabuf_v1*, uint32_t format) { static_cast<Session*>(data)->formats.emplace(format, (uint64_t(1) << 56) - 1); },
  [](void* data, zwp_linux_dmabuf_v1*, uint32_t format, uint32_t hi, uint32_t lo) { static_cast<Session*>(data)->formats.emplace(format, (uint64_t(hi) << 32) | lo); },
};
static const wl_registry_listener registryListener = {
  [](void* data, wl_registry* registry, uint32_t id, const char* interface, uint32_t version) {
    auto s = static_cast<Session*>(data);
    if (!std::strcmp(interface, "wl_compositor")) s->compositor = static_cast<wl_compositor*>(wl_registry_bind(registry, id, &wl_compositor_interface, std::min(version, 4u)));
    else if (!std::strcmp(interface, "wl_shm")) s->shm = static_cast<wl_shm*>(wl_registry_bind(registry, id, &wl_shm_interface, 1));
    else if (!std::strcmp(interface, "zwlr_layer_shell_v1")) s->shell = static_cast<zwlr_layer_shell_v1*>(wl_registry_bind(registry, id, &zwlr_layer_shell_v1_interface, 1));
    else if (!std::strcmp(interface, "zwp_linux_dmabuf_v1") && version >= 3) {
      s->dmabuf = static_cast<zwp_linux_dmabuf_v1*>(wl_registry_bind(registry, id, &zwp_linux_dmabuf_v1_interface, 3));
      zwp_linux_dmabuf_v1_add_listener(s->dmabuf, &dmabufListener, s);
    } else if (!std::strcmp(interface, "wl_seat") && !s->seat) {
      s->seat = static_cast<wl_seat*>(wl_registry_bind(registry, id, &wl_seat_interface, std::min(version, 5u)));
      wl_seat_add_listener(s->seat, &seatListener, s);
    } else if (!std::strcmp(interface, "wl_output")) {
      auto output = std::make_unique<Output>(); output->session = s; output->id = id;
      output->proxy = static_cast<wl_output*>(wl_registry_bind(registry, id, &wl_output_interface, std::min(version, 4u)));
      wl_output_add_listener(output->proxy, &outputListener, output.get());
      s->outputs[id] = std::move(output);
    }
  },
  [](void* data, wl_registry*, uint32_t id) {
    auto s = static_cast<Session*>(data);
    if (s->outputs.count(id)) s->emit({"topology"});
  },
};
static void watch(Session* s);
static void dispatch(uv_poll_t* handle, int status, int events) {
  auto s = static_cast<Session*>(handle->data);
  bool failed = status < 0;
  if (!failed && (events & UV_READABLE)) {
    while (wl_display_prepare_read(s->display) != 0) {
      if (wl_display_dispatch_pending(s->display) < 0) { failed = true; break; }
    }
    if (!failed) failed = wl_display_read_events(s->display) < 0 || wl_display_dispatch_pending(s->display) < 0;
  }
  if (failed) { s->emit({"error", "Wayland compositor disconnected or rejected the surface"}); s->close(); }
  else watch(s);
}
static void watch(Session* s) {
  int result = wl_display_flush(s->display);
  if (result < 0 && errno != EAGAIN) { s->emit({"error", "Could not flush the Wayland connection"}); s->close(); return; }
  uv_poll_start(s->poll, UV_READABLE | (result < 0 ? UV_WRITABLE : 0), dispatch);
}
static const zwlr_layer_surface_v1_listener layerListener = {
  [](void* data, zwlr_layer_surface_v1* layer, uint32_t serial, uint32_t width, uint32_t height) {
    auto out = static_cast<Output*>(data);
    zwlr_layer_surface_v1_ack_configure(layer, serial);
    out->width = width; out->height = height;
    out->session->emit({"configure", "", out->id, 0, int(width), int(height), out->scale});
  },
  [](void* data, zwlr_layer_surface_v1*) { static_cast<Output*>(data)->session->emit({"closed"}); },
};
static void present(Frame* frame) {
  auto s = frame->session;
  auto& out = s->outputs.at(frame->output);
  // DMA-BUF imports finish asynchronously; none may replace the exit buffer.
  if (out->finalToken && frame->token != out->finalToken) { s->release(frame->token); return; }
  static const wl_buffer_listener listener = { [](void* data, wl_buffer*) { auto f = static_cast<Frame*>(data); f->session->release(f->token); } };
  wl_buffer_add_listener(frame->buffer, &listener, frame);
  wl_surface_set_buffer_scale(out->surface, out->scale);
  wl_surface_attach(out->surface, frame->buffer, 0, 0);
  wl_surface_damage(out->surface, 0, 0, out->width, out->height);
  wl_surface_commit(out->surface);
  s->emit({"presented", "", out->id, frame->token});
}
static const zwp_linux_buffer_params_v1_listener paramsListener = {
  [](void* data, zwp_linux_buffer_params_v1* params, wl_buffer* buffer) {
    auto frame = static_cast<Frame*>(data);
    zwp_linux_buffer_params_v1_destroy(params); frame->params = nullptr; frame->buffer = buffer;
    present(frame);
  },
  [](void* data, zwp_linux_buffer_params_v1*) {
    auto frame = static_cast<Frame*>(data);
    auto s = frame->session;
    s->emit({"gpu-failed", "Compositor rejected DMA-BUF import", frame->output});
    s->release(frame->token);
  },
};

#define API_BEGIN size_t argc = 8; napi_value argv[8]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr); try {
#define API_END } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
static napi_value create(napi_env env, napi_callback_info info) {
  API_BEGIN
  auto s = std::make_unique<Session>();
  napi_value resource = string(env, "scrnsvr layer-shell");
  if (argc < 1 || napi_create_threadsafe_function(env, argv[0], nullptr, resource, 0, 1, nullptr, nullptr, nullptr, notify, &s->callback) != napi_ok) throw std::runtime_error("Expected an event callback");
  napi_unref_threadsafe_function(env, s->callback);
  s->display = wl_display_connect(nullptr);
  if (!s->display) throw std::runtime_error("Cannot connect to Wayland");
  s->registry = wl_display_get_registry(s->display);
  wl_registry_add_listener(s->registry, &registryListener, s.get());
  roundtrip(s->display); roundtrip(s->display);
  if (!s->compositor || !s->shm || !s->shell || s->outputs.empty()) throw std::runtime_error("Compositor does not provide wlr-layer-shell and outputs");
  s->initializing = false;
  uv_loop_t* loop;
  napi_get_uv_event_loop(env, &loop);
  s->poll = new uv_poll_t;
  if (uv_poll_init(loop, s->poll, wl_display_get_fd(s->display)) != 0) { delete s->poll; s->poll = nullptr; throw std::runtime_error("Cannot watch Wayland connection"); }
  s->poll->data = s.get();
  watch(s.get());
  napi_value out;
  napi_create_external(env, s.release(), [](napi_env, void* data, void*) { delete static_cast<Session*>(data); }, nullptr, &out);
  return out;
  API_END
}
static napi_value outputs(napi_env env, napi_callback_info info) {
  API_BEGIN
  auto s = session(env, argv[0]);
  napi_value array; napi_create_array(env, &array);
  uint32_t index = 0;
  for (const auto& [id, out] : s->outputs) {
    napi_value value; napi_create_object(env, &value);
    set(env, value, "id", number(env, id)); set(env, value, "name", string(env, out->name));
    set(env, value, "description", string(env, out->description));
    set(env, value, "x", number(env, out->x)); set(env, value, "y", number(env, out->y));
    set(env, value, "scale", number(env, out->scale));
    napi_set_element(env, array, index++, value);
  }
  return array;
  API_END
}
static napi_value open(napi_env env, napi_callback_info info) {
  API_BEGIN
  auto s = session(env, argv[0]); auto id = integer(env, argv[1]);
  if (s->closed || !s->outputs.count(id)) throw std::runtime_error("Output unavailable");
  auto& out = s->outputs.at(id);
  if (out->surface) throw std::runtime_error("Surface already exists");
  out->surface = wl_compositor_create_surface(s->compositor);
  out->layer = zwlr_layer_shell_v1_get_layer_surface(s->shell, out->surface, out->proxy, ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY, "scrnsvr");
  zwlr_layer_surface_v1_add_listener(out->layer, &layerListener, out.get());
  zwlr_layer_surface_v1_set_anchor(out->layer, 15);
  zwlr_layer_surface_v1_set_size(out->layer, 0, 0);
  zwlr_layer_surface_v1_set_exclusive_zone(out->layer, -1);
  zwlr_layer_surface_v1_set_keyboard_interactivity(out->layer, 1);
  wl_surface_commit(out->surface);
  watch(s);
  return nullptr;
  API_END
}
static void bitmapBuffer(Frame& frame, uint32_t width, uint32_t height, const void* bytes = nullptr) {
  uint64_t required = uint64_t(width) * height * 4;
  if (!width || !height || required > INT32_MAX) throw std::runtime_error("Invalid bitmap size");
  int fd = memfd_create("scrnsvr-frame", MFD_CLOEXEC);
  if (fd < 0) throw std::runtime_error("Cannot allocate frame");
  if (ftruncate(fd, required) < 0) { ::close(fd); throw std::runtime_error("Cannot size frame"); }
  frame.bytes = required;
  frame.memory = mmap(nullptr, required, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (frame.memory == MAP_FAILED) { ::close(fd); throw std::runtime_error("Cannot map frame"); }
  // Fresh memfd storage is zero-filled. XRGB makes an empty exit buffer opaque.
  if (bytes) std::memcpy(frame.memory, bytes, required);
  auto pool = wl_shm_create_pool(frame.session->shm, fd, required);
  frame.buffer = wl_shm_pool_create_buffer(pool, 0, width, height, width * 4, bytes ? WL_SHM_FORMAT_ARGB8888 : WL_SHM_FORMAT_XRGB8888);
  wl_shm_pool_destroy(pool); ::close(fd);
}
static napi_value submit(napi_env env, napi_callback_info info) {
  API_BEGIN
  auto s = session(env, argv[0]); auto id = integer(env, argv[1]); auto token = integer(env, argv[2]);
  napi_value accepted; napi_get_boolean(env, false, &accepted);
  if (s->closed || !s->outputs.count(id) || s->frames.count(token)) return accepted;
  auto& out = s->outputs.at(id);
  if (!out->surface || out->finalToken || out->width <= 0 || out->height <= 0 || out->frames >= 3) return accepted;
  auto width = integer(env, get(env, argv[3], "width")), height = integer(env, get(env, argv[3], "height"));
  if (width != uint32_t(out->width * out->scale) || height != uint32_t(out->height * out->scale)) return accepted;
  auto frame = std::make_unique<Frame>(); frame->session = s; frame->output = id; frame->token = token;
  bool bitmap = false; napi_is_buffer(env, argv[4], &bitmap);
  if (bitmap) {
    void* bytes; size_t size;
    napi_get_buffer_info(env, argv[4], &bytes, &size);
    uint64_t required = uint64_t(width) * height * 4;
    if (required > INT32_MAX || size != required) return accepted;
    bitmapBuffer(*frame, width, height, bytes);
  } else {
    if (!s->dmabuf) return accepted;
    auto format = integer(env, get(env, argv[4], "format"));
    auto hi = integer(env, get(env, argv[4], "modifierHi")), lo = integer(env, get(env, argv[4], "modifierLo"));
    if (!s->formats.count({format, (uint64_t(hi) << 32) | lo})) return accepted;
    int fd = integer(env, get(env, argv[4], "fd"));
    auto offset = integer(env, get(env, argv[4], "offset")), stride = integer(env, get(env, argv[4], "stride"));
    frame->params = zwp_linux_dmabuf_v1_create_params(s->dmabuf);
    zwp_linux_buffer_params_v1_add_listener(frame->params, &paramsListener, frame.get());
    zwp_linux_buffer_params_v1_add(frame->params, fd, 0, offset, stride, hi, lo);
    zwp_linux_buffer_params_v1_create(frame->params, width, height, format, 0);
  }
  auto raw = frame.get(); s->frames[token] = std::move(frame); ++out->frames;
  if (raw->buffer) present(raw);
  watch(s);
  napi_get_boolean(env, true, &accepted); return accepted;
  API_END
}
static napi_value finish(napi_env env, napi_callback_info info) {
  API_BEGIN
  auto s = session(env, argv[0]); auto id = integer(env, argv[1]); auto token = integer(env, argv[2]);
  if (s->closed || !s->outputs.count(id)) return nullptr;
  auto& out = s->outputs.at(id);
  if (out->finalToken) return nullptr;
  if (!token || s->frames.count(token) || !out->surface || out->width <= 0 || out->height <= 0) throw std::runtime_error("Cannot finish layer-shell output");
  auto frame = std::make_unique<Frame>(); frame->session = s; frame->output = id; frame->token = token;
  bitmapBuffer(*frame, out->width * out->scale, out->height * out->scale);
  out->finalToken = token;
  out->finalCallback = wl_surface_frame(out->surface);
  static const wl_callback_listener listener = { [](void* data, wl_callback* callback, uint32_t) {
    auto output = static_cast<Output*>(data);
    wl_callback_destroy(callback); output->finalCallback = nullptr;
    output->session->emit({"finished", "", output->id, output->finalToken});
  } };
  wl_callback_add_listener(out->finalCallback, &listener, out.get());
  auto raw = frame.get(); s->frames[token] = std::move(frame); ++out->frames;
  present(raw);
  watch(s);
  return nullptr;
  API_END
}
static napi_value close(napi_env env, napi_callback_info info) {
  API_BEGIN
  session(env, argv[0])->close(); return nullptr;
  API_END
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"outputs", nullptr, outputs, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"open", nullptr, open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"submit", nullptr, submit, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"finish", nullptr, finish, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, close, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
