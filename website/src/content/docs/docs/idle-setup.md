---
title: Start when idle
description: Launch scrnsvr from Noctalia, hypridle, or a hot corner.
sidebar:
  order: 2
---

Noctalia or hypridle handles idle timing and any idle inhibitors, such as video playback. Use your desktop's session locker to require authentication.

## Noctalia

Open **Settings → Idle → Set up…** to review and apply the changes. The command line offers the same setup:

```sh
scrnsvr --setup-noctalia
scrnsvr --setup-noctalia --apply
```

The first command shows the plan. The second updates Noctalia through `noctalia msg config-set`. It reuses an existing scrnsvr behavior and its timeout when present. A new behavior starts at 600 seconds. Setup also sets Noctalia's `idle.pre_action_fade_seconds` to `0` so the desktop fades once using scrnsvr's transition.

To set a five-minute timeout, include `--timeout 300` when reviewing and applying the plan. You can also edit **Idle timeout** in Settings after setup. If Noctalia keeps running the old command after setup, run `noctalia msg config-reload` or restart Noctalia. [v1.0.0 release notes](https://github.com/rigerc/scrnsvr/releases/tag/v1.0.0#known-limits)

## hypridle

Add this listener to `~/.config/hypr/hypridle.conf` and ensure hypridle is running in your session. Change `timeout` to the number of seconds you want to wait.

```ini
listener {
    timeout = 600
    on-timeout = scrnsvr --open
}
```

Use the full installed path if hypridle cannot find `scrnsvr` on its `PATH`. The saver dismisses itself when you interact with your desktop. [hypridle configuration](https://wiki.hypr.land/hypr-ecosystem/user/hypridle/)

## Hot corner or key binding

Set the action to `scrnsvr --open`. To close the saver from a script or a separate command, use `scrnsvr --dismiss`.
