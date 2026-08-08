# Code signing BlammyTV for Windows

Written 2026-08-07, after Defender removed the app from users' machines
(`Trojan:Win32/Bearfoos.A!ml` — see RELEASING.md). Every price and rule here
was checked against a primary source on that date; the landscape changed
materially in 2023, 2024 and again in January 2026, so **distrust any guide
older than this one**, including Tauri's own docs (noted below).

## Read this first: signing is not the Defender fix

The honest version, because it changes what you should spend money on.

`!ml` means Defender's **machine-learning classifier** flagged the file, not
that it matched a known-malware signature. Defender's ML does **not** exempt a
binary because it is Authenticode-signed — there are documented cases of
EV-signed installers still being flagged. Signing adds publisher identity and
reputation signals that reduce false positives *over time*; it is not a switch
that turns this off.

So treat these as two workstreams:

| Problem | Actual fix |
|---|---|
| Defender removing the app (`Bearfoos.A!ml`) | The `app.exe` → `BlammyTV.exe` rename (shipped v0.8.167); a WDSI submission only if it recurs |
| SmartScreen "unrecognised app" warning on install | A certificate — but reputation still accrues over weeks |

**If it comes back, the free thing clears it:** submit at
<https://www.microsoft.com/wdsi/filesubmission> as *Software developer →
Incorrectly detected*. Turnaround is typically days and the withdrawal is
fleet-wide.

**It is deliberately NOT a per-release step** (decided 2026-08-08). Doing it
for every build is a tax on shipping, and a checklist item that gets skipped
is worse than one that was never written. The `app.exe` → `BlammyTV.exe`
rename may have settled this on its own — treat a recurrence as the trigger,
and as the evidence that makes the certificate below worth buying.

### So: buy nothing yet

The sequence that spends the least money is also the correct one:

1. Ship the `BlammyTV.exe` rename (done, v0.8.167).
2. Watch whether the detection returns. Do nothing unless it does.
3. If it returns: one WDSI submission for that build, and start treating the
   certificate as justified rather than speculative.
4. Buy a certificate when you decide the SmartScreen *install* warning is
   worth $120/yr — and note it will not vanish on day one even then.

Step 4 is a genuinely optional, separable purchase. Nothing above it depends
on it.

## What NOT to buy

- **Do not buy EV.** Microsoft removed instant SmartScreen reputation for EV
  in 2024; EV-signed files now build reputation exactly like OV. It is
  ~$400+/yr and buys nothing here (its remaining use is kernel drivers).
  **Tauri's own v2 signing docs are stale on this** — they still claim EV
  gives "immediate reputation with Microsoft SmartScreen and won't show any
  warnings". Microsoft's current guidance contradicts that directly. Use the
  Tauri docs for `signCommand` wiring only.
- **Do not buy an OV cert on a physical USB token.** ~$150–300/yr plus token
  and shipping fees, and you must physically hold the token to sign, which
  kills unattended builds.
- **Nothing clears SmartScreen on day one.** Not EV, not anything. Microsoft's
  own wording: "several weeks and hundreds of clean installs from a wide
  audience", with no published threshold. Sign every build with the *same*
  cert and never churn CAs — switching resets accumulated reputation.

Since June 2023 no CA will issue an exportable `.pfx` at all: keys must live
on FIPS-140 hardware or in a CA-operated cloud HSM. Any tutorial that says
"put your .pfx in a GitHub secret" predates that and cannot be followed.

## Recommended: Azure Artifact Signing — $9.99/month

Formerly Azure Trusted Signing; renamed and **generally available since
12 January 2026**. Microsoft holds the key, you call an API, certificates are
short-lived and rotated for you, and it plugs into Tauri's `signCommand`.

**Check eligibility before doing anything else:**

- Individual (non-company) enrollment is **United States and Canada only**.
- Organizations: US, Canada, EU, UK, Australia, NZ, Japan, South Korea,
  Singapore, Switzerland, Norway, Israel.
- **It does not work on free, trial or sponsored Azure subscriptions.** Use
  pay-as-you-go from the start.
- Your Azure billing account's Account Type must be **Individual** for
  individual validation, and the legal name and address must exactly match
  your ID.

If you are outside US/Canada and have no company, skip to *Fallbacks*.

### Steps

1. **Azure subscription.** Create a pay-as-you-go subscription (not free
   tier). Set the billing account type to Individual.
2. **Register the provider.** In the portal, Subscriptions → your
   subscription → Resource providers → register `Microsoft.CodeSigning`.
3. **Create the account.** Search "Artifact Signing" (may still appear as
   "Trusted Signing") → create an account. Pick the **Basic** tier: $9.99/mo,
   5,000 signatures/month. Note the region endpoint, e.g.
   `https://eus.codesigning.azure.net`.
4. **Identity validation.** Start it immediately — it is the long pole at
   **1–20 business days**. Government photo ID plus a biometric selfie check
   through Microsoft Authenticator. Everything else here takes minutes.
   - If assigning the *Artifact Signing Identity Verifier* role pushes you
     toward a Microsoft Entra ID P2 purchase, **you are in the wrong blade**.
     The role is plain Azure RBAC; assign it at the Artifact Signing account
     scope. Do not buy Entra P2.
5. **Certificate profile.** Once validated, create a Public Trust certificate
   profile. Note its name.
6. **Service principal.** Create an Entra app registration with a client
   secret and give it the *Artifact Signing Certificate Profile Signer* role
   on the account. You will use `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   `AZURE_TENANT_ID`.
7. **Install the signer:** `cargo install artifact-signing-cli`
   (it was `trusted-signing-cli` before the rename — old guides say that).
8. **Wire it into the build.** In `apps/app/src-tauri/tauri.windows.conf.json`,
   which already exists and already carries a `bundle` block:

   ```json
   {
     "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
     "bundle": {
       "resources": ["libmpv-2.dll"],
       "windows": {
         "signCommand": {
           "cmd": "artifact-signing-cli",
           "args": [
             "-e", "https://eus.codesigning.azure.net",
             "-a", "<your-account>",
             "-c", "<your-cert-profile>",
             "-d", "BlammyTV",
             "%1"
           ]
         }
       }
     }
   }
   ```

   **`%1` must be its own array element.** Substitution is by exact string
   equality per argument — `--file=%1` or `-i %1` will pass the literal `%1`
   through and sign nothing. Use the object form (not the string form)
   whenever any argument could contain a space. Keep the command simple: no
   `cmd /c`, no PowerShell wrapper, no pipes — the *uninstaller's* copy of
   this command is embedded into the `.nsi` as a debug-formatted string and
   re-escaped, so anything clever behaves differently there than everywhere
   else.

9. **Set the credentials in the same shell as the build**, alongside the
   existing `TAURI_SIGNING_*` updater vars (`scripts/release.ps1`):

   ```powershell
   $env:AZURE_CLIENT_ID     = "..."
   $env:AZURE_CLIENT_SECRET = "..."
   $env:AZURE_TENANT_ID     = "..."
   ```

10. **Build as normal.** `pnpm tauri build`. Nothing about the release flow
    changes — see the ordering note below.

### Two things to verify on the first signed build

**Signing actually happened.** A misconfigured signing block **fails
silently**: the build succeeds, produces an *unsigned* installer, and still
writes a perfectly valid `.sig` (that is minisign, a different thing). Watch
for one `Signing <path> with a custom signing command` line per artifact in
the build log. Zero such lines means the config was not picked up. Then:

```powershell
$s = Get-AuthenticodeSignature .\BlammyTV_<version>_x64-setup.exe
$s.Status; $s.SignerCertificate.Subject
```

**Timestamping happened.** Artifact Signing issues ~72-hour certificates, so
an un-timestamped signature goes invalid within days — which would look
exactly like the problem you are trying to fix. `signCommand` bypasses Tauri's
own `timestampUrl` config, so the timestamp is the signing tool's job:

```powershell
$s.TimeStamperCertificate      # must NOT be null
```

### Ordering: this does not break the updater

Verified in the tauri-cli source, because getting it wrong ships a release
every client rejects. `tauri_bundler::bundle_project()` does all Authenticode
signing, and `sign_updaters()` runs **after** it, over the already-signed
installer bytes:

```rust
let bundles = tauri_bundler::bundle_project(&settings)?;
sign_updaters(settings, bundles, ci)?;
```

So `pnpm tauri build` stays the single command and `scripts/release.ps1` needs
no reordering. **Never hand-sign the installer with `signtool` after the
build** — that rewrites the bytes the `.sig` already covers, and every install
rejects the update.

One signCommand covers the app exe, the NSIS installer, the uninstaller,
bundled resource DLLs and NSIS plugin DLLs — expect ~6+ signing calls per
build, comfortably inside the 5,000/month quota. Note `libmpv-2.dll` gets
signed too, which is fine.

You also still need the **Windows SDK's `signtool.exe` on PATH**: the bundler
calls `signtool verify` to decide whether a resource is already signed, even
when a custom `signCommand` is configured. Set `TAURI_WINDOWS_SIGNTOOL_PATH`
if it lives somewhere unusual.

## Why it is a subscription now (and why that is cheaper, not dearer)

The recurring cost is not new. OV code-signing certificates have always been
an annual purchase, historically $150–300/yr. What changed is *how* you hold
the key.

Since **June 2023** the CA/Browser Forum requires code-signing private keys to
live on FIPS 140-2 Level 2 (or CC EAL4+) hardware. No CA will issue a
downloadable `.pfx` any more. So you have exactly two shapes available:

- a **physical USB token** posted to you — cert (~$150–300/yr) plus a token
  fee and shipping, and you must be holding it to sign; or
- **someone else's HSM**, billed monthly — which is what "subscription" means
  here. You are renting the hardware you would otherwise have to buy.

Azure Artifact Signing at $9.99/month is **$120/yr, all in** — cheaper than a
traditional OV cert *and* it removes the token. It is the cheapest real path,
not a premium one. It is also cancellable monthly, unlike a 1–3 year cert.

And from **February 2026** the maximum validity of any code-signing
certificate is ~460 days, so even a multi-year purchase now forces mid-term
reissues. That tilts things further toward a managed service, which rotates
certificates for you.

### The free options are closed for this project

Both require an open-source licence, and BlammyTV has **no LICENSE file and no
`license` field in package.json** — which means all rights reserved by
default:

- **SignPath Foundation** — free, but needs an OSI licence and *no proprietary
  components anywhere*.
- **Certum Open Source Code Signing** — ~$50/yr, explicitly for software
  released under an open-source licence.

If BlammyTV were ever released under an OSI licence, SignPath becomes the
$0 answer and Certum the ~$50 one. That is a licensing decision, not a signing
decision, and it should not be made to save $120.

## Fallbacks, if Artifact Signing is closed to you

- **Certum Open Source Code Signing** — ~$50/yr, explicitly individual-
  friendly, publicly trusted. Buy the **SimplySign (cloud)** variant, not the
  physical card, so unattended signing stays possible. Requires the software
  to be under an open-source licence. Prices here could not be confirmed
  against Certum directly (their store blocks this environment), so treat the
  figure as indicative and check before buying.
- **SignPath Foundation** — free for qualifying open-source projects, but
  strict: OSI licence, **no proprietary components anywhere**. BlammyTV bundles
  `libmpv-2.dll`, which likely disqualifies it — worth an application in
  parallel rather than instead, since review takes weeks. Note the certificate
  is issued to *SignPath Foundation*, not to you, so the publisher name shown
  to users is theirs.
- **SSL.com IV + eSigner** — the individual-validation analogue of OV with
  cloud signing; cert plus ~$20/month per credential. Only worth it if the
  above are all closed.

## Do not change `publisher` casually

Tempting, since an empty publisher looks like a trust signal worth filling in.
**It moves a registry key.** The NSIS installer defines:

```nsis
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
```

and reads the existing install's directory out of `MANUPRODUCTKEY` when
upgrading. `bundle.publisher` feeds `MANUFACTURER`, and it currently defaults
to the identifier's second element (`blammytv`). Changing it makes the
installer lose track of where the previous install lives. If it ever needs to
change, do it in a release that changes nothing else risky, and test an
in-place upgrade from the previous version first.

`bundle.copyright`, `shortDescription` and `category` are safe — they only
populate version-info strings — and were set in v0.8.166 because an empty
`LegalCopyright` is itself mildly unusual for legitimate software.
