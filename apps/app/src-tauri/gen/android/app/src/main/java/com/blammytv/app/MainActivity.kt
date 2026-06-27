package com.blammytv.app

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer

class MainActivity : TauriActivity() {
  private var player: ExoPlayer? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1 playback spike — a TextureView sits behind the transparent WebView and
  // ExoPlayer renders a hardcoded test stream into it. Verbose logging under the
  // "BlammyPlayer" tag so `adb logcat -s BlammyPlayer:*` shows exactly what the
  // player does (state, video size, first frame) or the precise error code.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val content = findViewById<ViewGroup>(android.R.id.content)
      val textureView = TextureView(this)
      content.addView(
        textureView,
        0,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      Log.i(TAG, "onWebViewCreate: building ExoPlayer + TextureView")
      val exo = ExoPlayer.Builder(this).build()
      exo.setVideoTextureView(textureView)
      exo.addListener(
        object : Player.Listener {
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
        },
      )
      exo.setMediaItem(
        MediaItem.fromUri(
          "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        ),
      )
      exo.repeatMode = Player.REPEAT_MODE_ALL
      exo.playWhenReady = true
      exo.prepare()
      player = exo
      Log.i(TAG, "prepare() called")
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
