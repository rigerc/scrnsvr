// GLES2 scene renderer: one instance per output, owning objects in that output's context.
#pragma once
#include <GLES2/gl2.h>
#include <ctime>
#include <memory>
#include <string>
#include <vector>
#include "json.hh"

struct EffectSpec {
  std::string id;
  /** Intermediate passes followed by the final pass. */
  std::vector<std::string> passes;
  bool history = false;
  Json uniforms;
};

struct SceneSpec {
  std::string key;
  std::string source;
  Json uniforms;
  /** Built-ins read integrated phase as uTime with speed fixed at one. */
  bool integrated = false;
  bool audio = false;
  std::vector<EffectSpec> effects;
};

SceneSpec parseScene(const Json& message);

struct UniformInfo { std::string name; GLint location; GLenum type; GLint size; };
struct Program {
  GLuint id = 0;
  std::vector<UniformInfo> uniforms;
  const UniformInfo* find(const std::string& name) const;
};

struct Target { GLuint framebuffer = 0, texture = 0; int width = 0, height = 0; };

/** Clock text rendered by Pango, premultiplied RGBA rows from the top. */
struct ClockImage {
  std::vector<unsigned char> pixels;
  int width = 0, height = 0;
  /** Top-left corner in buffer pixels. */
  int x = 0, y = 0;
};

/** Artistic phase skips long suspension gaps; elapsed time keeps wall-clock deltas. */
struct AnimationClock {
  double elapsed = 0, phase = 0;
  double advance(double milliseconds, double speed) {
    double seconds = milliseconds > 0 ? milliseconds / 1000 : 0;
    elapsed += seconds;
    double active = seconds > 1.05 ? 0 : seconds;
    phase += active * speed;
    return active;
  }
};

class Renderer {
 public:
  Renderer() = default;
  Renderer(const Renderer&) = delete;
  Renderer& operator=(const Renderer&) = delete;
  ~Renderer();

  /** Compile utility programs; requires the output's context to be current. */
  void init();
  /** Throws when the base shader cannot compile; the previous scene is kept. */
  void setScene(const std::shared_ptr<const SceneSpec>& spec);
  bool hasScene() const { return scene != nullptr; }
  const std::shared_ptr<const SceneSpec>& spec() const { return sceneSpec; }
  void setClock(const ClockImage* image);
  /** Draw one frame into the bound default framebuffer. */
  void render(int width, int height, double deltaMs, const float audio[4], float overlay, float alpha);

 private:
  struct Layer {
    std::string id;
    std::vector<Program> programs;
    bool history = false;
    Json uniforms;
    Target historyTargets[2];
    int historyIndex = 0;
    bool historyValid = false;
  };
  struct Scene {
    Program program;
    Json uniforms;
    bool integrated = false, audio = false;
    double speedValue = 1;
    AnimationClock clock;
    float ambient[4] = {0, 0, 0, 0};
    float date[4] = {0, 0, 0, 0};
    std::vector<Layer> layers;
  };

  GLuint geometry = 0;
  Program finish, copy, clockProgram;
  GLuint clockTexture = 0;
  int clockX = 0, clockY = 0, clockWidth = 0, clockHeight = 0;
  bool clockVisible = false;
  std::unique_ptr<Scene> scene;
  std::shared_ptr<const SceneSpec> sceneSpec;
  AnimationClock effectsClock;
  Target targets[3];
  int targetCount = 0;
  std::string failedTargets;

  void drawTriangle(const Program& program);
  void drawBase(int width, int height);
  bool prepareTargets(int width, int height, int count);
  void renderEffects(int width, int height, double seconds);
  void destroyScene(Scene& value);
};

void destroyTarget(Target& target);
/** Empty when the fragment shader compiles and links; requires a current context. */
std::string compileError(const std::string& fragment);
