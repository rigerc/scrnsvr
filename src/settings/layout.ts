/** Settings shell. Interaction and shader content are mounted by SettingsPanel. */
export const settingsMarkup = `
  <header class="app-header">
    <div class="app-brand" aria-label="scrnsvr">scrnsvr</div>
    <nav class="main-tabs" role="tablist" aria-label="Settings views">
      <button id="shader-tab" type="button" role="tab" aria-selected="true" aria-controls="shader-settings" data-tab="shader-settings">Shaders</button>
      <button id="clock-tab" type="button" role="tab" aria-selected="false" aria-controls="clock-settings" tabindex="-1" data-tab="clock-settings">Clock</button>
      <button id="settings-tab" type="button" role="tab" aria-selected="false" aria-controls="system-settings" tabindex="-1" data-tab="system-settings">Settings</button>
    </nav>
    <span class="save-status" data-status role="status">All changes saved locally</span>
  </header>

  <div class="workspace">
    <aside class="shader-bank" aria-labelledby="bank-title">
      <div class="bank-heading">
        <h1 id="bank-title">Shader bank</h1>
        <button type="button" data-action="add-shader" aria-label="Add custom shader" title="Add custom shader">Add shader</button>
      </div>
      <div class="shader-categories" aria-label="Choose a shader"></div>
    </aside>

    <section class="preview-column" aria-labelledby="preview-title">
      <div class="preview-panel">
        <div class="clock-stage">
          <canvas class="preview" width="720" height="574" aria-label="Live shader preview"></canvas>
        </div>
        <div class="preview-caption">
          <span class="preview-kicker">Live preview</span>
          <h2 id="preview-title"></h2>
          <p class="preview-description"></p>
          <button type="button" data-action="edit-source" hidden>Edit source</button>
        </div>
      </div>
    </section>

    <aside class="inspector" aria-label="Settings inspector">
      <section id="shader-settings" class="shader-settings" role="tabpanel" aria-labelledby="shader-tab">
        <div class="controls" aria-label="Shader controls"></div>
        <div class="shader-actions">
          <button type="button" data-action="random">Randomize</button>
          <button type="button" data-action="reset">Reset shader</button>
        </div>
        <section class="color-import" aria-label="Colors">
          <h2>Color scheme</h2>
          <label class="scheme-control">Shader scheme
            <select data-shader-scheme aria-label="Color scheme for this shader"></select>
          </label>
          <p data-scheme-hint role="status">Using built-in shader colors.</p>
          <button type="button" data-action="import-noctalia">Import Noctalia colors</button>
          <p data-import-status role="status">Apply your desktop palette to this shader.</p>
        </section>
        <section class="presets" aria-labelledby="presets-title">
          <h2 id="presets-title">Presets</h2>
          <div class="preset-row">
            <input data-preset aria-label="Preset name" placeholder="Preset name">
            <button type="button" data-action="save">Save</button>
          </div>
          <div class="preset-list"></div>
        </section>
      </section>

      <section id="clock-settings" class="clock-settings" role="tabpanel" aria-labelledby="clock-tab" hidden></section>

      <section id="system-settings" class="system-settings" role="tabpanel" aria-labelledby="settings-tab" hidden>
        <h2>Settings</h2>
        <section class="global" aria-label="Global settings">
          <label>Idle threshold <span class="field-hint">seconds</span>
            <input data-global="idleThresholdSeconds" type="number" min="0" step="1">
          </label>
          <label>Frame rate <output data-output="fps"></output>
            <input data-global="fps" type="range" min="1" max="240" step="1">
          </label>
          <label>Fade in/out <output data-output="fadeSeconds"></output>
            <input data-global="fadeSeconds" type="range" min="0" max="5" step="0.1">
          </label>
          <label>Monitors
            <select data-global="monitors">
              <option value="primary">Primary monitor</option>
              <option value="all">All monitors</option>
            </select>
          </label>
          <label class="toggle-row"><input data-global-check="inhibitOnAudio" type="checkbox">Don't start while audio is playing</label>
          <label class="toggle-row"><input data-global-check="inhibitOnFullscreen" type="checkbox">Don't start over fullscreen apps</label>
          <label>Global color scheme
            <select data-global="scheme" aria-label="Global color scheme"></select>
          </label>
        </section>

        <section class="rotation" aria-label="Random rotation">
          <h2>Rotation</h2>
          <label class="toggle-row"><input type="checkbox" data-rotation="enabled">Shuffle on open</label>
          <label class="rotation-interval">Change shader every
            <input type="number" data-rotation="intervalMinutes" min="0" max="180" step="1">
            <span>min</span>
          </label>
          <p class="field-hint" data-rotation-interval-hint>0 means only on open</p>
          <ul class="rotation-list" data-rotation-list></ul>
          <p class="rotation-empty" data-rotation-empty hidden>No shaders selected. Use the add control on any shader tile.</p>
        </section>

        <section class="audio-settings" aria-label="Reactive shader audio">
          <h2>Audio response</h2>
          <label class="toggle-row"><input type="checkbox" data-audio-enabled>React to playing audio</label>
          <p>Uses the default output monitor through PulseAudio or PipeWire-Pulse. No microphone access, recording, or upload.</p>
          <meter data-audio-level min="0" max="1" value="0" aria-label="Playback audio level"></meter>
          <p data-audio-status role="status">Audio response is off.</p>
          <p>For reactive shaders with the idle daemon, turn off “Don't start while audio is playing.”</p>
        </section>
      </section>
    </aside>
  </div>`;
