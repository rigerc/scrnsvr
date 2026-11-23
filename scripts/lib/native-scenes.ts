// Bundle entry for scripts/check-native.cjs: scene plans built exactly as the main process builds them.
export { shaderRegistry } from '../../src/renderer/shaders';
export { effectRegistry } from '../../src/renderer/effects';
export { withCustomShaders } from '../../src/shared/custom-shaders';
export { ConfigSchema } from '../../src/shared/config';
export { buildScenePlan, clockMessage, nativeArguments } from '../../src/main/native-renderer';
export { palettes } from '../../src/shared/palettes';
export { colorFamilies } from '../../src/shared/color-palettes';
export { pickRotationEntry } from '../../src/shared/rotation';
export { resolveRendererTarget } from '../../src/main/windows';
