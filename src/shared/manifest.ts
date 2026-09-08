export type UniformType = 'float'|'int'|'bool'|'color'|'select';
export interface UniformManifest { name:string; type:UniformType; default:number|boolean|string; min?:number; max?:number; options?:string[]; }
export interface ShaderManifest { id:string; title:string; description?:string; uniforms:UniformManifest[]; fragment:string; }
export const manifest = (value: ShaderManifest): ShaderManifest => value;
