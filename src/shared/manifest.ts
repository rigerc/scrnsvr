export const shaderCategories = ['Abstract', 'Ambient', 'Clocks', 'Digital', 'Landscapes', 'Space', 'Water'] as const;
export type ShaderCategory = typeof shaderCategories[number];
export type UniformType = 'float'|'int'|'bool'|'color'|'select';
export type UniformValue = number | boolean | string;
export type UniformGroup = 'Motion' | 'Shape' | 'Color';
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
  options?: string[];
  visibleWhen?: { name: string; value: UniformValue };
  random?: { min: number; max: number } | false;
}
export interface ShaderManifest { id:string; title:string; category?:ShaderCategory; description?:string; uniforms:UniformManifest[]; fragment:string; }
export const manifest = (value: ShaderManifest): ShaderManifest => value;
