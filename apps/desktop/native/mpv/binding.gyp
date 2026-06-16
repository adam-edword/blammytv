{
  "targets": [
    {
      "target_name": "mpv_addon",
      "sources": [ "src/mpv_addon.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "vendor/include"
      ],
      "defines": [ "NAPI_VERSION=8" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        [ "OS=='win'", {
          "libraries": [ "<(module_root_dir)/vendor/lib/mpv.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17" ]
            }
          }
        } ],
        [ "OS!='win'", {
          "libraries": [ "-lmpv" ],
          "cflags_cc": [ "-std=c++17" ]
        } ]
      ]
    }
  ]
}
