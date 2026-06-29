// On-device setup server for the "configure from another device" flow.
//
// The TV starts a tiny HTTP server on its LAN address and shows a URL + QR. You
// open it on a phone/laptop on the same WiFi, fill in your provider details, and
// they're handed straight to the app — no typing on the remote. Credentials only
// ever traverse the local network (never the internet). A short token, shown on
// the TV, gates writes so a random device on the LAN can't push config.
//
// The submitted JSON is forwarded to the WebView as a `config-received` event;
// the web layer writes it to localStorage and reloads. The form currently covers
// AIOStreams + Xtream; M3U and Stalker/MAG sources slot in later (see FORM_HTML).

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Start the setup server. Returns `{ ip, port, token }` for the TV to display.
#[tauri::command]
pub fn config_server_start(app: AppHandle) -> Result<serde_json::Value, String> {
    // Replace any previous instance.
    RUNNING.store(false, Ordering::SeqCst);

    let server = tiny_http::Server::http("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("no TCP port")?
        .port();
    let ip = local_ip_address::local_ip()
        .map_err(|e| e.to_string())?
        .to_string();
    let token = gen_token();

    RUNNING.store(true, Ordering::SeqCst);
    let server = Arc::new(server);
    let token_for_thread = token.clone();
    std::thread::spawn(move || {
        while RUNNING.load(Ordering::SeqCst) {
            match server.recv_timeout(Duration::from_millis(300)) {
                Ok(Some(req)) => handle(req, &token_for_thread, &app),
                Ok(None) => continue, // timeout — re-check the run flag
                Err(_) => break,
            }
        }
    });

    Ok(serde_json::json!({ "ip": ip, "port": port, "token": token }))
}

/// Stop the setup server (on success or when leaving the setup screen).
#[tauri::command]
pub fn config_server_stop() {
    RUNNING.store(false, Ordering::SeqCst);
}

fn handle(mut req: tiny_http::Request, token: &str, app: &AppHandle) {
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/");
    let query = url.splitn(2, '?').nth(1).unwrap_or("");
    let token_ok = query
        .split('&')
        .any(|kv| kv == format!("t={token}"));
    let is_post = *req.method() == tiny_http::Method::Post;

    if is_post && path == "/config" {
        if !token_ok {
            let _ = req.respond(
                tiny_http::Response::from_string("forbidden").with_status_code(403u16),
            );
            return;
        }
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let _ = app.emit("config-received", body);
        let _ = req.respond(html(DONE_HTML));
        // One successful handoff is all we need.
        RUNNING.store(false, Ordering::SeqCst);
        return;
    }

    // Any GET: serve the form when the token matches, else a gate page where you
    // can type the code (so the QR isn't the only way in).
    if token_ok {
        let _ = req.respond(html(&form_html(token)));
    } else {
        let attempted = query.split('&').any(|kv| kv.starts_with("t="));
        let _ = req.respond(html(&gate_html(attempted)));
    }
}

fn html(body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let header = tiny_http::Header::from_bytes(
        &b"Content-Type"[..],
        &b"text/html; charset=utf-8"[..],
    )
    .expect("static header");
    tiny_http::Response::from_string(body).with_header(header)
}

fn form_html(token: &str) -> String {
    FORM_HTML.replace("__TOKEN__", token)
}

fn gate_html(attempted: bool) -> String {
    let msg = if attempted {
        r#"<p class="err">That code didn't match — check the TV and try again.</p>"#
    } else {
        ""
    };
    GATE_HTML.replace("__MSG__", msg)
}

/// 6 chars from an unambiguous alphabet, seeded from the clock (no rand dep).
fn gen_token() -> String {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut x = seed ^ 0x9E37_79B9_7F4A_7C15;
    let mut out = String::with_capacity(6);
    for _ in 0..6 {
        // xorshift64
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.push(ALPHABET[(x as usize) % ALPHABET.len()] as char);
    }
    out
}

// Shown when there's no valid token in the URL. `__MSG__` is an optional
// "didn't match" line. Entering the code navigates to /?t=<code>, which serves
// the form when it matches.
const GATE_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BlammyTV setup</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0b0b0e;color:#eee;margin:0;padding:24px;display:flex;justify-content:center}
  .wrap{width:100%;max-width:420px;text-align:center}
  h1{font-size:22px;margin:24px 0 4px}
  p.sub{opacity:.65;margin:0 0 20px;font-size:14px}
  p.err{color:#ff6b6b;font-size:14px;margin:0 0 14px}
  input{width:100%;padding:14px;border-radius:10px;border:1px solid #2a2a30;background:#151519;color:#fff;font-size:22px;text-align:center;letter-spacing:6px;text-transform:uppercase}
  button{width:100%;padding:13px;border:none;border-radius:10px;background:#c22727;color:#fff;font-size:16px;font-weight:600;margin-top:12px;cursor:pointer}
</style></head>
<body><div class="wrap">
  <h1>Enter your TV code</h1>
  <p class="sub">Type the code shown on your TV to continue.</p>
  __MSG__
  <form id="f">
    <input id="code" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="6" placeholder="ABC123" autofocus>
    <button type="submit">Continue</button>
  </form>
</div>
<script>
  var f=document.getElementById('f'),code=document.getElementById('code');
  f.addEventListener('submit',function(e){e.preventDefault();var c=code.value.trim().toUpperCase();if(c)location.href='/?t='+encodeURIComponent(c);});
</script>
</body></html>"#;

const DONE_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sent</title></head>
<body style="font-family:system-ui;background:#0b0b0e;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px">
<div><h2 style="margin:0 0 8px">Sent to your TV ✓</h2><p style="opacity:.7">You can close this tab.</p></div>
</body></html>"#;

// Self-contained setup form. `__TOKEN__` is substituted at serve time. To add a
// new source type later (M3U, Stalker/MAG), add a <fieldset> and include it in
// the `payload` object — the web side keys off the JSON shape.
const FORM_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BlammyTV setup</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0b0b0e;color:#eee;margin:0;padding:24px;display:flex;justify-content:center}
  .wrap{width:100%;max-width:480px}
  h1{font-size:22px;margin:0 0 4px}
  p.sub{opacity:.65;margin:0 0 20px;font-size:14px}
  fieldset{border:1px solid #2a2a30;border-radius:12px;padding:16px;margin:0 0 16px}
  legend{padding:0 6px;font-weight:600;font-size:14px}
  label{display:block;font-size:13px;opacity:.8;margin:10px 0 4px}
  input{width:100%;padding:11px 12px;border-radius:8px;border:1px solid #2a2a30;background:#151519;color:#fff;font-size:15px}
  button{width:100%;padding:13px;border:none;border-radius:10px;background:#c22727;color:#fff;font-size:16px;font-weight:600;margin-top:6px;cursor:pointer}
  button:disabled{opacity:.5}
  .msg{margin-top:12px;font-size:14px;min-height:18px}
  .ok{color:#5ad17a}.err{color:#ff6b6b}
</style></head>
<body><div class="wrap">
  <h1>Set up BlammyTV</h1>
  <p class="sub">Paste your provider details — they go straight to your TV over your network.</p>
  <form id="f">
    <fieldset>
      <legend>AIOStreams</legend>
      <label>Manifest URL</label>
      <input id="aio" type="url" placeholder="https://your-aiostreams/manifest.json" autocomplete="off">
    </fieldset>
    <fieldset>
      <legend>Live TV (Xtream) — optional</legend>
      <label>Server URL</label>
      <input id="xurl" type="url" placeholder="http://host:port" autocomplete="off">
      <label>Username</label>
      <input id="xuser" autocomplete="off">
      <label>Password</label>
      <input id="xpass" type="password" autocomplete="off">
    </fieldset>
    <button id="go" type="submit">Send to TV</button>
    <div class="msg" id="m"></div>
  </form>
</div>
<script>
  var f=document.getElementById('f'),m=document.getElementById('m'),go=document.getElementById('go');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var aio=document.getElementById('aio').value.trim();
    var xurl=document.getElementById('xurl').value.trim();
    var payload={aioUrl:aio};
    if(xurl){payload.xtream={url:xurl,username:document.getElementById('xuser').value.trim(),password:document.getElementById('xpass').value};}
    if(!aio && !xurl){m.className='msg err';m.textContent='Enter at least one provider.';return;}
    go.disabled=true;m.className='msg';m.textContent='Sending…';
    fetch('/config?t=__TOKEN__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){if(!r.ok)throw new Error(r.status);m.className='msg ok';m.textContent='Sent to your TV ✓ — you can close this tab.';})
      .catch(function(){go.disabled=false;m.className='msg err';m.textContent='Could not reach the TV. Same WiFi?';});
  });
</script>
</body></html>"#;
