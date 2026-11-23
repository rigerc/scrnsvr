use scrnsvr_core::noctalia::{Noctalia, plan, saver_executable};

use crate::Result;

pub fn setup(apply: bool, timeout: Option<f64>) -> Result<()> {
    let noctalia = Noctalia::default();
    let (_, current) = noctalia.read_idle()?;
    let (executable, installed) = saver_executable()?;
    let proposed = plan(&current, &executable, timeout)?;
    if proposed.changes.is_empty() {
        println!("Noctalia idle settings already match.");
    } else {
        for change in &proposed.changes {
            println!("{}", change.describe());
        }
    }
    if apply {
        noctalia.apply(&proposed.changes)?;
        let (raw, updated) = noctalia.read_idle()?;
        println!("Noctalia idle settings after setup\n{raw}");
        if !plan(&updated, &executable, timeout)?.changes.is_empty() {
            return Err("Noctalia did not retain all requested idle settings".into());
        }
    } else {
        println!("\nEquivalent TOML fragment\n{}", toml::to_string_pretty(&proposed.fragment)?);
        if !installed {
            println!(
                "Note: no installed link was found, so the command names {}.\nRun scrnsvr --install first to give Noctalia a stable path.\n",
                executable.display()
            );
        }
        if !proposed.changes.is_empty() {
            let timeout = timeout.map_or_else(String::new, |seconds| format!(" --timeout {seconds}"));
            println!(
                "To make these changes, run
  scrnsvr --setup-noctalia --apply{timeout}"
            );
        }
    }
    Ok(())
}
