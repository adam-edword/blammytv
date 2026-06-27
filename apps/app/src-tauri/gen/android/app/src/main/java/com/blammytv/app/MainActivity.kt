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

  // M1: ExoPlayer renders into a plain opaque TextureView behind the transparent
  // WebView. Measured behaviour: a FRESH TextureView composites (video shows),
  // but reusing one across a source switch stayed black until a page reload. So
  // playUrl() recreates the TextureView on every load — each source gets a fresh
  // composite, the state we know works. Driven from JS via window.BlammyNativePlayer.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val exo = ExoPlayer.Builder(this).build()
      exo.addListener(loggingListener)
      exo.repeatMode = Player.REPEAT_MODE_ALL
      player = exo

      webView.addJavascriptInterface(Bridge(), "BlammyNativePlayer")
      Log.i(TAG, "native player bridge ready (window.BlammyNativePlayer)")

      // TEMP: auto-play on launch so compositing can be eyeballed without the
      // JS console. Remove once the player is wired through the app UI.
      playUrl(BUNNY_URL)
    }
  }

  // Recreate the TextureView each load → fresh surface → fresh composite.
  private fun playUrl(url: String) {
    val exo = player ?: return
    val content = findViewById<ViewGroup>(android.R.id.content)
    textureView?.let { content.removeView(it) }
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
    exo.setVideoTextureView(tv)
    exo.setMediaItem(MediaItem.fromUri(url))
    exo.playWhenReady = true
    exo.prepare()
  }

  inner class Bridge {
    @JavascriptInterface
    fun load(url: String) = runOnUiThread {
      Log.i(TAG, "load($url)")
      playUrl(url)
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
    private const val BUNNY_URL =
      "https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4"
  }
}
