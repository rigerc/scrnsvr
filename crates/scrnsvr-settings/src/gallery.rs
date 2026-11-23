//! Starting thumbnail captures for the shader bank and reporting their results.

use gpui_kit::*;
use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::exec::find_executable;
use scrnsvr_core::thumbnail::{DEFAULT_FRAMES, capture_png, clean_scene, prune};

use crate::app::Settings;

impl Settings {
    /// Queue the thumbnail of one visual, rebuilding its clean scene from the current config.
    pub fn request_thumbnail(&mut self, id: &str, urgent: bool, cx: &mut Context<Self>) {
        match clean_scene(Catalog::builtin(), &self.model.config.custom_shaders, id) {
            Ok(scene) => self.thumbnails.want(id, scene, urgent),
            // A custom source that fails the policy has nothing to render; its tile keeps the placeholder.
            Err(_) => self.thumbnails.forget(id),
        }
        self.pump_thumbnails(cx);
    }

    /// Queue every visual, the selected one first, then in bank order.
    pub fn request_all_thumbnails(&mut self, cx: &mut Context<Self>) {
        let selected = self.model.visual().id.clone();
        let mut ids = vec![selected.clone()];
        for (_, rows) in self.model.matches() {
            ids.extend(rows.into_iter().map(|index| self.model.visuals[index].id.clone()));
        }
        ids.extend(self.model.visuals.iter().map(|visual| visual.id.clone()));
        let mut seen = std::collections::HashSet::new();
        for id in ids.into_iter().filter(|id| seen.insert(id.clone())) {
            match clean_scene(Catalog::builtin(), &self.model.config.custom_shaders, &id) {
                Ok(scene) => self.thumbnails.want(&id, scene, false),
                Err(_) => self.thumbnails.forget(&id),
            }
        }
        self.pump_thumbnails(cx);
    }

    /// Start captures until the concurrency limit is reached. Each runs in the background.
    pub fn pump_thumbnails(&mut self, cx: &mut Context<Self>) {
        while let Some(job) = self.thumbnails.next_job() {
            let program = self.paths.renderer.clone();
            cx.spawn(async move |this, cx| {
                let task = job.clone();
                let result = cx
                    .background_executor()
                    .spawn(async move {
                        let renderer = match program {
                            Some(program) => program,
                            None => find_executable("scrnsvr-renderer")?,
                        };
                        capture_png(&renderer, &task.scene, DEFAULT_FRAMES, &task.output).map_err(|error| error.to_string())?;
                        if let Some(directory) = task.output.parent() {
                            prune(directory, &task.id, &task.key);
                        }
                        Ok::<(), String>(())
                    })
                    .await;
                let _ = this.update(cx, |this, cx| {
                    this.thumbnails.finished(&job, result);
                    if this.thumbnails.entry(&job.id).is_none() {
                        // The shader was deleted while this image rendered.
                        let _ = std::fs::remove_file(&job.output);
                    }
                    this.pump_thumbnails(cx);
                    cx.notify();
                });
            })
            .detach();
        }
    }
}
