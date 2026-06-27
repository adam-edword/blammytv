package com.blammytv.app

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer

class MainActivity : TauriActivity() {
  private var player: ExoPlayer? = null
  private var textureView: TextureView? = null
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1: ExoPlayer renders into a plain (opaque) TextureView behind the
  // transparent WebView — the config confirmed to show video. A fresh composite
  // shows the frame; a *source switch* otherwise stayed black until a page
  // reload, so onRenderedFirstFrame nudges the WebView to re-composite. Driven
  // from JS via window.BlammyNativePlayer.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val content = findViewById<ViewGroup>(android.R.id.content)
      val tv = TextureView(this)
      content.addView(
        tv,
        0,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      textureView = tv

      val exo = ExoPlayer.Builder(this).build()
      exo.setVideoTextureView(tv)
      exo.addListener(loggingListener)
      exo.repeatMode = Player.REPEAT_MODE_ALL
      player = exo

      webView.addJavascriptInterface(Bridge(), "BlammyNativePlayer")
      Log.i(TAG, "native player bridge ready (window.BlammyNativePlayer)")

      // TEMP probe (no console needed): auto-play a clip, then auto-switch after
      // 6s so we can eyeball whether the onRenderedFirstFrame re-composite keeps
      // the video visible across a switch. Remove once confirmed.
      exo.setMediaItem(MediaItem.fromUri(BUNNY_URL))
      exo.playWhenReady = true
      exo.prepare()
      tv.postDelayed({
        Log.i(TAG, "auto-switch: reloading source to test re-composite")
        exo.setMediaItem(MediaItem.fromUri(BUNNY_URL))
        exo.prepare()
      }, 6000)
    }
  }

  inner class Bridge {
    @JavascriptInterface
    fun load(url: String) = runOnUiThread {
      Log.i(TAG, "load($url)")
      player?.apply {
        setMediaItem(MediaItem.fromUri(url))
        playWhenReady = true
        prepare()
      }
    }

    @JavascriptInterface
    fun play() = runOnUiThread { player?.play() }

    @JavascriptInterface
    fun pause() = runOnUiThread { player?.pause() }

    @JavascriptInterface
    fun stop() = runOnUiThread { player?.stop() }

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
      // A fresh composite shows the frame, but after a source switch the WebView
      // kept showing black until a reload. Nudge it to re-composite its
      // transparent overlay over the new frame (a cheap repaint, analogous to
      // what the reload was doing). Testing whether this is enough.
      webViewRef?.evaluateJavascript(
        "document.body.style.opacity='0.999';" +
          "requestAnimationFrame(function(){document.body.style.opacity='';});",
        null,
      )
    }
  }

  override fun onDestroy() {
    player?.release()
    player = null
    super.onDestroy()
  }

  companion object {
    private const val TAG = "BlammyPlayer"
    private const val BUNNY_URL =
      "https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4"
  }
}
