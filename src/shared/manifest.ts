// Ambient: light, fluid surfaces, and landscapes. Geometric: shapes and patterns.
// Keep audio-responsive shaders and user-created shaders easy to find separately.
export const shaderCategories = ['Ambient', 'Geometric', 'Reactive', 'Custom'] as const;
export type ShaderCategory = typeof shaderCategories[number];
export type UniformType = 'float'|'int'|'bool'|'color'|'select';
export type UniformValue = number | boolean | string;
export type UniformGroup = 'Motion' | 'Shape' | 'Color';
export type UniformColorRole = 'primary' | 'secondary' | 'tertiary' | 'surface' | 'onSurface';
export interface UniformManifest {
  name: string;
  type: UniformType;
  default: UniformValue;
  label?: string;
  description?: string;
  group?: UniformGroup;
  advanced?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  colorRole?: UniformColorRole;
  options?: string[];
  visibleWhen?: { name: string; value: UniformValue };
  random?: { min: number; max: number } | false;
}
export interface ShaderManifest { id:string; title:string; category?:ShaderCategory; description?:string; uniforms:UniformManifest[]; fragment:string; schemePalette?: string; }
export const manifest = (value: ShaderManifest): ShaderManifest => value;
