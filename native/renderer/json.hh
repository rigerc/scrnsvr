// Minimal JSON reader for the main-process protocol (one message per line).
#pragma once
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct Json {
  enum Type { Null, Bool, Number, String, Array, Object } type = Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<Json> items;
  std::vector<std::pair<std::string, Json>> members;

  const Json& operator[](const std::string& key) const {
    static const Json missing;
    if (type == Object) for (const auto& [name, value] : members) if (name == key) return value;
    return missing;
  }
  double num(double fallback = 0) const { return type == Number ? number : type == Bool ? double(boolean) : fallback; }
  std::string str(const std::string& fallback = "") const { return type == String ? text : fallback; }
  bool flag(bool fallback = false) const { return type == Bool ? boolean : type == Number ? number != 0 : fallback; }
};

class JsonParser {
 public:
  explicit JsonParser(const std::string& input) : s(input) {}
  Json parse() {
    Json value = parseValue();
    skip();
    if (i != s.size()) fail("trailing characters");
    return value;
  }

 private:
  const std::string& s;
  size_t i = 0;
  [[noreturn]] void fail(const char* what) { throw std::runtime_error(std::string("Invalid JSON: ") + what); }
  void skip() { while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }
  bool consume(const char* word) {
    size_t n = std::char_traits<char>::length(word);
    if (s.compare(i, n, word) != 0) return false;
    i += n;
    return true;
  }
  Json parseValue() {
    skip();
    if (i >= s.size()) fail("unexpected end");
    Json value;
    char c = s[i];
    if (c == '{') {
      value.type = Json::Object; i++; skip();
      if (i < s.size() && s[i] == '}') { i++; return value; }
      for (;;) {
        skip();
        if (i >= s.size() || s[i] != '"') fail("expected key");
        std::string key = parseString();
        skip();
        if (i >= s.size() || s[i++] != ':') fail("expected ':'");
        value.members.emplace_back(std::move(key), parseValue());
        skip();
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == '}') { i++; return value; }
        fail("expected ',' or '}'");
      }
    }
    if (c == '[') {
      value.type = Json::Array; i++; skip();
      if (i < s.size() && s[i] == ']') { i++; return value; }
      for (;;) {
        value.items.push_back(parseValue());
        skip();
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == ']') { i++; return value; }
        fail("expected ',' or ']'");
      }
    }
    if (c == '"') { value.type = Json::String; value.text = parseString(); return value; }
    if (consume("true")) { value.type = Json::Bool; value.boolean = true; return value; }
    if (consume("false")) { value.type = Json::Bool; return value; }
    if (consume("null")) return value;
    size_t end = i;
    while (end < s.size() && std::string("+-0123456789.eE").find(s[end]) != std::string::npos) end++;
    if (end == i) fail("unexpected character");
    value.type = Json::Number;
    try { value.number = std::stod(s.substr(i, end - i)); } catch (...) { fail("bad number"); }
    i = end;
    return value;
  }
  unsigned hex4() {
    if (i + 4 > s.size()) fail("short escape");
    unsigned code = 0;
    for (int k = 0; k < 4; k++) {
      char h = s[i++];
      code <<= 4;
      if (h >= '0' && h <= '9') code |= unsigned(h - '0');
      else if (h >= 'a' && h <= 'f') code |= unsigned(h - 'a' + 10);
      else if (h >= 'A' && h <= 'F') code |= unsigned(h - 'A' + 10);
      else fail("bad escape");
    }
    return code;
  }
  static void utf8(std::string& out, uint32_t code) {
    if (code < 0x80) out += char(code);
    else if (code < 0x800) { out += char(0xc0 | (code >> 6)); out += char(0x80 | (code & 0x3f)); }
    else if (code < 0x10000) { out += char(0xe0 | (code >> 12)); out += char(0x80 | ((code >> 6) & 0x3f)); out += char(0x80 | (code & 0x3f)); }
    else { out += char(0xf0 | (code >> 18)); out += char(0x80 | ((code >> 12) & 0x3f)); out += char(0x80 | ((code >> 6) & 0x3f)); out += char(0x80 | (code & 0x3f)); }
  }
  std::string parseString() {
    i++;  // opening quote
    std::string out;
    while (i < s.size()) {
      char c = s[i++];
      if (c == '"') return out;
      if (c != '\\') { out += c; continue; }
      if (i >= s.size()) break;
      char e = s[i++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          uint32_t code = hex4();
          if (code >= 0xd800 && code < 0xdc00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
            i += 2;
            uint32_t low = hex4();
            code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          }
          utf8(out, code);
          break;
        }
        default: fail("bad escape");
      }
    }
    fail("unterminated string");
  }
};

inline Json parseJson(const std::string& input) { return JsonParser(input).parse(); }

inline std::string jsonQuote(const std::string& value) {
  std::string out = "\"";
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') { out += '\\'; out += char(c); }
    else if (c == '\n') out += "\\n";
    else if (c < 0x20) { char buffer[8]; snprintf(buffer, sizeof buffer, "\\u%04x", c); out += buffer; }
    else out += char(c);
  }
  return out + "\"";
}
