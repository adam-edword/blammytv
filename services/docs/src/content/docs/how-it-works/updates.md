---
title: Updates
description: How BlammyTV checks for, verifies and applies an update.
---

BlammyTV updates itself. The check runs against release manifests published on
GitHub — that is the one request the app makes on its own behalf rather than
on a provider's.

## What gets verified

An update is not applied because it downloaded successfully. Each package
carries a detached signature, and the app checks that signature against a
public key compiled into the build before anything is installed. The signature
is Ed25519 over a BLAKE2b-512 hash of the package's bytes.

Concretely, that means:

- A package modified in transit fails the check and is discarded.
- A package signed with any other key fails, because the only key the app
  trusts is the one baked into the binary you are already running.
- A manifest pointing at a file that does not exist, or at the wrong file,
  fails rather than installing something unexpected.

The same check runs before publishing, offline, against the exact bytes that
will be uploaded — a release that cannot verify locally does not ship.

## Two kinds of update

BlammyTV separates the native shell from the interface it renders:

- **Native updates** replace the whole application. These need a restart and
  arrive as a normal installer.
- **Interface updates** replace only the front end. They apply faster and are
  gated on the native version, so an interface build can never land on a shell
  too old to run it.

## Turning it off

If you would rather control this yourself, install from the
[Releases page](https://github.com/adam-edword/blammytv/releases/latest) as you
would any other app. Nothing about the release artefacts depends on the
updater having run.
