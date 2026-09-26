/**
 * Software-rendering command line switches shared by the app and the headless
 * check scripts. Chromium needs these to bring up a WebGL context without a GPU
 * (ANGLE on top of SwiftShader); the check scripts reach this module through the
 * `dist/shared/gpu-flags.js` bundle emitted by `scripts/build.mjs`.
 */
const softwareGlSwitches: ReadonlyArray<readonly [string, string?]> = [
  ['disable-vulkan'],
  ['use-gl', 'angle'],
  ['use-angle', 'swiftshader-webgl'],
  ['enable-unsafe-swiftshader'],
];

export interface CommandLineLike {
  appendSwitch(name: string, value?: string): void;
}

/** The X11 backend is only forced when the process actually has an X display. */
export function applySoftwareGl(commandLine: CommandLineLike): void {
  for (const [name, value] of softwareGlSwitches) commandLine.appendSwitch(name, value);
  if (process.env.DISPLAY) commandLine.appendSwitch('ozone-platform', 'x11');
}
