---
title: Upgrade scrnsvr
description: Replace an existing AppImage or move from the 0.x releases to scrnsvr 1.x.
sidebar:
  order: 7
---

## Replace a 1.x AppImage

Follow the [installation steps](../install/) with the new AppImage and run its `--install` again. This updates the stable command that your idle service uses. Keep the new AppImage at its installed location.

## Move from 0.x to 1.x

1. If you ran the old user service, stop and disable it with `systemctl --user disable --now scrnsvr.service`. If you installed the old `.deb`, remove that package through your package manager.
2. [Install the new AppImage](../install/). Replace any idle command or hot-corner action that calls `scrnsvr --daemon` or names an older AppImage. [Configure your idle service](../idle-setup/) to use the new command.
3. Open **Settings** and re-create your visuals, effects, saved looks, clock preferences, and favorites. Version 1.x starts fresh in `config.toml`. Your old `config.json` stays on disk for reference.

Quiet Horizon, Velvet Cloud, and Lightwell run in their quiet state. Version 1.x removed audio capture, so custom shaders receive a zero-valued `uAudio`. See the [v1.0.0 release notes](https://github.com/rigerc/scrnsvr/releases/tag/v1.0.0#breaking-changes) for the full list of changes.
