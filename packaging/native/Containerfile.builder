# Builder image for the native scrnsvr AppImage: Ubuntu 22.04 (glibc 2.35) + a pinned Rust toolchain.
# Built and used by scripts/build-appimage-container.sh; see that script's header for the workflow.
#
# The base is pinned by digest (the linux/amd64 manifest of ubuntu:22.04 as of 2026-11). Package
# versions are whatever jammy/jammy-updates ship at image build time (they are glibc-2.35-compatible
# by definition and recorded in the image at /usr/share/scrnsvr-builder-packages.txt).
FROM docker.io/library/ubuntu@sha256:45e9ddc6895604674618a409ca9f73d301da8fdb75fe330e8e9a27b3b219e4ad

ARG RUST_VERSION=1.99.1
ARG RUSTUP_VERSION=1.29.3
ARG RUSTUP_INIT_SHA256=b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# C toolchain + the -dev packages the build links against: pango/cairo/glib (scrnsvr-render),
# xcb + xkbcommon(-x11) (GPUI X11 backend in scrnsvr-settings), wayland, freetype/fontconfig (GPUI
# text), EGL/GLES/Vulkan headers and libs for the GL/wgpu paths.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git pkg-config cmake clang \
      libpango1.0-dev libcairo2-dev libglib2.0-dev \
      libwayland-dev libxkbcommon-dev libxkbcommon-x11-dev \
      libxcb1-dev libxcb-xkb-dev libxcb-shape0-dev libxcb-xfixes0-dev libxcb-render0-dev \
      libx11-dev libx11-xcb-dev libxrandr-dev \
      libfontconfig1-dev libfreetype6-dev \
      libegl1-mesa-dev libgles2-mesa-dev libvulkan-dev libssl-dev libasound2-dev libdbus-1-dev \
 && dpkg-query -W -f='${Package} ${Version}\n' >/usr/share/scrnsvr-builder-packages.txt \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL --retry 3 -o /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_INIT_SHA256}  /tmp/rustup-init" | sha256sum --check --status \
 && chmod +x /tmp/rustup-init \
 && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
 && rm /tmp/rustup-init \
 && chmod -R a+rwX "${RUSTUP_HOME}" "${CARGO_HOME}" \
 && rustc --version && cargo --version

WORKDIR /src
