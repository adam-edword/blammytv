// BlammyTV libmpv addon — Phase 1 spike.
//
// Goal: prove that libmpv links + loads against Electron's ABI and can play a
// stream. For the spike we let mpv open its OWN window (force-window) so we can
// eyeball that 4K/HEVC/HDR decode is flawless before we tackle render-to-canvas.
//
// See docs/libmpv-scope.md for the full plan.

#include <napi.h>
#include <mpv/client.h>
#include <string>

namespace {

mpv_handle *g_mpv = nullptr;

void destroyMpv() {
  if (g_mpv) {
    mpv_terminate_destroy(g_mpv);
    g_mpv = nullptr;
  }
}

// play(url: string): boolean — (re)creates an mpv instance and loads the URL.
Napi::Value Play(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "play(url) requires a URL string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string url = info[0].As<Napi::String>().Utf8Value();

  destroyMpv();

  g_mpv = mpv_create();
  if (!g_mpv) {
    Napi::Error::New(env, "mpv_create() failed (is libmpv-2.dll present?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Spike settings: mpv owns its own window + GPU pipeline (decode, HDR
  // tone-map, scaling) — exactly what we want to compare against Telly.
  mpv_set_option_string(g_mpv, "force-window", "yes");
  mpv_set_option_string(g_mpv, "hwdec", "auto-safe");
  mpv_set_option_string(g_mpv, "title", "BlammyTV — libmpv spike");
  mpv_set_option_string(g_mpv, "terminal", "no");
  mpv_set_option_string(g_mpv, "osc", "yes");

  int err = mpv_initialize(g_mpv);
  if (err < 0) {
    const std::string msg =
        std::string("mpv_initialize: ") + mpv_error_string(err);
    destroyMpv();
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  }

  const char *cmd[] = {"loadfile", url.c_str(), nullptr};
  err = mpv_command(g_mpv, cmd);
  if (err < 0) {
    const std::string msg = std::string("loadfile: ") + mpv_error_string(err);
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Boolean::New(env, true);
}

// stop(): void — tears the instance down (closes the mpv window).
Napi::Value Stop(const Napi::CallbackInfo &info) {
  destroyMpv();
  return info.Env().Undefined();
}

// apiVersion(): number — proves the DLL is linked/loadable without playing.
Napi::Value ApiVersion(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(),
                           static_cast<double>(mpv_client_api_version()));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("play", Napi::Function::New(env, Play));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("apiVersion", Napi::Function::New(env, ApiVersion));
  return exports;
}

}  // namespace

NODE_API_MODULE(mpv_addon, Init)
