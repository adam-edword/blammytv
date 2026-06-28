package com.blammytv.app

import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
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
  private var loadingFrame = 0

  // Back closes the player. wry consumes the Back key INSIDE the WebView
  // (webView.goBack()) before the OnBackPressedDispatcher or onBackPressed()
  // ever run — so neither could intercept it, and Back just walked the React
  // app's history underneath the still-visible player. dispatchKeyEvent is the
  // Activity's earliest key hook, before the event reaches the WebView: while
  // the player is showing we consume Back here and close the player.
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_BACK &&
      playerContainer?.visibility == View.VISIBLE
    ) {
      if (event.action == KeyEvent.ACTION_UP) closePlayer()
      return true // consume both DOWN and UP so the WebView never navigates
    }
    // Any remote key while the controls are up resets their idle fade-out timer.
    if (event.action == KeyEvent.ACTION_DOWN &&
      playerView?.isControllerFullyVisible == true
    ) {
      scheduleHideControls()
    }
    return super.dispatchKeyEvent(event)
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
      val exo = ExoPlayer.Builder(this)
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
      view.setControllerVisibilityListener(
        PlayerView.ControllerVisibilityListener { visibility ->
          if (visibility == View.VISIBLE) onControllerShown()
        },
      )
      view.setOnTouchListener { _, ev ->
        if (ev.action == MotionEvent.ACTION_DOWN && view.isControllerFullyVisible) {
          scheduleHideControls()
        }
        false // don't consume — let the PlayerView/buttons handle the touch
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

      content.addView(container)
      playerContainer = container
      playerView = view

      webView.addJavascriptInterface(Bridge(), "BlammyNativePlayer")
      Log.i(TAG, "native player ready (custom BlammyTV chrome, on top)")
    }
  }

  // Show the player fullscreen and start the source. Reused across source
  // switches — no surface recreation needed now that it's opaque and on top.
  private fun showPlayer(url: String, metaJson: String) {
    val exo = player ?: return
    applyMeta(metaJson)
    resetSpeed()
    hideError()
    exo.setMediaItem(MediaItem.fromUri(url))
    exo.playWhenReady = true
    exo.prepare()
    playerContainer?.visibility = View.VISIBLE
    playerView?.requestFocus()
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
    player?.stop()
    player?.clearMediaItems()
    chromeView?.removeCallbacks(hideControlsRunnable)
    hideLoading()
    hideError()
    playerContainer?.visibility = View.GONE
  }

  // Chrome (controls) fade. Media3 still decides WHEN to show the controller
  // (tap/key/auto-show); we intercept that to fade the chrome in, and run our
  // own idle timer to fade it back out and hide the controller.
  private val hideControlsRunnable = Runnable {
    val c = chromeView ?: return@Runnable
    c.animate().cancel()
    c.animate().alpha(0f).setDuration(FADE_MS).withEndAction {
      playerView?.hideController()
    }.start()
  }

  private fun onControllerShown() {
    val c = chromeView ?: return
    c.animate().cancel()
    c.alpha = 0f
    c.animate().alpha(1f).setDuration(FADE_MS).start()
    scheduleHideControls()
  }

  private fun scheduleHideControls() {
    val c = chromeView ?: return
    c.removeCallbacks(hideControlsRunnable)
    c.postDelayed(hideControlsRunnable, CONTROLS_TIMEOUT_MS)
  }

  // "loading" wordmark with a per-character scramble that settles left-to-right
  // (the native echo of the web build's slot-text roll). One pass per buffer.
  private val loadingRunnable = object : Runnable {
    override fun run() {
      val v = loadingView ?: return
      val settled = loadingFrame / 2
      if (settled >= LOADING_TEXT.length) {
        v.text = LOADING_TEXT
        return
      }
      val sb = StringBuilder()
      for (i in LOADING_TEXT.indices) {
        sb.append(if (i < settled) LOADING_TEXT[i] else ('a'..'z').random())
      }
      v.text = sb
      loadingFrame++
      v.postDelayed(this, 70)
    }
  }

  private fun showLoading() {
    val v = loadingView ?: return
    if (v.visibility == View.VISIBLE) return
    v.visibility = View.VISIBLE
    loadingFrame = 0
    v.removeCallbacks(loadingRunnable)
    v.post(loadingRunnable)
  }

  private fun hideLoading() {
    val v = loadingView ?: return
    v.removeCallbacks(loadingRunnable)
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
    @JavascriptInterface
    fun load(url: String, metaJson: String) = runOnUiThread {
      Log.i(TAG, "load($url)")
      showPlayer(url, metaJson)
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
    private const val LOADING_TEXT = "loading"
    private const val FADE_MS = 200L
    private const val CONTROLS_TIMEOUT_MS = 3500L
    private val SPEEDS = floatArrayOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    private const val SPEED_DEFAULT_INDEX = 2 // 1.0×
  }
}
