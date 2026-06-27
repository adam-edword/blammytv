package com.blammytv.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // M1 compositing spike — prove a native view can render BEHIND the Tauri
  // WebView (the Android analog of the Windows DirectComposition trick). Make the
  // WebView transparent, then insert a solid-red view as the bottom child of the
  // content frame. With the page background also transparent on Android (see
  // styles.css `.is-android`), the red shows through wherever the UI doesn't
  // paint. If you see red around the welcome card, native compositing works and
  // we swap this red view for a TextureView + ExoPlayer.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.post {
      val content = findViewById<ViewGroup>(android.R.id.content)
      val bg = View(this).apply { setBackgroundColor(Color.RED) }
      content.addView(
        bg,
        0,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
    }
  }
}
