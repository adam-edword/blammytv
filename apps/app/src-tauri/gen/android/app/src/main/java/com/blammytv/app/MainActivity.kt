package com.blammytv.app

import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

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
  private var playerView: PlayerView? = null
  private var webViewRef: WebView? = null

  // Back closes the player. wry handles Back through the OnBackPressedDispatcher
  // (for WebView history), which bypasses the old onBackPressed() override — so
  // we register our own callback, enabled ONLY while the player is showing.
  // Added after wry's (in onWebViewCreate) so it has priority: one Back closes
  // the player and consumes the event before web-history navigation sees it.
  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      closePlayer()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    // Registered after wry's back handler → higher priority while enabled.
    onBackPressedDispatcher.addCallback(this, backCallback)
    webView.post {
      val exo = ExoPlayer.Builder(this).build()
      exo.addListener(loggingListener)
      player = exo

      // PlayerView defaults to a SurfaceView (opaque). Added as the LAST child
      // of the content root, it sits on top of the WebView; GONE until we play.
      val view = PlayerView(this)
      view.player = exo
      view.useController = true
      view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
      view.visibility = View.GONE

      val content = findViewById<ViewGroup>(android.R.id.content)
      content.addView(
        view,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      playerView = view

      webView.addJavascriptInterface(Bridge(), "BlammyNativePlayer")
      Log.i(TAG, "native player ready (fullscreen PlayerView on top)")
    }
  }

  // Show the player fullscreen and start the source. Reused across source
  // switches — no surface recreation needed now that it's opaque and on top.
  private fun showPlayer(url: String) {
    val exo = player ?: return
    val view = playerView ?: return
    exo.setMediaItem(MediaItem.fromUri(url))
    exo.playWhenReady = true
    exo.prepare()
    view.visibility = View.VISIBLE
    view.requestFocus()
    backCallback.isEnabled = true
  }

  // Stop playback and hide the player, WITHOUT notifying JS — used when JS
  // itself asked to stop (React already knows it's closing).
  private fun hidePlayer() {
    player?.stop()
    player?.clearMediaItems()
    playerView?.visibility = View.GONE
    backCallback.isEnabled = false
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
    fun load(url: String) = runOnUiThread {
      Log.i(TAG, "load($url)")
      showPlayer(url)
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
    }

    override fun onPlayerError(error: PlaybackException) {
      Log.e(TAG, "playerError: ${error.errorCodeName} — ${error.message}", error)
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
  }
}
