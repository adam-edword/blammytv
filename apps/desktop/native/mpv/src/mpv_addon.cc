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

#include <chrono>
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
#ifndef GL_PIXEL_PACK_BUFFER
#define GL_PIXEL_PACK_BUFFER 0x88EB
#define GL_STREAM_READ 0x88E1
#define GL_READ_ONLY 0x88B8
#endif
typedef ptrdiff_t GLsizeiptrT;
typedef void(APIENTRY *PFNGLGENFRAMEBUFFERS)(GLsizei, GLuint *);
typedef void(APIENTRY *PFNGLBINDFRAMEBUFFER)(GLenum, GLuint);
typedef void(APIENTRY *PFNGLFRAMEBUFFERTEXTURE2D)(GLenum, GLenum, GLenum, GLuint,
                                                  GLint);
typedef GLenum(APIENTRY *PFNGLCHECKFRAMEBUFFERSTATUS)(GLenum);
typedef void(APIENTRY *PFNGLDELETEFRAMEBUFFERS)(GLsizei, const GLuint *);
typedef void(APIENTRY *PFNGLGENBUFFERS)(GLsizei, GLuint *);
typedef void(APIENTRY *PFNGLBINDBUFFER)(GLenum, GLuint);
typedef void(APIENTRY *PFNGLBUFFERDATA)(GLenum, GLsizeiptrT, const void *,
                                        GLenum);
typedef void *(APIENTRY *PFNGLMAPBUFFER)(GLenum, GLenum);
typedef GLboolean(APIENTRY *PFNGLUNMAPBUFFER)(GLenum);
typedef void(APIENTRY *PFNGLDELETEBUFFERS)(GLsizei, const GLuint *);

PFNGLGENFRAMEBUFFERS p_glGenFramebuffers = nullptr;
PFNGLBINDFRAMEBUFFER p_glBindFramebuffer = nullptr;
PFNGLFRAMEBUFFERTEXTURE2D p_glFramebufferTexture2D = nullptr;
PFNGLCHECKFRAMEBUFFERSTATUS p_glCheckFramebufferStatus = nullptr;
PFNGLDELETEFRAMEBUFFERS p_glDeleteFramebuffers = nullptr;
PFNGLGENBUFFERS p_glGenBuffers = nullptr;
PFNGLBINDBUFFER p_glBindBuffer = nullptr;
PFNGLBUFFERDATA p_glBufferData = nullptr;
PFNGLMAPBUFFER p_glMapBuffer = nullptr;
PFNGLUNMAPBUFFER p_glUnmapBuffer = nullptr;
PFNGLDELETEBUFFERS p_glDeleteBuffers = nullptr;

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
  p_glGenBuffers = (PFNGLGENBUFFERS)glLoad("glGenBuffers");
  p_glBindBuffer = (PFNGLBINDBUFFER)glLoad("glBindBuffer");
  p_glBufferData = (PFNGLBUFFERDATA)glLoad("glBufferData");
  p_glMapBuffer = (PFNGLMAPBUFFER)glLoad("glMapBuffer");
  p_glUnmapBuffer = (PFNGLUNMAPBUFFER)glLoad("glUnmapBuffer");
  p_glDeleteBuffers = (PFNGLDELETEBUFFERS)glLoad("glDeleteBuffers");
  return p_glGenFramebuffers && p_glBindFramebuffer &&
         p_glFramebufferTexture2D && p_glCheckFramebufferStatus &&
         p_glDeleteFramebuffers && p_glGenBuffers && p_glBindBuffer &&
         p_glBufferData && p_glMapBuffer && p_glUnmapBuffer &&
         p_glDeleteBuffers;
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
    int flipY = 1;  // mpv renders bottom-up for GL; flip so readback is upright
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

// ---------------------------------------------------------------------------
// Phase 2 step 2: persistent player that renders live frames for a <canvas>.
// Keeps one GL context + mpv + render context alive; playerRenderFrame(w,h)
// renders the current frame into an FBO at the requested size, reads it back,
// and returns the RGBA bytes. The renderer drives it from a loop and uploads
// each frame to a canvas. mpv plays audio natively (WASAPI), so sound just works.
// ---------------------------------------------------------------------------

struct Player {
  GLContext gl;
  mpv_handle *mpv = nullptr;
  mpv_render_context *rctx = nullptr;
  GLuint fbo = 0;
  GLuint tex = 0;
  int w = 0;
  int h = 0;
  std::vector<unsigned char> pixels;
  bool started = false;
  std::string glRenderer;
  std::string glVersion;
  // Rolling per-call timings (ms) to localize the consume-loop bottleneck.
  double avgRenderMs = 0;
  double avgReadMs = 0;
  double avgDrainMs = 0;
  bool hasFrame = false;
  std::chrono::high_resolution_clock::time_point lastRenderTp{};
  // Double-buffered pixel-pack buffers for async readback (no GPU stall).
  GLuint pbo[2] = {0, 0};
  int pboIndex = 0;
  int pboFilled = 0;  // how many PBOs hold a completed readback yet
  int mappedPbo = -1;  // PBO currently mapped into the last returned Buffer
  size_t pboBytes = 0;
};

Player g_player;

void playerTeardown() {
  if (g_player.rctx) {
    mpv_render_context_free(g_player.rctx);
    g_player.rctx = nullptr;
  }
  if (g_player.mpv) {
    mpv_terminate_destroy(g_player.mpv);
    g_player.mpv = nullptr;
  }
  if (g_player.started) {
    g_player.gl.destroy();
  }
  g_player.fbo = 0;
  g_player.tex = 0;
  g_player.w = 0;
  g_player.h = 0;
  g_player.started = false;
  // GL objects die with the context; just reset the readback-pipeline state.
  g_player.pbo[0] = g_player.pbo[1] = 0;
  g_player.pboIndex = 0;
  g_player.pboFilled = 0;
  g_player.mappedPbo = -1;
  g_player.pboBytes = 0;
}

// playerStartWindow(url): boolean — native theater path. mpv renders to its own
// borderless fullscreen GPU surface (d3d11va direct, zero readback → true
// 4K60), which a transparent Electron overlay layers on top of. Uses g_player's
// mpv handle so the same playerSetPause/Volume/Seek controls drive it.
Napi::Value PlayerStartWindow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "playerStartWindow(url) requires a URL string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string url = info[0].As<Napi::String>().Utf8Value();

  playerTeardown();

  auto fail = [&](const std::string &msg) -> Napi::Value {
    playerTeardown();
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  };

  g_player.mpv = mpv_create();
  if (!g_player.mpv) return fail("mpv_create failed");
  // Native window: full hardware path, no render API. Our overlay draws the UI.
  mpv_set_option_string(g_player.mpv, "force-window", "yes");
  mpv_set_option_string(g_player.mpv, "fullscreen", "yes");
  mpv_set_option_string(g_player.mpv, "border", "no");
  mpv_set_option_string(g_player.mpv, "ontop", "no");
  mpv_set_option_string(g_player.mpv, "osc", "no");
  // Present through DWM (bitblt), not a flip-model swapchain. Flip mode gets
  // promoted to a hardware overlay (MPO) that bypasses DWM composition, so a
  // transparent window layered on top can't show the video through it.
  mpv_set_option_string(g_player.mpv, "d3d11-flip", "no");
  // Tone-map HDR → SDR. Windows composites a transparent window in SDR, so HDR
  // output underneath gets crushed to near-black. Force SDR so it composites
  // correctly (bright) under our overlay.
  mpv_set_option_string(g_player.mpv, "target-trc", "bt.1886");
  mpv_set_option_string(g_player.mpv, "target-prim", "bt.709");
  mpv_set_option_string(g_player.mpv, "input-default-bindings", "no");
  mpv_set_option_string(g_player.mpv, "input-vo-keyboard", "no");
  mpv_set_option_string(g_player.mpv, "hwdec", "auto-safe");
  mpv_set_option_string(g_player.mpv, "title", "BlammyTV Theater");
  mpv_set_option_string(g_player.mpv, "terminal", "no");
  if (mpv_initialize(g_player.mpv) < 0) return fail("mpv_initialize failed");

  const char *cmd[] = {"loadfile", url.c_str(), nullptr};
  if (mpv_command(g_player.mpv, cmd) < 0) return fail("loadfile failed");
  return Napi::Boolean::New(env, true);
}

// playerStart(url): boolean — (re)create the player and begin playback.
Napi::Value PlayerStart(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "playerStart(url) requires a URL string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string url = info[0].As<Napi::String>().Utf8Value();

  playerTeardown();

  auto fail = [&](const std::string &msg) -> Napi::Value {
    playerTeardown();
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  };

  std::string glErr = g_player.gl.init();
  if (!glErr.empty()) return fail("GL init: " + glErr);

  // Capture the GL renderer/version so we can tell hardware GL from a software
  // fallback (a key suspect for fixed-cost-per-frame slowness).
  auto glStr = [](GLenum e) -> std::string {
    const GLubyte *p = glGetString(e);
    return p ? std::string(reinterpret_cast<const char *>(p)) : std::string("?");
  };
  g_player.glRenderer = glStr(GL_RENDERER);
  g_player.glVersion = glStr(GL_VERSION);

  glGenTextures(1, &g_player.tex);
  glBindTexture(GL_TEXTURE_2D, g_player.tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  p_glGenFramebuffers(1, &g_player.fbo);
  p_glBindFramebuffer(GL_FRAMEBUFFER, g_player.fbo);

  g_player.mpv = mpv_create();
  if (!g_player.mpv) return fail("mpv_create failed");
  mpv_set_option_string(g_player.mpv, "vo", "libmpv");
  mpv_set_option_string(g_player.mpv, "hwdec", "auto-copy");
  mpv_set_option_string(g_player.mpv, "force-window", "no");
  mpv_set_option_string(g_player.mpv, "terminal", "no");
  // Leave framedrop at its default: mpv drops the occasional late frame to stay
  // realtime (a few/sec, harmless and smooth). framedrop=no makes it present
  // every frame instead, which drifts into slow motion under our pull cadence.
  if (mpv_initialize(g_player.mpv) < 0) return fail("mpv_initialize failed");

  mpv_opengl_init_params glParams = {getProcAddress, nullptr};
  mpv_render_param createParams[] = {
      {MPV_RENDER_PARAM_API_TYPE,
       const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glParams},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  if (mpv_render_context_create(&g_player.rctx, g_player.mpv, createParams) < 0)
    return fail("mpv_render_context_create failed");

  const char *cmd[] = {"loadfile", url.c_str(), nullptr};
  if (mpv_command(g_player.mpv, cmd) < 0) return fail("loadfile failed");

  g_player.started = true;
  return Napi::Boolean::New(env, true);
}

// playerRenderFrame(w, h): Buffer | null — render the current frame at w×h and
// return its RGBA bytes (upright). Returns null until playback produced a frame.
Napi::Value PlayerRenderFrame(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!g_player.started) return env.Null();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "playerRenderFrame(w, h) requires two numbers")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  int w = info[0].As<Napi::Number>().Int32Value();
  int h = info[1].As<Napi::Number>().Int32Value();
  if (w < 16 || h < 16 || w > 7680 || h > 4320) return env.Null();

  using clk = std::chrono::high_resolution_clock;
  auto ms = [](clk::time_point a, clk::time_point b) {
    return std::chrono::duration<double, std::milli>(b - a).count();
  };

  // Our context may have been displaced (e.g. by the probe); reassert it.
  wglMakeCurrent(g_player.gl.hdc, g_player.gl.glrc);

  // Drain events (keep mpv progressing; ignore content).
  auto t0 = clk::now();
  while (mpv_wait_event(g_player.mpv, 0)->event_id != MPV_EVENT_NONE) {
  }
  auto t1 = clk::now();

  const bool resized = (w != g_player.w || h != g_player.h);

  // Advance the render context and render on every call (i.e. every display
  // refresh) — presenting each vsync matches the native popout's smoothness.
  // Gating on the new-frame flag lowered the drop counter but capped us below
  // the source fps (phase beat). mpv still drops the odd frame to stay realtime;
  // that counter is cosmetic and not what the viewer sees.
  mpv_render_context_update(g_player.rctx);

  // The Buffer we returned last frame aliased a mapped PBO; JS consumed it
  // synchronously (the WebGL upload), so unmap it now before we reuse it.
  if (g_player.mappedPbo >= 0) {
    p_glBindBuffer(GL_PIXEL_PACK_BUFFER, g_player.pbo[g_player.mappedPbo]);
    p_glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
    p_glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    g_player.mappedPbo = -1;
  }

  const size_t bytes = static_cast<size_t>(w) * h * 4;
  if (resized) {
    glBindTexture(GL_TEXTURE_2D, g_player.tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
    p_glBindFramebuffer(GL_FRAMEBUFFER, g_player.fbo);
    p_glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                             GL_TEXTURE_2D, g_player.tex, 0);
    // (Re)allocate the readback PBOs at the new size; restart the pipeline.
    if (g_player.pbo[0]) p_glDeleteBuffers(2, g_player.pbo);
    p_glGenBuffers(2, g_player.pbo);
    for (int i = 0; i < 2; ++i) {
      p_glBindBuffer(GL_PIXEL_PACK_BUFFER, g_player.pbo[i]);
      p_glBufferData(GL_PIXEL_PACK_BUFFER, static_cast<GLsizeiptrT>(bytes),
                     nullptr, GL_STREAM_READ);
    }
    p_glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    g_player.w = w;
    g_player.h = h;
    g_player.pboBytes = bytes;
    g_player.pboIndex = 0;
    g_player.pboFilled = 0;
  }

  mpv_opengl_fbo mfbo = {static_cast<int>(g_player.fbo), w, h, 0};
  int flipY = 0;
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &mfbo},
                           {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                           {MPV_RENDER_PARAM_INVALID, nullptr}};
  glViewport(0, 0, w, h);
  auto t2 = clk::now();
  mpv_render_context_render(g_player.rctx, rp);
  auto t3 = clk::now();

  // Async readback into pbo[index] (returns immediately; GPU DMAs into it).
  const int idx = g_player.pboIndex;
  const int prev = idx ^ 1;
  p_glBindFramebuffer(GL_FRAMEBUFFER, g_player.fbo);
  p_glBindBuffer(GL_PIXEL_PACK_BUFFER, g_player.pbo[idx]);
  glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);

  // Map the OTHER PBO — the readback we issued last frame, which the GPU has
  // long since finished, so the map doesn't stall. Return a zero-copy Buffer
  // over it (unmapped at the start of next frame).
  Napi::Value result = env.Null();
  if (g_player.pboFilled >= 1) {
    p_glBindBuffer(GL_PIXEL_PACK_BUFFER, g_player.pbo[prev]);
    void *ptr = p_glMapBuffer(GL_PIXEL_PACK_BUFFER, GL_READ_ONLY);
    if (ptr) {
      g_player.mappedPbo = prev;
      result = Napi::Buffer<unsigned char>::New(
          env, static_cast<unsigned char *>(ptr), bytes);
    }
  }
  p_glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);

  g_player.pboIndex = prev;
  if (g_player.pboFilled < 2) g_player.pboFilled++;
  auto t4 = clk::now();

  mpv_render_context_report_swap(g_player.rctx);
  g_player.lastRenderTp = t4;
  g_player.hasFrame = true;

  const double a = 0.1;  // EMA smoothing
  g_player.avgDrainMs += (ms(t0, t1) - g_player.avgDrainMs) * a;
  g_player.avgRenderMs += (ms(t2, t3) - g_player.avgRenderMs) * a;
  g_player.avgReadMs += (ms(t3, t4) - g_player.avgReadMs) * a;

  return result;
}

// playerStats(): string — diagnostics: which decoder mpv actually chose, real
// fps, dropped frames, and the GL renderer (hardware vs software).
Napi::Value PlayerStats(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!g_player.started || !g_player.mpv)
    return Napi::String::New(env, "(player not started)");

  char *hw = mpv_get_property_string(g_player.mpv, "hwdec-current");
  double vfFps = 0, containerFps = 0;
  int64_t drops = 0, decDrops = 0;
  mpv_get_property(g_player.mpv, "estimated-vf-fps", MPV_FORMAT_DOUBLE, &vfFps);
  mpv_get_property(g_player.mpv, "container-fps", MPV_FORMAT_DOUBLE,
                   &containerFps);
  mpv_get_property(g_player.mpv, "frame-drop-count", MPV_FORMAT_INT64, &drops);
  mpv_get_property(g_player.mpv, "decoder-frame-drop-count", MPV_FORMAT_INT64,
                   &decDrops);

  std::string out = "hwdec=" + std::string(hw ? hw : "(none)") +
                    " | container-fps=" + std::to_string(containerFps) +
                    " | vf-fps=" + std::to_string(vfFps) +
                    " | drops=" + std::to_string(drops) +
                    " | dec-drops=" + std::to_string(decDrops) +
                    " | render=" + std::to_string(g_player.avgRenderMs) +
                    "ms read=" + std::to_string(g_player.avgReadMs) +
                    "ms drain=" + std::to_string(g_player.avgDrainMs) +
                    "ms | gl=" + g_player.glRenderer + " (" +
                    g_player.glVersion + ")";
  if (hw) mpv_free(hw);
  return Napi::String::New(env, out);
}

// --- player controls (drive mpv directly) ---------------------------------

Napi::Value PlayerSetPause(const Napi::CallbackInfo &info) {
  if (g_player.mpv && info.Length() >= 1) {
    int flag = info[0].ToBoolean().Value() ? 1 : 0;
    mpv_set_property(g_player.mpv, "pause", MPV_FORMAT_FLAG, &flag);
  }
  return info.Env().Undefined();
}

Napi::Value PlayerSetMute(const Napi::CallbackInfo &info) {
  if (g_player.mpv && info.Length() >= 1) {
    int flag = info[0].ToBoolean().Value() ? 1 : 0;
    mpv_set_property(g_player.mpv, "mute", MPV_FORMAT_FLAG, &flag);
  }
  return info.Env().Undefined();
}

// playerSetVolume(v): v is 0..100 (mpv's scale).
Napi::Value PlayerSetVolume(const Napi::CallbackInfo &info) {
  if (g_player.mpv && info.Length() >= 1) {
    double v = info[0].ToNumber().DoubleValue();
    mpv_set_property(g_player.mpv, "volume", MPV_FORMAT_DOUBLE, &v);
  }
  return info.Env().Undefined();
}

// playerSeek(delta): relative seek in seconds (best-effort within live buffer).
Napi::Value PlayerSeek(const Napi::CallbackInfo &info) {
  if (g_player.mpv && info.Length() >= 1) {
    std::string d = std::to_string(info[0].ToNumber().DoubleValue());
    const char *cmd[] = {"seek", d.c_str(), "relative", nullptr};
    mpv_command(g_player.mpv, cmd);
  }
  return info.Env().Undefined();
}

// playerStop(): void — tear the player down.
Napi::Value PlayerStop(const Napi::CallbackInfo &info) {
  playerTeardown();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("play", Napi::Function::New(env, Play));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("apiVersion", Napi::Function::New(env, ApiVersion));
  exports.Set("renderProbe", Napi::Function::New(env, RenderProbe));
  exports.Set("playerStart", Napi::Function::New(env, PlayerStart));
  exports.Set("playerStartWindow", Napi::Function::New(env, PlayerStartWindow));
  exports.Set("playerRenderFrame", Napi::Function::New(env, PlayerRenderFrame));
  exports.Set("playerStats", Napi::Function::New(env, PlayerStats));
  exports.Set("playerSetPause", Napi::Function::New(env, PlayerSetPause));
  exports.Set("playerSetMute", Napi::Function::New(env, PlayerSetMute));
  exports.Set("playerSetVolume", Napi::Function::New(env, PlayerSetVolume));
  exports.Set("playerSeek", Napi::Function::New(env, PlayerSeek));
  exports.Set("playerStop", Napi::Function::New(env, PlayerStop));
  return exports;
}

}  // namespace

NODE_API_MODULE(mpv_addon, Init)
