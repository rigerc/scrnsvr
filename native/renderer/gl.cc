#include "gl.hh"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <stdexcept>

namespace {

const char* vertexSource = "attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}";
const char* finishSource = "precision mediump float; uniform vec4 uColor; void main(){gl_FragColor=uColor;}";
const char* copySource = "precision highp float; uniform sampler2D uInput; varying vec2 vUv; void main(){gl_FragColor=texture2D(uInput,vUv);}";
// Cairo rows start at the top; GL window coordinates start at the bottom.
const char* clockSource =
    "precision mediump float; uniform sampler2D uTexture; uniform vec4 uRect;"
    "void main(){vec2 p=(gl_FragCoord.xy-uRect.xy)/uRect.zw;"
    "if(p.x<0.0||p.y<0.0||p.x>1.0||p.y>1.0) discard;"
    "gl_FragColor=texture2D(uTexture,vec2(p.x,1.0-p.y));}";

GLuint compileShader(GLenum kind, const std::string& source) {
  GLuint shader = glCreateShader(kind);
  const char* text = source.c_str();
  glShaderSource(shader, 1, &text, nullptr);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    GLint length = 0;
    glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
    std::string log(size_t(std::max(length, 1)), '\0');
    glGetShaderInfoLog(shader, length, nullptr, log.data());
    glDeleteShader(shader);
    throw std::runtime_error("Shader compile failed: " + log);
  }
  return shader;
}

Program compileProgram(const std::string& fragment) {
  GLuint vertex = compileShader(GL_VERTEX_SHADER, vertexSource);
  GLuint pixel = 0;
  try { pixel = compileShader(GL_FRAGMENT_SHADER, fragment); }
  catch (...) { glDeleteShader(vertex); throw; }
  Program program;
  program.id = glCreateProgram();
  glAttachShader(program.id, vertex);
  glAttachShader(program.id, pixel);
  glBindAttribLocation(program.id, 0, "position");
  glBindAttribLocation(program.id, 1, "uv");
  glLinkProgram(program.id);
  glDeleteShader(vertex);
  glDeleteShader(pixel);
  GLint ok = 0;
  glGetProgramiv(program.id, GL_LINK_STATUS, &ok);
  if (!ok) {
    GLint length = 0;
    glGetProgramiv(program.id, GL_INFO_LOG_LENGTH, &length);
    std::string log(size_t(std::max(length, 1)), '\0');
    glGetProgramInfoLog(program.id, length, nullptr, log.data());
    glDeleteProgram(program.id);
    throw std::runtime_error("Shader link failed: " + log);
  }
  GLint count = 0;
  glGetProgramiv(program.id, GL_ACTIVE_UNIFORMS, &count);
  for (GLint index = 0; index < count; index++) {
    char name[256];
    GLsizei length = 0;
    GLint size = 0;
    GLenum type = 0;
    glGetActiveUniform(program.id, GLuint(index), sizeof name, &length, &size, &type, name);
    std::string uniform(name, size_t(length));
    if (auto bracket = uniform.find('['); bracket != std::string::npos) uniform.resize(bracket);
    program.uniforms.push_back({uniform, glGetUniformLocation(program.id, name), type, size});
  }
  return program;
}

void destroyProgram(Program& program) {
  if (program.id) glDeleteProgram(program.id);
  program = Program{};
}

/** Numbers and arrays from the scene plan, written according to the shader's declaration. */
void setUniform(const Program& program, const std::string& name, const Json& value) {
  const UniformInfo* info = program.find(name);
  if (!info || info->location < 0) return;
  float floats[16] = {0};
  int count = 0;
  if (value.type == Json::Array) for (const auto& item : value.items) { if (count < 16) floats[count++] = float(item.num()); }
  else { floats[0] = float(value.num()); count = 1; }
  switch (info->type) {
    case GL_FLOAT:
      if (info->size > 1 && count > 1) glUniform1fv(info->location, std::min(info->size, count), floats);
      else glUniform1f(info->location, floats[0]);
      break;
    case GL_FLOAT_VEC2: glUniform2fv(info->location, 1, floats); break;
    case GL_FLOAT_VEC3: glUniform3fv(info->location, 1, floats); break;
    case GL_FLOAT_VEC4: glUniform4fv(info->location, 1, floats); break;
    case GL_INT: case GL_BOOL: case GL_SAMPLER_2D: glUniform1i(info->location, int(std::lround(floats[0]))); break;
    case GL_INT_VEC2: case GL_BOOL_VEC2: glUniform2i(info->location, int(std::lround(floats[0])), int(std::lround(floats[1]))); break;
    case GL_INT_VEC3: case GL_BOOL_VEC3: glUniform3i(info->location, int(std::lround(floats[0])), int(std::lround(floats[1])), int(std::lround(floats[2]))); break;
    case GL_INT_VEC4: case GL_BOOL_VEC4: glUniform4i(info->location, int(std::lround(floats[0])), int(std::lround(floats[1])), int(std::lround(floats[2])), int(std::lround(floats[3]))); break;
    default: break;
  }
}

void setFloats(const Program& program, const char* name, std::initializer_list<float> values) {
  Json value;
  value.type = Json::Array;
  for (float item : values) { Json number; number.type = Json::Number; number.number = item; value.items.push_back(number); }
  setUniform(program, name, values.size() == 1 ? value.items[0] : value);
}

void setInt(const Program& program, const char* name, int value) {
  if (const UniformInfo* info = program.find(name); info && info->location >= 0) glUniform1i(info->location, value);
}

bool createTarget(Target& target, int width, int height) {
  destroyTarget(target);
  glGenTextures(1, &target.texture);
  glBindTexture(GL_TEXTURE_2D, target.texture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  glGenFramebuffers(1, &target.framebuffer);
  glBindFramebuffer(GL_FRAMEBUFFER, target.framebuffer);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target.texture, 0);
  bool complete = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE && glGetError() == GL_NO_ERROR;
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  target.width = width;
  target.height = height;
  if (!complete) destroyTarget(target);
  return complete;
}

void bindTarget(const Target* target, int width, int height) {
  glBindFramebuffer(GL_FRAMEBUFFER, target ? target->framebuffer : 0);
  glViewport(0, 0, width, height);
}

void bindTexture(int unit, GLuint texture) {
  glActiveTexture(GL_TEXTURE0 + GLenum(unit));
  glBindTexture(GL_TEXTURE_2D, texture);
}

}  // namespace

void destroyTarget(Target& target) {
  if (target.framebuffer) glDeleteFramebuffers(1, &target.framebuffer);
  if (target.texture) glDeleteTextures(1, &target.texture);
  target = Target{};
}

std::string compileError(const std::string& fragment) {
  try {
    Program program = compileProgram(fragment);
    destroyProgram(program);
    return "";
  } catch (const std::exception& error) { return error.what(); }
}

const UniformInfo* Program::find(const std::string& name) const {
  for (const auto& uniform : uniforms) if (uniform.name == name) return &uniform;
  return nullptr;
}

SceneSpec parseScene(const Json& message) {
  SceneSpec spec;
  spec.key = message["key"].str();
  const Json& shader = message["shader"];
  spec.source = shader["source"].str();
  spec.uniforms = shader["uniforms"];
  spec.integrated = shader["integrated"].flag();
  spec.audio = shader["audio"].flag();
  if (spec.source.empty()) throw std::runtime_error("Scene has no shader source");
  for (const auto& layer : message["effects"].items) {
    EffectSpec effect;
    effect.id = layer["id"].str();
    for (const auto& pass : layer["passes"].items) effect.passes.push_back(pass.str());
    effect.history = layer["history"].flag();
    effect.uniforms = layer["uniforms"];
    if (!effect.passes.empty()) spec.effects.push_back(std::move(effect));
  }
  return spec;
}

Renderer::~Renderer() {
  if (scene) destroyScene(*scene);
  for (auto& target : targets) destroyTarget(target);
  destroyProgram(finish);
  destroyProgram(copy);
  destroyProgram(clockProgram);
  if (clockTexture) glDeleteTextures(1, &clockTexture);
  if (geometry) glDeleteBuffers(1, &geometry);
}

void Renderer::init() {
  // One oversized triangle covers the viewport; uv reaches 1 at the edges.
  const float vertices[] = {-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2};
  glGenBuffers(1, &geometry);
  glBindBuffer(GL_ARRAY_BUFFER, geometry);
  glBufferData(GL_ARRAY_BUFFER, sizeof vertices, vertices, GL_STATIC_DRAW);
  finish = compileProgram(finishSource);
  copy = compileProgram(copySource);
  clockProgram = compileProgram(clockSource);
}

void Renderer::destroyScene(Scene& value) {
  destroyProgram(value.program);
  for (auto& layer : value.layers) {
    for (auto& program : layer.programs) destroyProgram(program);
    for (auto& target : layer.historyTargets) destroyTarget(target);
  }
  value.layers.clear();
}

void Renderer::setScene(const std::shared_ptr<const SceneSpec>& spec) {
  auto next = std::make_unique<Scene>();
  // Compile before replacing, so a broken shader cannot disturb the running scene.
  next->program = compileProgram(spec->source);
  next->uniforms = spec->uniforms;
  next->integrated = spec->integrated;
  next->audio = spec->audio;
  next->speedValue = spec->uniforms["speed"].num(1);
  time_t now = time(nullptr);
  struct tm local {};
  localtime_r(&now, &local);
  // Shadertoy iDate: year, month, day, seconds; clock faces follow artistic time from here.
  next->date[0] = float(local.tm_year + 1900);
  next->date[1] = float(local.tm_mon + 1);
  next->date[2] = float(local.tm_mday);
  next->date[3] = float(local.tm_hour * 3600 + local.tm_min * 60 + local.tm_sec);
  for (const auto& effect : spec->effects) {
    Layer layer;
    layer.id = effect.id;
    layer.history = effect.history;
    layer.uniforms = effect.uniforms;
    try {
      for (const auto& pass : effect.passes) layer.programs.push_back(compileProgram(pass));
    } catch (const std::exception& error) {
      for (auto& program : layer.programs) destroyProgram(program);
      fprintf(stderr, "scrnsvr effect %s could not compile and is skipped: %s\n", effect.id.c_str(), error.what());
      continue;
    }
    next->layers.push_back(std::move(layer));
  }
  if (scene) destroyScene(*scene);
  scene = std::move(next);
  sceneSpec = spec;
  failedTargets.clear();
  effectsClock = AnimationClock{};
}

void Renderer::setClock(const ClockImage* image) {
  clockVisible = image && image->width > 0 && image->height > 0;
  if (!clockVisible) return;
  if (!clockTexture) glGenTextures(1, &clockTexture);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, clockTexture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, image->width, image->height, 0, GL_RGBA, GL_UNSIGNED_BYTE, image->pixels.data());
  clockX = image->x;
  clockY = image->y;
  clockWidth = image->width;
  clockHeight = image->height;
}

void Renderer::drawTriangle(const Program& program) {
  glUseProgram(program.id);
  glBindBuffer(GL_ARRAY_BUFFER, geometry);
  glEnableVertexAttribArray(0);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), nullptr);
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), reinterpret_cast<const void*>(2 * sizeof(float)));
  glDrawArrays(GL_TRIANGLES, 0, 3);
}

void Renderer::drawBase(int width, int height) {
  Scene& s = *scene;
  glUseProgram(s.program.id);
  setFloats(s.program, "uTime", {float(s.integrated ? s.clock.phase : s.clock.elapsed)});
  setFloats(s.program, "uResolution", {float(width), float(height)});
  setFloats(s.program, "uDate", {s.date[0], s.date[1], s.date[2], s.date[3]});
  setFloats(s.program, "uAudio", {s.ambient[0], s.ambient[1], s.ambient[2], s.ambient[3]});
  for (const auto& [name, value] : s.uniforms.members) {
    if (s.integrated && name == "speed") setFloats(s.program, "speed", {1});
    else setUniform(s.program, name, value);
  }
  drawTriangle(s.program);
}

bool Renderer::prepareTargets(int width, int height, int count) {
  std::string key = std::to_string(width) + "x" + std::to_string(height);
  if (key == failedTargets) return false;
  bool ok = true;
  for (int index = 0; index < 3 && ok; index++) {
    if (index >= count) { destroyTarget(targets[index]); continue; }
    if (targets[index].framebuffer && targets[index].width == width && targets[index].height == height) continue;
    ok = createTarget(targets[index], width, height);
  }
  for (auto& layer : scene->layers) {
    if (!layer.history || !ok) continue;
    for (auto& target : layer.historyTargets) {
      if (target.framebuffer && target.width == width && target.height == height) continue;
      layer.historyValid = false;
      ok = ok && createTarget(target, width, height);
    }
  }
  if (!ok) {
    failedTargets = key;
    for (auto& target : targets) destroyTarget(target);
    for (auto& layer : scene->layers) for (auto& target : layer.historyTargets) destroyTarget(target);
    fprintf(stderr, "scrnsvr effect stack bypassed: could not allocate %s framebuffers\n", key.c_str());
    return false;
  }
  targetCount = count;
  return true;
}

void Renderer::renderEffects(int width, int height, double seconds) {
  auto& layers = scene->layers;
  bool multipass = std::any_of(layers.begin(), layers.end(), [](const Layer& layer) { return layer.programs.size() > 1; });
  int count = multipass ? 3 : layers.size() > 1 ? 2 : 1;
  if (layers.empty() || !prepareTargets(width, height, count)) {
    bindTarget(nullptr, width, height);
    drawBase(width, height);
    return;
  }
  auto find = [&](const Target* a, const Target* b) -> Target* {
    for (int index = 0; index < targetCount; index++) if (&targets[index] != a && &targets[index] != b) return &targets[index];
    return nullptr;
  };
  Target* input = &targets[0];
  bindTarget(input, width, height);
  drawBase(width, height);
  for (size_t index = 0; index < layers.size(); index++) {
    Layer& layer = layers[index];
    Target* original = input;
    bool last = index == layers.size() - 1;
    // A zero-delta frame presents the last temporal output instead of feeding it back again.
    if (!layer.history || seconds > 0 || !layer.historyValid) {
      for (size_t pass = 0; pass < layer.programs.size(); pass++) {
        bool final = pass == layer.programs.size() - 1;
        Target* target = final && layer.history ? &layer.historyTargets[1 - layer.historyIndex]
            : final && last ? nullptr
            : find(input, layer.programs.size() == 1 ? nullptr : original);
        const Program& program = layer.programs[pass];
        glUseProgram(program.id);
        bindTexture(0, input->texture);
        bindTexture(1, original->texture);
        bindTexture(2, layer.historyValid ? layer.historyTargets[layer.historyIndex].texture : original->texture);
        setInt(program, "uInput", 0);
        setInt(program, "uOriginal", 1);
        setInt(program, "uHistory", 2);
        setFloats(program, "uHistoryValid", {layer.historyValid ? 1.f : 0.f});
        setFloats(program, "uResolution", {float(width), float(height)});
        setFloats(program, "uTime", {float(effectsClock.phase)});
        setFloats(program, "uDelta", {float(seconds)});
        for (const auto& [name, value] : layer.uniforms.members) setUniform(program, name, value);
        bindTarget(target, width, height);
        drawTriangle(program);
        if (target) input = target;
      }
      if (layer.history) {
        layer.historyIndex = 1 - layer.historyIndex;
        layer.historyValid = true;
      }
    }
    if (layer.history) {
      Target* target = last ? nullptr : find(original, nullptr);
      glUseProgram(copy.id);
      bindTexture(0, layer.historyTargets[layer.historyIndex].texture);
      setInt(copy, "uInput", 0);
      bindTarget(target, width, height);
      drawTriangle(copy);
      if (target) input = target;
    }
  }
  glActiveTexture(GL_TEXTURE0);
}

void Renderer::render(int width, int height, double deltaMs, const float audio[4], float overlay, float alpha) {
  glDisable(GL_BLEND);
  glDisable(GL_DEPTH_TEST);
  if (scene) {
    Scene& s = *scene;
    double active = s.clock.advance(deltaMs, s.speedValue);
    if (s.audio) {
      // Follow musical accents promptly, then let the material relax without flashing.
      for (int i = 0; i < 4; i++) {
        float target = std::clamp(audio[i], 0.f, 1.f);
        double duration = target > s.ambient[i] ? 0.16 : 0.65;
        s.ambient[i] += float((target - s.ambient[i]) * -std::expm1(-std::max(0.0, active) / duration));
      }
    }
    double seconds = effectsClock.advance(deltaMs, 1);
    renderEffects(width, height, seconds);
  } else {
    bindTarget(nullptr, width, height);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
  }
  bindTarget(nullptr, width, height);
  if (clockVisible) {
    glEnable(GL_BLEND);
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    glUseProgram(clockProgram.id);
    bindTexture(0, clockTexture);
    setInt(clockProgram, "uTexture", 0);
    setFloats(clockProgram, "uRect", {float(clockX), float(height - clockY - clockHeight), float(clockWidth), float(clockHeight)});
    drawTriangle(clockProgram);
    glDisable(GL_BLEND);
  }
  // The scene is opaque regardless of what alpha its passes wrote.
  glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_TRUE);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
  glUseProgram(finish.id);
  glEnable(GL_BLEND);
  if (overlay > 0) {
    // Transition black over the scene; alpha is untouched.
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ZERO, GL_ONE);
    setFloats(finish, "uColor", {0, 0, 0, std::min(overlay, 1.f)});
    drawTriangle(finish);
  }
  if (alpha < 1) {
    // Premultiplied fade over the desktop: color and alpha both scale by alpha.
    glBlendFuncSeparate(GL_ZERO, GL_SRC_ALPHA, GL_ZERO, GL_SRC_ALPHA);
    setFloats(finish, "uColor", {0, 0, 0, std::max(alpha, 0.f)});
    drawTriangle(finish);
  }
  glDisable(GL_BLEND);
}
