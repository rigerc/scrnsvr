//! Shader compilation, driver uniform reflection and typed uniform upload.

use std::fmt;

use glow::HasContext;
use scrnsvr_core::UniformValue;

const VERTEX_SOURCE: &str =
    "attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}";

#[derive(Debug, Clone, PartialEq)]
pub enum CompileError {
    Compile(String),
    Link(String),
    Resource(String),
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompileError::Compile(log) => write!(f, "Shader compile failed: {log}"),
            CompileError::Link(log) => write!(f, "Shader link failed: {log}"),
            CompileError::Resource(message) => write!(f, "Could not allocate GL objects: {message}"),
        }
    }
}

impl std::error::Error for CompileError {}

pub(crate) struct UniformInfo {
    name: String,
    location: Option<glow::UniformLocation>,
    kind: u32,
    size: i32,
}

/// A linked program and the uniforms the driver reports as active.
pub(crate) struct Program {
    pub id: glow::Program,
    uniforms: Vec<UniformInfo>,
}

fn compile_shader(gl: &glow::Context, kind: u32, source: &str) -> Result<glow::Shader, CompileError> {
    // SAFETY: the caller keeps the context current.
    unsafe {
        let shader = gl.create_shader(kind).map_err(CompileError::Resource)?;
        gl.shader_source(shader, source);
        gl.compile_shader(shader);
        if gl.get_shader_compile_status(shader) {
            return Ok(shader);
        }
        let log = gl.get_shader_info_log(shader);
        gl.delete_shader(shader);
        Err(CompileError::Compile(log))
    }
}

pub(crate) fn compile_program(gl: &glow::Context, fragment: &str) -> Result<Program, CompileError> {
    let vertex = compile_shader(gl, glow::VERTEX_SHADER, VERTEX_SOURCE)?;
    // SAFETY: the caller keeps the context current; every object is deleted on each path.
    unsafe {
        let pixel = match compile_shader(gl, glow::FRAGMENT_SHADER, fragment) {
            Ok(pixel) => pixel,
            Err(error) => {
                gl.delete_shader(vertex);
                return Err(error);
            }
        };
        let id = match gl.create_program() {
            Ok(id) => id,
            Err(error) => {
                gl.delete_shader(vertex);
                gl.delete_shader(pixel);
                return Err(CompileError::Resource(error));
            }
        };
        gl.attach_shader(id, vertex);
        gl.attach_shader(id, pixel);
        gl.bind_attrib_location(id, 0, "position");
        gl.bind_attrib_location(id, 1, "uv");
        gl.link_program(id);
        gl.delete_shader(vertex);
        gl.delete_shader(pixel);
        if !gl.get_program_link_status(id) {
            let log = gl.get_program_info_log(id);
            gl.delete_program(id);
            return Err(CompileError::Link(log));
        }
        let uniforms = (0..gl.get_active_uniforms(id))
            .filter_map(|index| gl.get_active_uniform(id, index))
            .map(|active| {
                let location = gl.get_uniform_location(id, &active.name);
                let name = active.name.split('[').next().unwrap_or_default().to_owned();
                UniformInfo { name, location, kind: active.utype, size: active.size }
            })
            .collect();
        Ok(Program { id, uniforms })
    }
}

/// `None` when the fragment shader compiles and links. Requires a current context.
pub fn compile_error(gl: &glow::Context, fragment: &str) -> Option<CompileError> {
    match compile_program(gl, fragment) {
        Ok(program) => {
            program.destroy(gl);
            None
        }
        Err(error) => Some(error),
    }
}

fn round(value: f32) -> i32 {
    value.round() as i32
}

impl Program {
    fn find(&self, name: &str) -> Option<&UniformInfo> {
        self.uniforms.iter().find(|uniform| uniform.name == name && uniform.location.is_some())
    }

    pub fn destroy(self, gl: &glow::Context) {
        // SAFETY: the caller keeps the owning context current.
        unsafe { gl.delete_program(self.id) };
    }

    /// Write numbers according to the shader's declaration. Undeclared or
    /// optimized-away uniforms are ignored. The program must be in use.
    pub fn set_floats(&self, gl: &glow::Context, name: &str, values: &[f32]) {
        let Some(info) = self.find(name) else { return };
        let mut floats = [0.0f32; 16];
        let count = values.len().min(16);
        floats[..count].copy_from_slice(&values[..count]);
        let location = info.location.as_ref();
        // SAFETY: the caller keeps the context current with this program in use.
        unsafe {
            match info.kind {
                glow::FLOAT if info.size > 1 && count > 1 => gl.uniform_1_f32_slice(location, &floats[..(info.size as usize).min(count)]),
                glow::FLOAT => gl.uniform_1_f32(location, floats[0]),
                glow::FLOAT_VEC2 => gl.uniform_2_f32_slice(location, &floats[..2]),
                glow::FLOAT_VEC3 => gl.uniform_3_f32_slice(location, &floats[..3]),
                glow::FLOAT_VEC4 => gl.uniform_4_f32_slice(location, &floats[..4]),
                glow::INT | glow::BOOL | glow::SAMPLER_2D => gl.uniform_1_i32(location, round(floats[0])),
                glow::INT_VEC2 | glow::BOOL_VEC2 => gl.uniform_2_i32(location, round(floats[0]), round(floats[1])),
                glow::INT_VEC3 | glow::BOOL_VEC3 => gl.uniform_3_i32(location, round(floats[0]), round(floats[1]), round(floats[2])),
                glow::INT_VEC4 | glow::BOOL_VEC4 => {
                    gl.uniform_4_i32(location, round(floats[0]), round(floats[1]), round(floats[2]), round(floats[3]))
                }
                _ => {}
            }
        }
    }

    pub fn set_uniform(&self, gl: &glow::Context, name: &str, value: &UniformValue) {
        self.set_floats(gl, name, &value.floats());
    }

    pub fn set_int(&self, gl: &glow::Context, name: &str, value: i32) {
        if let Some(info) = self.find(name) {
            // SAFETY: the caller keeps the context current with this program in use.
            unsafe { gl.uniform_1_i32(info.location.as_ref(), value) };
        }
    }
}
