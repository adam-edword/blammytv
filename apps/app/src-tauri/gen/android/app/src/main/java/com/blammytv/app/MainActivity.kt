package com.blammytv.app

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.graphics.Outline
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import coil.load
import org.json.JSONObject

// Android player model: a native Media3 PlayerView rendered ON TOP of the
// WebView. The PlayerView is an opaque SurfaceView plus Media3's built-in,
// remote-friendly transport (play/pause, scrubber, ±10s) — so there is no
// compositing and no transparency: the video is its own view, shown fullscreen
// only while watching and hidden again on close. The Back button (or JS stop())
// closes it and returns to the React UI.
//
// This deliberately replaces the earlier "video behind a transparent WebView"
// spike, which leaked the fullscreen video behind the whole app. Driven from JS
// via window.BlammyNativePlayer.
class MainActivity : TauriActivity() {
  private var player: ExoPlayer? = null
  private var playerContainer: View? = null
  private var playerView: PlayerView? = null
  private var chromeView: View? = null
  private var webViewRef: WebView? = null

  // BlammyTV chrome views inside the custom controller layout.
  private var logoView: ImageView? = null
  private var metaView: TextView? = null
  private var titleView: TextView? = null
  private var subtitleView: TextView? = null
  private var speedButton: Button? = null
  private var speedIndex = SPEED_DEFAULT_INDEX

  // Loading + error overlays (replace Media3's default spinner).
  private var loadingView: TextView? = null
  private var errorView: TextView? = null

  // Player placement. Live plays in a "mini" surface positioned over the React
  // hero box (video only, no chrome, NOT focusable so the remote keeps driving
  // the EPG behind it); tapping it (from JS) goes "fullscreen" (match_parent,
  // chrome, focusable). VOD always loads fullscreen. The mini rect is in physical
  // px, mirrored from the web box by the JS rAF loop (setRect).
  private var fullscreen = true
  // Whether this session has a mini surface (live). VOD has none, so its Back
  // closes the player rather than collapsing to a mini.
  private var hasMini = false
  private var miniX = 0
  private var miniY = 0
  private var miniW = 0
  private var miniH = 0
  private var miniRadius = 0

  // Back closes the player. wry consumes the Back key INSIDE the WebView
  // (webView.goBack()) before the OnBackPressedDispatcher or onBackPressed()
  // ever run — so neither could intercept it, and Back just walked the React
  // app's history underneath the still-visible player. dispatchKeyEvent is the
  // Activity's earliest key hook, before the event reaches the WebView: while
  // the player is showing we consume Back here and close the player.
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    // Only the fullscreen player owns the remote. In mini the surface is just a
    // preview behind the React UI, so keys fall through to the WebView (EPG nav).
    val owns = fullscreen && playerContainer?.visibility == View.VISIBLE
    if (!owns) return super.dispatchKeyEvent(event)

    if (event.keyCode == KeyEvent.KEYCODE_BACK) {
      // Back dismisses the controls first if they're showing. Otherwise: live
      // collapses fullscreen → mini (keeps playing, returns to the EPG); VOD has
      // no mini, so it closes the player.
      if (event.action == KeyEvent.ACTION_UP) {
        if (!controlsHidden()) hideControls()
        else if (hasMini) collapseToMini()
        else closePlayer()
      }
      return true // consume both DOWN and UP so the WebView never navigates
    }
    // A remote key reveals the controls and resets their idle fade-out timer;
    // the first press while they're hidden only reveals them.
    if (event.action == KeyEvent.ACTION_DOWN) {
      val wasHidden = controlsHidden()
      showControls()
      if (wasHidden) return true
    }
    // Drive the controller directly so the keys never fall through to the
    // WebView (the EPG) underneath, even if focus is momentarily ambiguous.
    return playerView?.dispatchKeyEvent(event) ?: super.dispatchKeyEvent(event)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.post {
      // ±10s seek increments drive the rew/ffwd buttons. Request + manage audio
      // focus (handleAudioFocus=true): Android's audio hardening mutes playback
      // from an app that doesn't hold focus, so without this the video is silent.
      // IPTV/VOD hosts routinely 302 to a different host — and often a different
      // protocol (https → http CDN). DefaultHttpDataSource rejects cross-protocol
      // redirects by default (ERROR_CODE_IO_BAD_HTTP_STATUS: 302), so allow them,
      // and present a browser User-Agent (some hosts 403 the default one), matching
      // the Rust http_get. (Cleartext is enabled in the manifest so http targets
      // connect.)
      val httpDataSourceFactory = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
      val mediaSourceFactory =
        DefaultMediaSourceFactory(DefaultDataSource.Factory(this, httpDataSourceFactory))

      val exo = ExoPlayer.Builder(this)
        .setMediaSourceFactory(mediaSourceFactory)
        .setSeekBackIncrementMs(10_000)
        .setSeekForwardIncrementMs(10_000)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build(),
          /* handleAudioFocus= */ true,
        )
        .build()
      exo.addListener(loggingListener)
      player = exo

      // The custom controller layout (btv_player_controls) brands the chrome and
      // carries the timeline tint. PlayerView is an opaque SurfaceView; added as
      // the LAST child of the content root it sits on top of the WebView, GONE
      // until we play.
      val content = findViewById<ViewGroup>(android.R.id.content)
      val container = LayoutInflater.from(this)
        .inflate(R.layout.btv_player_view, content, false) as ViewGroup
      container.visibility = View.GONE

      val view = container.findViewById<PlayerView>(R.id.btv_player)
      view.player = exo
      // We drive show/hide ourselves so the chrome can fade (Media3's built-in
      // controller animation only applies to its default layout, not ours):
      // disable Media3's auto-hide + touch-toggle-hide, then fade the chrome's
      // alpha on show and on our own idle timer.
      view.controllerShowTimeoutMs = 0
      view.controllerHideOnTouch = false
      view.controllerAutoShow = false
      // We fully own the controls' show/hide so the chrome fades cleanly. Media3
      // keeps the controller permanently shown (it stays wired + updating); we
      // only animate the chrome layer's alpha/visibility on top of it, and never
      // call hideController() — that snapped/flashed on our custom layout. A
      // tap reveals the controls; an idle timer fades them back out.
      view.setOnTouchListener { _, ev ->
        if (ev.action == MotionEvent.ACTION_DOWN) {
          val wasHidden = controlsHidden()
          showControls()
          if (wasHidden) return@setOnTouchListener true // consume the reveal tap
        }
        false
      }
      chromeView = view.findViewById(R.id.btv_chrome)

      logoView = view.findViewById(R.id.btv_logo)
      metaView = view.findViewById(R.id.btv_meta)
      titleView = view.findViewById(R.id.btv_title)
      subtitleView = view.findViewById(R.id.btv_subtitle)
      speedButton = view.findViewById<Button>(R.id.btv_speed)?.also { btn ->
        btn.setOnClickListener { cycleSpeed() }
      }
      loadingView = container.findViewById(R.id.btv_loading)
      errorView = container.findViewById(R.id.btv_error)

      // Round the mini surface to match the React hero box; fullscreen squares
      // it off (radius 0). clipToOutline clips the SurfaceView too.
      container.outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(v: View, outline: Outline) {
          val r = if (fullscreen) 0f else miniRadius.toFloat()
          outline.setRoundRect(0, 0, v.width, v.height, r)
        }
      }
      container.clipToOutline = true

      content.addView(container)
      playerContainer = container
      playerView = view

      webView.addJavascriptInterface(Bridge(), "BlammyNativePlayer")
      Log.i(TAG, "native player ready (cross-protocol redirects on)")
    }
  }

  // Start a source and show the player in the current mode. Reused across source
  // switches — no surface recreation needed now that it's opaque and on top.
  private fun startSource(url: String, metaJson: String, startSeconds: Double) {
    val exo = player ?: return
    applyMeta(metaJson)
    resetSpeed()
    hideError()
    exo.setMediaItem(MediaItem.fromUri(url))
    // Resume (Continue Watching): seek before prepare so it starts at the saved
    // position. 0 = play from the top.
    if (startSeconds > 0) exo.seekTo((startSeconds * 1000).toLong())
    exo.playWhenReady = true
    exo.prepare()
    playerContainer?.visibility = View.VISIBLE
    applyPlayerMode()
    startProgressReports()
  }

  // Lay the player out for the current mode. Fullscreen: edge-to-edge, chrome
  // visible, focusable + focused (owns the remote). Mini: positioned over the
  // hero box, chrome hidden (video only), NOT focusable so the WebView keeps the
  // remote for EPG navigation.
  private fun applyPlayerMode() {
    val c = playerContainer ?: return
    val view = playerView ?: return
    if (fullscreen) {
      c.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      view.showController()
      chromeView?.let {
        it.animate().cancel()
        it.visibility = View.VISIBLE
        it.alpha = 1f
      }
      scheduleHideControls()
      view.isFocusable = true
      view.isFocusableInTouchMode = true
      // Take focus off the WebView so the remote drives the controller (Media3
      // auto-focuses play/pause) — otherwise norigin underneath eats the keys
      // and only Back works. Retry post-layout if the first grab doesn't land.
      webViewRef?.clearFocus()
      if (!view.requestFocus()) view.post { view.requestFocus() }
    } else {
      c.layoutParams = FrameLayout.LayoutParams(miniW, miniH).apply {
        leftMargin = miniX
        topMargin = miniY
      }
      chromeView?.let {
        it.animate().cancel()
        it.visibility = View.INVISIBLE
      }
      view.isFocusable = false
      view.isFocusableInTouchMode = false
      // Hand the remote back to the WebView (EPG nav) when leaving fullscreen.
      webViewRef?.requestFocus()
    }
    c.invalidateOutline()
    c.requestLayout()
  }

  // Back from fullscreen → mini (keep playing) + return to the EPG. Tells React
  // so it drops theater mode and re-focuses the hero.
  private fun collapseToMini() {
    if (!fullscreen) return
    fullscreen = false
    applyPlayerMode()
    webViewRef?.post {
      webViewRef?.evaluateJavascript(
        "window.dispatchEvent(new Event('blammy-native-collapse'))",
        null,
      )
    }
  }

  // Continue Watching: push position+duration to JS on a timer while playing
  // (and once on teardown), so the web layer can update the local list and drop
  // a title when it's finished.
  private val progressHandler = Handler(Looper.getMainLooper())
  private val progressRunnable = object : Runnable {
    override fun run() {
      emitProgress()
      progressHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }
  private fun startProgressReports() {
    progressHandler.removeCallbacks(progressRunnable)
    progressHandler.postDelayed(progressRunnable, PROGRESS_INTERVAL_MS)
  }
  private fun stopProgressReports() {
    progressHandler.removeCallbacks(progressRunnable)
  }
  private fun emitProgress() {
    val exo = player ?: return
    val durMs = exo.duration
    if (durMs <= 0) return // unknown (not ready / live) — nothing useful to save
    val pos = exo.currentPosition / 1000.0
    val dur = durMs / 1000.0
    webViewRef?.post {
      webViewRef?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('blammy-native-progress'," +
          "{detail:{position:$pos,duration:$dur}}))",
        null,
      )
    }
  }

  // Populate the chrome from the forwarded meta (logo URL + the three text
  // lines). Missing fields hide their view. Logo loads via Coil.
  private fun applyMeta(metaJson: String) {
    val o = try { JSONObject(metaJson) } catch (e: Exception) { null }
    val logo = o?.optString("logo").orNull()
    val line = o?.optString("line").orNull()
    val title = o?.optString("title").orNull()
    val subtitle = o?.optString("subtitle").orNull()

    metaView?.text = line ?: ""
    metaView?.visibility = if (line == null) View.GONE else View.VISIBLE
    titleView?.text = title ?: ""
    subtitleView?.text = subtitle ?: ""
    subtitleView?.visibility = if (subtitle == null) View.GONE else View.VISIBLE

    val logoImg = logoView
    if (logoImg != null) {
      if (logo == null) {
        logoImg.visibility = View.GONE
        logoImg.setImageDrawable(null)
      } else {
        logoImg.visibility = View.VISIBLE
        logoImg.load(logo)
      }
    }
  }

  private fun String?.orNull(): String? = if (isNullOrEmpty()) null else this

  // Cycle the playback speed on each tap and reflect it on the player.
  private fun cycleSpeed() {
    speedIndex = (speedIndex + 1) % SPEEDS.size
    val s = SPEEDS[speedIndex]
    player?.setPlaybackSpeed(s)
    speedButton?.text = formatSpeed(s)
  }

  private fun resetSpeed() {
    speedIndex = SPEED_DEFAULT_INDEX
    player?.setPlaybackSpeed(1f)
    speedButton?.text = formatSpeed(1f)
  }

  private fun formatSpeed(s: Float): String {
    val label = if (s == s.toLong().toFloat()) s.toLong().toString() else s.toString()
    return "$label×"
  }

  // Stop playback and hide the player, WITHOUT notifying JS — used when JS
  // itself asked to stop (React already knows it's closing).
  private fun hidePlayer() {
    emitProgress() // capture the final position before teardown
    stopProgressReports()
    player?.stop()
    player?.clearMediaItems()
    chromeView?.removeCallbacks(hideControlsRunnable)
    hideLoading()
    hideError()
    playerContainer?.visibility = View.GONE
  }

  // Controls fade. We keep Media3's controller permanently shown and fade only
  // the chrome layer (btv_chrome) on top of it — never calling hideController(),
  // which snapped/flashed on our custom layout. Hidden = alpha 0 + INVISIBLE (so
  // it takes no touches); shown = alpha 1 + VISIBLE.
  private val hideControlsRunnable = Runnable { hideControls() }

  private fun hideControls() {
    val c = chromeView ?: return
    c.removeCallbacks(hideControlsRunnable)
    c.animate().cancel()
    c.animate().alpha(0f).setDuration(FADE_MS).withEndAction {
      c.visibility = View.INVISIBLE
    }.start()
  }

  private fun controlsHidden(): Boolean = chromeView?.visibility != View.VISIBLE

  private fun showControls() {
    val c = chromeView ?: return
    c.animate().cancel()
    c.visibility = View.VISIBLE
    c.animate().alpha(1f).setDuration(FADE_MS).start()
    scheduleHideControls()
  }

  private fun scheduleHideControls() {
    val c = chromeView ?: return
    c.removeCallbacks(hideControlsRunnable)
    c.postDelayed(hideControlsRunnable, CONTROLS_TIMEOUT_MS)
  }

  // Static "loading…" with a slow opacity pulse while a source buffers.
  private var loadingPulse: ObjectAnimator? = null

  private fun showLoading() {
    val v = loadingView ?: return
    if (v.visibility == View.VISIBLE) return
    v.text = LOADING_TEXT
    v.alpha = 1f
    v.visibility = View.VISIBLE
    loadingPulse?.cancel()
    loadingPulse = ObjectAnimator.ofFloat(v, "alpha", 1f, 0.3f).apply {
      duration = 850
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      start()
    }
  }

  private fun hideLoading() {
    val v = loadingView ?: return
    loadingPulse?.cancel()
    loadingPulse = null
    v.alpha = 1f
    v.visibility = View.GONE
  }

  private fun showError() {
    hideLoading()
    errorView?.text = "Can't play this source"
    errorView?.visibility = View.VISIBLE
  }

  private fun hideError() {
    errorView?.visibility = View.GONE
  }

  // Native-initiated close (Back button): hide, then tell React to drop its
  // player route so the app returns to browsing.
  private fun closePlayer() {
    hidePlayer()
    webViewRef?.post {
      webViewRef?.evaluateJavascript(
        "window.dispatchEvent(new Event('blammy-native-close'))",
        null,
      )
    }
  }

  inner class Bridge {
    // VOD: load fullscreen.
    @JavascriptInterface
    fun load(url: String, metaJson: String, startSeconds: Double) = runOnUiThread {
      Log.i(TAG, "load($url, start=$startSeconds)")
      fullscreen = true
      hasMini = false
      startSource(url, metaJson, startSeconds)
    }

    // Live: load into the mini surface at the hero-box rect (physical px). Rect
    // args are Double (the JS bridge marshals numbers as doubles) → Int.
    @JavascriptInterface
    fun loadAt(
      url: String,
      metaJson: String,
      startSeconds: Double,
      x: Double,
      y: Double,
      w: Double,
      h: Double,
      radius: Double,
    ) = runOnUiThread {
      miniX = x.toInt(); miniY = y.toInt()
      miniW = w.toInt(); miniH = h.toInt(); miniRadius = radius.toInt()
      Log.i(TAG, "loadAt($url, mini=${miniW}x$miniH@$miniX,$miniY r=$miniRadius)")
      fullscreen = false
      hasMini = true
      startSource(url, metaJson, startSeconds)
    }

    // Keep the mini surface aligned to its (moving/resizing) web box. Ignored
    // while fullscreen, so the pre-fullscreen mini rect is preserved for a clean
    // collapse (no flash to a stale/relocated box).
    @JavascriptInterface
    fun setRect(x: Double, y: Double, w: Double, h: Double, radius: Double) = runOnUiThread {
      if (fullscreen) return@runOnUiThread
      miniX = x.toInt(); miniY = y.toInt()
      miniW = w.toInt(); miniH = h.toInt(); miniRadius = radius.toInt()
      if (playerContainer?.visibility == View.VISIBLE) applyPlayerMode()
    }

    // Tap the mini → fullscreen; (native Back collapses back to mini).
    @JavascriptInterface
    fun setFullscreen(fs: Boolean) = runOnUiThread {
      if (fullscreen == fs) return@runOnUiThread
      fullscreen = fs
      if (playerContainer?.visibility == View.VISIBLE) applyPlayerMode()
    }

    @JavascriptInterface
    fun play() = runOnUiThread { player?.play() }

    @JavascriptInterface
    fun pause() = runOnUiThread { player?.pause() }

    @JavascriptInterface
    fun stop() = runOnUiThread { hidePlayer() }

    @JavascriptInterface
    fun seek(seconds: Double) = runOnUiThread {
      player?.seekTo((seconds * 1000).toLong())
    }
  }

  private val loggingListener = object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
      val name = when (state) {
        Player.STATE_IDLE -> "IDLE"
        Player.STATE_BUFFERING -> "BUFFERING"
        Player.STATE_READY -> "READY"
        Player.STATE_ENDED -> "ENDED"
        else -> state.toString()
      }
      Log.i(TAG, "playbackState=$name")
      when (state) {
        Player.STATE_BUFFERING -> showLoading()
        Player.STATE_READY -> { hideLoading(); hideError() }
        else -> hideLoading() // IDLE/ENDED — leave any error overlay up
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      Log.e(TAG, "playerError: ${error.errorCodeName} — ${error.message}", error)
      // Surface the HTTP detail the stack trace hides: the response code, the URL
      // it died on, and the redirect target (Location) + protocol, so source
      // failures are diagnosable at a glance.
      var cause: Throwable? = error
      while (cause != null) {
        if (cause is HttpDataSource.InvalidResponseCodeException) {
          val location = cause.headerFields["Location"]?.joinToString()
          Log.e(
            TAG,
            "http ${cause.responseCode} on ${cause.dataSpec.uri} -> Location=$location",
          )
          break
        }
        cause = cause.cause
      }
      showError()
    }

    override fun onVideoSizeChanged(videoSize: VideoSize) {
      Log.i(TAG, "videoSize=${videoSize.width}x${videoSize.height}")
    }

    override fun onRenderedFirstFrame() {
      Log.i(TAG, "renderedFirstFrame — video is on the surface ✅")
    }
  }

  override fun onDestroy() {
    player?.release()
    player = null
    super.onDestroy()
  }

  companion object {
    private const val TAG = "BlammyPlayer"
    private const val LOADING_TEXT = "loading…"
    private const val FADE_MS = 200L
    private const val CONTROLS_TIMEOUT_MS = 3500L
    private const val PROGRESS_INTERVAL_MS = 5000L // Continue Watching ticks
    private val SPEEDS = floatArrayOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    private const val SPEED_DEFAULT_INDEX = 2 // 1.0×
  }
}
