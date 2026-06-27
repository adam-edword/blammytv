package com.blammytv.app

import android.graphics.Color
import android.os.Bundle
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

class MainActivity : TauriActivity() {
  private var player: ExoPlayer? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1 playback spike — a TextureView sits behind the transparent WebView and
  // ExoPlayer renders a hardcoded test stream into it, proving real video
  // composites under the React UI. Next step is a Tauri plugin so JS can drive
  // load/play/pause/seek with the app's real stream URLs.
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
      val exo = ExoPlayer.Builder(this).build()
      exo.setVideoTextureView(textureView)
      exo.setMediaItem(
        MediaItem.fromUri(
          "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        ),
      )
      exo.repeatMode = Player.REPEAT_MODE_ALL
      exo.playWhenReady = true
      exo.prepare()
      player = exo
    }
  }

  override fun onDestroy() {
    player?.release()
    player = null
    super.onDestroy()
  }
}
