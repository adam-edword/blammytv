package com.blammytv.app

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.SurfaceView
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
  private var surfaceView: SurfaceView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1: a native ExoPlayer renders into a SurfaceView behind the transparent
  // WebView. SurfaceView (not TextureView) is deliberate — it punches a hole at
  // the system-compositor level, so the video stays visible across source
  // switches; TextureView only re-composited through the transparent WebView on
  // a full page reload. Driven from JS via window.BlammyNativePlayer.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val content = findViewById<ViewGroup>(android.R.id.content)
      // Bottom child of the content frame: its surface sits behind the window,
      // and the transparent WebView on top shows it through.
      val sv = SurfaceView(this)
      content.addView(
        sv,
        0,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      surfaceView = sv

      val exo = ExoPlayer.Builder(this).build()
      exo.setVideoSurfaceView(sv)
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
