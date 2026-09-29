/** Settings shell. Interaction and shader content are mounted by SettingsPanel. */
export const settingsMarkup = `
  <header class="app-header">
    <div class="app-brand" aria-label="scrnsvr">scrnsvr</div>
    <nav class="main-tabs" role="tablist" aria-label="Settings views">
      <button id="shader-tab" type="button" role="tab" aria-selected="true" aria-controls="shader-settings" data-tab="shader-settings">Visuals</button>
      <button id="looks-tab" type="button" role="tab" aria-selected="false" aria-controls="looks-settings" tabindex="-1" data-tab="looks-settings">Looks &amp; Shuffle</button>
      <button id="clock-tab" type="button" role="tab" aria-selected="false" aria-controls="clock-settings" tabindex="-1" data-tab="clock-settings">Clock</button>
      <button id="settings-tab" type="button" role="tab" aria-selected="false" aria-controls="system-settings" tabindex="-1" data-tab="system-settings">Settings</button>
    </nav>
    <div class="save-feedback"><span class="save-status" data-status role="status">All changes saved locally</span><button type="button" data-action="retry-save" hidden>Retry save</button></div>
  </header>

  <div class="workspace">
    <aside class="shader-bank" aria-labelledby="bank-title">
      <div class="bank-heading">
        <h1 id="bank-title">Choose a visual</h1>
        <button type="button" data-action="add-shader" aria-label="Add custom shader" title="Add custom shader">Add shader</button>
      </div>
      <div class="shader-categories" aria-label="Choose a shader"></div>
    </aside>

    <section class="preview-column" aria-labelledby="preview-title">
      <div class="preview-panel">
        <div class="clock-stage">
          <canvas class="preview" width="720" height="574" aria-label="Live shader preview"></canvas>
          <button type="button" class="fullscreen-exit" data-preview-exit>Exit fullscreen</button>
        </div>
        <div class="preview-toolbar" aria-label="Preview controls">
          <button type="button" data-preview-pause aria-pressed="false">Pause animation</button>
          <button type="button" data-preview-fullscreen>Preview fullscreen</button>
          <button type="button" data-action="undo-preview" disabled hidden>Undo</button>
        </div>
        <p class="preview-status" data-playback-status role="status"></p>
        <p class="preview-status" data-preview-status role="status" hidden></p>
        <div class="preview-caption">
          <h2 id="preview-title"></h2>
          <p class="preview-description"></p>
          <button type="button" data-action="edit-source" hidden>Edit source</button>
        </div>
      </div>
      <section class="looks-workspace" aria-labelledby="looks-title" hidden>
        <div class="looks-heading">
          <h2 id="looks-title">Saved looks</h2>
          <p>For <strong data-look-shader></strong>. Looks save its adjustments; color schemes follow your current choice.</p>
        </div>
        <div class="current-look">
          <div><strong>Current edits</strong><p>Follows the adjustments you make to this visual.</p></div>
          <button type="button" data-current-shuffle></button>
        </div>
        <form class="look-save-form" data-look-save-form>
          <label for="look-name">Save current edits as a look</label>
          <div class="preset-row">
            <input id="look-name" data-preset aria-label="Look name" placeholder="Name this look" maxlength="80" required>
            <button type="submit" data-action="save">Save look</button>
          </div>
        </form>
        <div class="look-confirm" data-look-confirm hidden>
          <p data-look-confirm-text></p>
          <button type="button" data-action="update-look">Update saved look</button>
          <button type="button" data-action="cancel-update">Cancel</button>
        </div>
        <p class="look-message" data-look-message role="status" aria-live="polite"></p>
        <div class="preset-list" aria-label="Saved looks for the selected visual"></div>
      </section>
    </section>

    <aside class="inspector" aria-label="Settings inspector">
      <section id="shader-settings" class="shader-settings" role="tabpanel" aria-labelledby="shader-tab">
        <div class="inspector-heading"><h2>Adjust visual</h2><button type="button" data-action="open-save-look">Save look</button></div>
        <div class="controls" aria-label="Shader controls"></div>
        <div class="random-scope">
          <label for="random-scope">Randomize</label>
          <select id="random-scope" data-random-scope>
            <option value="structure">Motion &amp; shape</option>
            <option value="Motion">Motion</option>
            <option value="Shape">Shape</option>
            <option value="Color">Colors</option>
            <option value="all">All parameters</option>
          </select>
          <p>Locks keep parameters fixed during randomization.</p>
        </div>
        <div class="shader-actions">
          <button type="button" data-action="random">Randomize</button>
          <button type="button" data-action="undo-random" disabled>Undo</button>
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
      </section>

      <section id="looks-settings" class="looks-settings" role="tabpanel" aria-labelledby="looks-tab" hidden>
        <div class="shuffle-heading"><h2>Shuffle list</h2><span data-shuffle-count></span></div>
        <p class="shuffle-intro">Click a look to load it in Visuals. Remove only takes it out of shuffle.</p>
        <ul class="rotation-list" data-rotation-list></ul>
        <p class="rotation-empty" data-rotation-empty hidden>Choose a visual, then add its current edits or a saved look.</p>
        <div class="shuffle-behavior">
          <label class="toggle-row"><input type="checkbox" data-rotation="enabled">Shuffle when the screensaver starts</label>
          <label class="toggle-row"><input type="checkbox" data-rotation="cycle">Also change while it runs</label>
          <label class="rotation-interval">Change every
            <input type="number" data-rotation="intervalMinutes" min="1" max="180" step="1" aria-label="Minutes between changes">
            <span>minutes</span>
          </label>
          <p class="shuffle-summary" data-shuffle-summary role="status"></p>
        </div>
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
