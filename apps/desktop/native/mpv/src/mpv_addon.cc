// BlammyTV libmpv addon.
//
// Phase 1 (DONE): prove libmpv links + loads against Electron's ABI and plays a
//   stream in mpv's OWN window — confirmed pixel-for-pixel with Telly.
// Phase 2 (IN PROGRESS): render libmpv INTO the page so our HTML controls
//   composite on top. The hard part is getting mpv's GPU pipeline (decode, HDR
//   tone-map, scale) to render into a framebuffer WE own, then reading it back
//   to a canvas. This file's `renderProbe` de-risks exactly that: it spins up an
//   offscreen OpenGL context, drives mpv's render API into our own FBO, reads
//   the pixels back, and writes them to a BMP so we can eyeball one real frame.
//
// See docs/libmpv-scope.md for the full plan.

#include <napi.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>

#include <windows.h>
#include <GL/gl.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// Phase 1: mpv in its own window (kept for A/B comparison against the canvas).
// ---------------------------------------------------------------------------

mpv_handle *g_mpv = nullptr;

void destroyMpv() {
  if (g_mpv) {
    mpv_terminate_destroy(g_mpv);
    g_mpv = nullptr;
  }
}

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

Napi::Value Stop(const Napi::CallbackInfo &info) {
  destroyMpv();
  return info.Env().Undefined();
}

Napi::Value ApiVersion(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(),
                           static_cast<double>(mpv_client_api_version()));
}

// ---------------------------------------------------------------------------
// Phase 2 step 1: offscreen GL render probe.
// ---------------------------------------------------------------------------

// The handful of framebuffer-object entry points aren't in GL 1.1 / opengl32's
// import lib, so we load them at runtime. (Textures, glReadPixels, glViewport,
// glClear etc. ARE in GL 1.1 — linked directly via opengl32.lib.)
#ifndef GL_FRAMEBUFFER
#define GL_FRAMEBUFFER 0x8D40
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#endif
typedef void(APIENTRY *PFNGLGENFRAMEBUFFERS)(GLsizei, GLuint *);
typedef void(APIENTRY *PFNGLBINDFRAMEBUFFER)(GLenum, GLuint);
typedef void(APIENTRY *PFNGLFRAMEBUFFERTEXTURE2D)(GLenum, GLenum, GLenum, GLuint,
                                                  GLint);
typedef GLenum(APIENTRY *PFNGLCHECKFRAMEBUFFERSTATUS)(GLenum);
typedef void(APIENTRY *PFNGLDELETEFRAMEBUFFERS)(GLsizei, const GLuint *);

PFNGLGENFRAMEBUFFERS p_glGenFramebuffers = nullptr;
PFNGLBINDFRAMEBUFFER p_glBindFramebuffer = nullptr;
PFNGLFRAMEBUFFERTEXTURE2D p_glFramebufferTexture2D = nullptr;
PFNGLCHECKFRAMEBUFFERSTATUS p_glCheckFramebufferStatus = nullptr;
PFNGLDELETEFRAMEBUFFERS p_glDeleteFramebuffers = nullptr;

void *glLoad(const char *name) {
  void *p = reinterpret_cast<void *>(wglGetProcAddress(name));
  if (!p) {
    static HMODULE gl = LoadLibraryA("opengl32.dll");
    if (gl) p = reinterpret_cast<void *>(GetProcAddress(gl, name));
  }
  return p;
}

bool loadFboFns() {
  p_glGenFramebuffers = (PFNGLGENFRAMEBUFFERS)glLoad("glGenFramebuffers");
  p_glBindFramebuffer = (PFNGLBINDFRAMEBUFFER)glLoad("glBindFramebuffer");
  p_glFramebufferTexture2D =
      (PFNGLFRAMEBUFFERTEXTURE2D)glLoad("glFramebufferTexture2D");
  p_glCheckFramebufferStatus =
      (PFNGLCHECKFRAMEBUFFERSTATUS)glLoad("glCheckFramebufferStatus");
  p_glDeleteFramebuffers =
      (PFNGLDELETEFRAMEBUFFERS)glLoad("glDeleteFramebuffers");
  return p_glGenFramebuffers && p_glBindFramebuffer &&
         p_glFramebufferTexture2D && p_glCheckFramebufferStatus &&
         p_glDeleteFramebuffers;
}

// mpv's get_proc_address callback (same loader).
static void *getProcAddress(void *, const char *name) { return glLoad(name); }

// Minimal hidden-window WGL context, made current on the calling thread.
struct GLContext {
  HWND hwnd = nullptr;
  HDC hdc = nullptr;
  HGLRC glrc = nullptr;

  std::string init() {
    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "BlammyMpvGL";
    RegisterClassA(&wc);  // ignore "already registered"

    hwnd = CreateWindowA("BlammyMpvGL", "blammy-gl", WS_OVERLAPPEDWINDOW, 0, 0,
                         16, 16, nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return "CreateWindow failed";
    hdc = GetDC(hwnd);
    if (!hdc) return "GetDC failed";

    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.iLayerType = PFD_MAIN_PLANE;
    int pf = ChoosePixelFormat(hdc, &pfd);
    if (!pf) return "ChoosePixelFormat failed";
    if (!SetPixelFormat(hdc, pf, &pfd)) return "SetPixelFormat failed";

    glrc = wglCreateContext(hdc);
    if (!glrc) return "wglCreateContext failed";
    if (!wglMakeCurrent(hdc, glrc)) return "wglMakeCurrent failed";

    if (!loadFboFns()) return "failed to load GL framebuffer functions";
    return "";
  }

  void destroy() {
    wglMakeCurrent(nullptr, nullptr);
    if (glrc) wglDeleteContext(glrc);
    if (hwnd && hdc) ReleaseDC(hwnd, hdc);
    if (hwnd) DestroyWindow(hwnd);
    glrc = nullptr;
    hdc = nullptr;
    hwnd = nullptr;
  }
};

// Write a 32-bit BGRA BMP. `rgba` is glReadPixels output (bottom-up), which
// matches BMP's bottom-up storage, so the image comes out upright.
bool writeBMP(const std::string &path, int w, int h,
              const std::vector<unsigned char> &rgba) {
  FILE *f = fopen(path.c_str(), "wb");
  if (!f) return false;
  const int rowSize = w * 4;
  const int dataSize = rowSize * h;
  const int fileSize = 14 + 40 + dataSize;
  const int offset = 14 + 40;

  unsigned char fh[14] = {'B', 'M'};
  memcpy(&fh[2], &fileSize, 4);
  memcpy(&fh[10], &offset, 4);

  unsigned char ih[40] = {};
  int hsize = 40;
  short planes = 1, bpp = 32;
  memcpy(&ih[0], &hsize, 4);
  memcpy(&ih[4], &w, 4);
  memcpy(&ih[8], &h, 4);  // positive => bottom-up
  memcpy(&ih[12], &planes, 2);
  memcpy(&ih[14], &bpp, 2);
  memcpy(&ih[20], &dataSize, 4);

  fwrite(fh, 1, 14, f);
  fwrite(ih, 1, 40, f);

  std::vector<unsigned char> row(rowSize);
  for (int y = 0; y < h; ++y) {
    const unsigned char *src = rgba.data() + static_cast<size_t>(y) * rowSize;
    for (int x = 0; x < w; ++x) {
      row[x * 4 + 0] = src[x * 4 + 2];  // B
      row[x * 4 + 1] = src[x * 4 + 1];  // G
      row[x * 4 + 2] = src[x * 4 + 0];  // R
      row[x * 4 + 3] = src[x * 4 + 3];  // A
    }
    fwrite(row.data(), 1, rowSize, f);
  }
  fclose(f);
  return true;
}

// renderProbe(url, outPath): renders one real frame offscreen and writes a BMP.
// Throws with a stage label on failure so build/runtime output pinpoints it.
Napi::Value RenderProbe(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "renderProbe(url, outPath) requires two strings")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string url = info[0].As<Napi::String>().Utf8Value();
  const std::string outPath = info[1].As<Napi::String>().Utf8Value();

  const int W = 960, H = 540;

  auto fail = [&](const std::string &msg) -> Napi::Value {
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  };

  GLContext gl;
  std::string glErr = gl.init();
  if (!glErr.empty()) return fail("GL init: " + glErr);

  // Offscreen FBO + color texture at display size.
  GLuint tex = 0, fbo = 0;
  glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE,
               nullptr);
  p_glGenFramebuffers(1, &fbo);
  p_glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  p_glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           tex, 0);
  if (p_glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    gl.destroy();
    return fail("FBO incomplete");
  }

  // mpv with the render API (no force-window — we own the surface).
  mpv_handle *mpv = mpv_create();
  if (!mpv) {
    gl.destroy();
    return fail("mpv_create failed");
  }
  // auto-copy: GPU-decode, then copy frames to system memory for upload to our
  // GL texture. Avoids the WGL_NV_DX_interop requirement that plain d3d11va→GL
  // needs (which a generic WGL context lacks → black frames). libplacebo still
  // does HDR tone-map + scaling during render, so the picture stays correct.
  // vo=libmpv forces the render-API video output (no window) — setting it BEFORE
  // initialize is the reliable way; relying on render_context_create to switch
  // the vo implicitly doesn't work on all libmpv builds (mpv was falling back to
  // a gpu window → our FBO stayed black).
  mpv_set_option_string(mpv, "vo", "libmpv");
  mpv_set_option_string(mpv, "hwdec", "auto-copy");
  mpv_set_option_string(mpv, "force-window", "no");
  mpv_set_option_string(mpv, "terminal", "no");
  if (mpv_initialize(mpv) < 0) {
    mpv_terminate_destroy(mpv);
    gl.destroy();
    return fail("mpv_initialize failed");
  }
  // Pipe mpv's own log to stderr (shows in the pnpm desktop terminal) so render
  // / vo problems are visible instead of guessed.
  mpv_request_log_messages(mpv, "v");

  mpv_opengl_init_params glParams = {getProcAddress, nullptr};
  // Basic (non-advanced) render mode: each mpv_render_context_render() draws the
  // current frame synchronously into the FBO we pass. Advanced control defers to
  // mpv's own frame timing/update-callback contract, which our simple polling
  // loop doesn't satisfy → black FBO (and an mpv fallback window).
  mpv_render_param createParams[] = {
      {MPV_RENDER_PARAM_API_TYPE,
       const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glParams},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv_render_context *rctx = nullptr;
  if (mpv_render_context_create(&rctx, mpv, createParams) < 0) {
    mpv_terminate_destroy(mpv);
    gl.destroy();
    return fail("mpv_render_context_create failed (GL too old?)");
  }

  const char *cmd[] = {"loadfile", url.c_str(), nullptr};
  if (mpv_command(mpv, cmd) < 0) {
    mpv_render_context_free(rctx);
    mpv_terminate_destroy(mpv);
    gl.destroy();
    return fail("loadfile failed");
  }

  // Pump until we get a frame with actual content (or time out).
  std::vector<unsigned char> pixels(static_cast<size_t>(W) * H * 4, 0);
  bool gotContent = false;
  int lastRenderRc = 0;
  const DWORD startTick = GetTickCount();
  const DWORD timeoutMs = 15000;

  while (GetTickCount() - startTick < timeoutMs) {
    // Drain events so mpv makes progress / we can spot a hard end-of-file.
    while (true) {
      mpv_event *ev = mpv_wait_event(mpv, 0);
      if (ev->event_id == MPV_EVENT_NONE) break;
      if (ev->event_id == MPV_EVENT_LOG_MESSAGE) {
        mpv_event_log_message *lm =
            static_cast<mpv_event_log_message *>(ev->data);
        fprintf(stderr, "[mpv] %s: %s", lm->prefix, lm->text);
      }
      if (ev->event_id == MPV_EVENT_END_FILE) {
        mpv_event_end_file *ef = static_cast<mpv_event_end_file *>(ev->data);
        if (ef && ef->reason == MPV_END_FILE_REASON_ERROR) {
          mpv_render_context_free(rctx);
          mpv_terminate_destroy(mpv);
          gl.destroy();
          return fail(std::string("playback error: ") +
                      mpv_error_string(ef->error));
        }
      }
    }

    // Render every iteration rather than gating on MPV_RENDER_UPDATE_FRAME:
    // without a registered update callback that flag may never set, so we'd
    // never render and the texture stays black. Once mpv has decoded a frame,
    // an unconditional render composites it and we read it back.
    mpv_render_context_update(rctx);
    mpv_opengl_fbo mfbo = {static_cast<int>(fbo), W, H, 0};
    int flipY = 0;
    mpv_render_param rp[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &mfbo},
                             {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                             {MPV_RENDER_PARAM_INVALID, nullptr}};
    glViewport(0, 0, W, H);
    lastRenderRc = mpv_render_context_render(rctx, rp);
    glFinish();

    p_glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());

    // "Content" = not an all-black frame (mpv renders black until the first
    // picture is decoded).
    uint64_t sum = 0;
    for (size_t i = 0; i < pixels.size(); i += 4)
      sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    if (sum > 0) {
      gotContent = true;
      break;
    }
    Sleep(10);
  }

  mpv_render_context_free(rctx);

  if (!gotContent) {
    // Surface what mpv thinks it decoded so we can tell "mpv never got a frame"
    // from "we rendered/read back wrong". dwidth>0 => mpv has video.
    int64_t dw = 0, dh = 0;
    mpv_get_property(mpv, "dwidth", MPV_FORMAT_INT64, &dw);
    mpv_get_property(mpv, "dheight", MPV_FORMAT_INT64, &dh);
    mpv_terminate_destroy(mpv);
    gl.destroy();
    return fail("timed out: black frames (render rc=" +
                std::to_string(lastRenderRc) + ", dwidth=" +
                std::to_string(dw) + ", dheight=" + std::to_string(dh) + ")");
  }

  mpv_terminate_destroy(mpv);

  bool wrote = writeBMP(outPath, W, H, pixels);
  gl.destroy();
  if (!wrote) return fail("failed to write BMP to " + outPath);

  return Napi::String::New(env, outPath);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("play", Napi::Function::New(env, Play));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("apiVersion", Napi::Function::New(env, ApiVersion));
  exports.Set("renderProbe", Napi::Function::New(env, RenderProbe));
  return exports;
}

}  // namespace

NODE_API_MODULE(mpv_addon, Init)
