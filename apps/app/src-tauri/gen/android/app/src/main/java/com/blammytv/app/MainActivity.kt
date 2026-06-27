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

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1: ExoPlayer renders into a TextureView behind the transparent WebView.
  // Key detail: TextureView is opaque by default, which conflicts with a
  // transparent WebView composited on top (the video only re-appeared on a full
  // page reload). setOpaque(false) makes it composite live with the overlay, so
  // the video shows and survives source switches. Driven from JS via
  // window.BlammyNativePlayer.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val content = findViewById<ViewGroup>(android.R.id.content)
      val tv = TextureView(this)
      tv.isOpaque = false
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
