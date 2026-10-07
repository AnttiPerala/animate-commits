# Animate Commits

Turn the visual history of a browser, Electron, or native Python desktop app into a numbered PNG sequence for a video editor. Give it a local Git repository or a clone URL. It checks out historical commits, starts the app, and captures the same viewport at each revision.

## Windows executable

**Double-click `animate-commits.exe` in the newest `dist/v<version>/` folder to open the graphical interface.** Its version appears beside the Animate Commits title and in the window title. It opens a dedicated application window, without a console. Choose a repository and an empty output folder, select Browser, Electron, or Python desktop, and enter the app's install/start commands. You can inspect commits, watch capture progress, cancel a run, play the resulting sequence, and open the output folder. Load/Save Configuration lets you reuse settings.

The interface uses an isolated Edge/Chrome app window and a local-only capture engine; it does not use your personal browser profile. Microsoft Edge or Google Chrome must be installed for the interface (a Playwright Chromium installation also works). Closing the window cancels any current run and cleans up its temporary checkout. The default output folder is under your Videos folder, outside the selected repository.

**Recent repositories** remembers the last 20 repositories, newest first, between launches and EXE updates. Browsing for a repository, loading a configuration, inspecting commits, or starting a capture adds it to the list. Selecting a recent repository fills the repository field and moves it to the top without starting a capture. Repeated entries are deduplicated. History is stored in `%APPDATA%\Animate Commits\recent-repositories.json` on Windows, outside your repositories; it stores paths/URLs, not capture commands or settings. Embedded HTTP credentials and query strings are omitted from saved URLs.

For command-line use, the same version folder includes `animate-commits-cli.exe`. From inside that folder:

```powershell
.\animate-commits-cli.exe --version
.\animate-commits-cli.exe --help
.\animate-commits-cli.exe C:\projects\my-app --app-type native --start "python app.py" --window-title "My App" --output .\captures\desktop
.\animate-commits-cli.exe --config .\examples\python-native.json
```

Each executable includes Node.js, Playwright, and the capture helper in a single file, extracting its own runtime to a temporary directory during execution. No Node.js installation is required for the tool itself. **Git and the target application's runtime/dependencies remain required**: Python for Python apps, Node/npm for JavaScript build commands, and an installed Edge/Chrome (or compatible Playwright browser) for web capture. Electron comes from the target app. The native adapter uses built-in Windows PowerShell and Win32 APIs, with no extra Python capture packages.

The executable is an unsigned Windows binary for the build machine's architecture. Each version folder contains `SHA256SUMS.txt`, `VERSION.txt`, distribution licenses, and example configurations. To rebuild on Windows with Node.js installed:

```powershell
npm ci
npm run build:exe
```

Each build reserves the next patch version in `package.json` and `package-lock.json`, embeds it in both executables, and writes to `dist/v<version>/`. Failed attempts keep their reserved version, so the next attempt gets a new number. Concurrent builds are blocked by `.version-build.lock`; remove that file after a crash only once the build process has stopped. `ANIMATE_BUILD_DIR` can override the output folder.

The project has a local Git repository. `AGENTS.md` instructs coding agents to commit each completed, verified major feature or fix, including its version metadata. Generated EXEs, captures, dependencies, and secrets are excluded. This is a development workflow, not a background watcher; ordinary app usage does not create Git commits.

## Setup

### Detect application settings

Choose a local repository, then use **Detect setup → Use these settings**. Browsing for a repository or choosing a recent one automatically shows suggestions. The detector reads current local files without installing dependencies or executing repository code. It shows its evidence and proposed commands, preserves your output folder and frame settings, and leaves all settings editable.

Supported suggestions include Node start/dev scripts, Vite, Next.js development servers, React scripts, Electron, static HTML sites, and Python Tkinter/PyQt/PySide/wx, Flask, Streamlit, and Django entry points. It checks common app subfolders when the root has no recognized setup. Node package managers are inferred from package metadata and lockfiles. Python suggestions create a virtual environment in each disposable checkout.

For projects with both a web server and Electron (such as Afterward), the web setup is suggested first and Electron is offered separately. Detection does not infer arbitrary build chains, authentication, databases, or project-specific startup logic. Suggestions describe the current working tree, not every historical commit; older revisions may need different commands. Remote URLs need a local clone for setup detection. Explicit commands and saved configurations remain supported.

A capture with empty launch settings now checks for recognizable local applications before cloning, and asks you to apply their setup instead of repeatedly capturing a nonexistent root page.

Running from source requires Node.js 22+ and Git. Browser/Electron capture supports Windows, macOS, and Linux; native desktop capture currently requires Windows 10/11 and an unlocked interactive desktop. Integration tests exercise the host platform. On Windows, use PowerShell for the commands below.

```sh
npm install
npm run browser:install
```

On Linux, Chromium may also need system packages: `npx playwright install --with-deps chromium`.

If the download is unavailable, the default `browser: "auto"` mode can use an already installed Microsoft Edge or Google Chrome. Set the JSON `browser` field to `chromium`, `msedge`, or `chrome` to select a specific browser. The manifest records its version. The installer downloads only the headless Chromium shell needed for capture.

## Capture a static website

```sh
node bin/animate-commits.js ../my-website --output ./captures/site
```

Without a start command, a built-in HTTP server serves each checkout. Use `--directory web` for an app in a repository subdirectory, or `--static-dir dist` for generated assets. Static routes must correspond to files or directories with `index.html`; there is no automatic SPA fallback.

## Capture a Vite / React app

```sh
node bin/animate-commits.js ../my-app --install "npm ci" --start "npm run dev -- --host 127.0.0.1 --port {port}" --output ./captures/app
```

For a production build, use `--install "npm ci && npm run build" --static-dir dist`. Commands run through the host shell: `cmd.exe` on Windows, `/bin/sh` on Unix. The temporary checkouts live on the local system disk, so a repository on a Windows network share also works.

Only use repositories you trust: install, build, and start commands execute their code with your account's permissions. A temporary checkout protects your working tree; it is not a security sandbox. Existing Git credentials handle private repositories. Submodules and Git LFS assets are not automatically initialized; configure appropriate install commands when needed.

## Reusable configuration

### Electron apps

```sh
node bin/animate-commits.js ../my-electron-app --app-type electron --install "npm ci" --output ./captures/electron
```

Electron mode launches the Electron binary installed in each checkout and captures the renderer window's content (not OS window borders or native dialogs). No separate browser download is needed. The default entry argument is `.`; use JSON `electronArgs`, for example `["dist/main.js"]`, for another entry point. Include any required binary installation and app build in `install`; some Electron/package-manager versions require an explicit Electron download step. The runner uses a fresh profile directory per commit, fixes capture dimensions, and closes Electron between revisions. Applications that override Electron's profile path may need their own test-mode configuration. Electron controls its own service-worker behavior.

`electronExecutable` can specify a binary relative to the checkout app directory or an absolute binary path. Using an absolute binary applies that runtime to every commit; otherwise the checkout's own Electron version is used. To select a main window instead of a splash screen, set `electronWindowUrl` to a regular expression matching its URL, and use `selector` to wait for the UI. If a renderer needs a development HTTP server, set `start` to **that server's** command and set `url` to its readiness endpoint; the tool launches Electron separately. Do not put `electron .` in `start`.

See `examples/electron.json`. This adapter uses [Playwright's experimental Electron support](https://playwright.dev/docs/api/class-electron); Electron builds with debugging disabled may not work. Electron windows can appear on the desktop during capture.

### Python apps

Python apps with a browser UI already use `appType: "web"`. Set `install` to create a virtual environment and install dependencies, then set `start` to launch Flask, Django, Streamlit, or another server at the configured port. `examples/python-web.json` is a Windows FastAPI/Uvicorn example; replace `app:app` with your module and application object. For macOS/Linux use `.venv/bin/python` in place of `.venv\\Scripts\\python.exe`. Virtual environments are created separately inside each disposable checkout.

Native Python desktop UIs use `appType: "native"` on Windows:

```powershell
node bin/animate-commits.js ../my-python-app --app-type native --start "python app.py" --window-title "My App" --width 1280 --height 720
```

The adapter finds visible windows belonging to the launched process or its descendants, filters by `nativeWindowTitle` (a regular expression), and selects the largest matching window. It captures only the client content using Win32 `PrintWindow`, excluding the title bar and borders. This supports conventional Tkinter and other Win32 desktop UI renderers; Tkinter is covered by integration tests. GPU/OpenGL surfaces, protected windows, and custom renderers may produce blank images or fail; inspect the preview for such applications. macOS/Linux native capture is not implemented.

The app appears on the desktop and its content area is resized to the configured dimensions. If the app refuses that size, the commit fails instead of silently exporting an inconsistent frame. `delay` provides a settle interval after resizing. For deterministic readiness, set `nativeReadyFile` to a relative filename (for example `ready.flag`) that your app writes when its UI is ready. `timeout` bounds window/readiness waiting. CSS selectors and browser emulation options do not apply to native windows; use the app's own test-mode settings for themes and data. Use a foreground `start` command, not a detached launcher, so process ownership and cleanup remain reliable.

`examples/python-native.json` shows a per-commit virtual environment and dependency installation. For a standard-library-only Tkinter app, omit `install` and use `python app.py`. The Python process tree is terminated after each capture, including failures and cancellation. Python command-line apps need a visual window to be captured.

### JSON options

Run `node bin/animate-commits.js --init` to write an example `animate-commits.json`, then edit it:

```json
{
  "repo": "../my-app",
  "output": "./captures/my-app",
  "ref": "HEAD",
  "from": null,
  "every": 1,
  "maxFrames": 60,
  "directory": ".",
  "install": "npm ci",
  "start": "npm run dev -- --host 127.0.0.1 --port {port}",
  "url": "http://127.0.0.1:{port}/",
  "port": 4173,
  "width": 1920,
  "height": 1080,
  "selector": "#root h1",
  "delay": 1000,
  "timeout": 60000,
  "commandTimeout": 300000,
  "fps": 2,
  "failFast": false,
  "env": {}
}
```

```sh
node bin/animate-commits.js --config animate-commits.json
```

Paths in JSON are relative to the configuration file. Paths on the command line are relative to the current directory. CLI options override JSON. `--help` lists CLI options; additional JSON fields include `staticDir`, `colorScheme`, `reducedMotion`, `locale`, and `timezoneId` (see `src/config.js`). Environment values must be strings. `PORT`, `HOST`, and `CI` are set by the runner; `{port}` is substituted in commands and the URL. Use a foreground server command that keeps running until stopped.

The default browser capture is 1920×1080, device scale 1, light mode, UTC, English locale, reduced motion, hidden text caret, and disabled CSS animations. Each web revision uses a fresh browser context with service workers blocked. It waits for an HTTP success response, page load, web fonts, an optional visible CSS selector, and the configured delay. The selector is useful for async data loading. Use deterministic application data for reproducible results; external services and changing content can still affect screenshots. Authentication and custom browser interaction scripts are not included in this version.

## Choose the history

```sh
node bin/animate-commits.js ../my-app --ref main --from v1.0 --max-frames 40 --list
node bin/animate-commits.js ../my-app --ref main --every 5 --max-frames 100 --output ./captures/main
```

History follows the first parent of the selected ref, oldest to newest. This avoids switching between parallel branches. `from` is inclusive and must be on that history. Every-N sampling includes the last commit; the frame cap then evenly samples the result, retaining both endpoints (a cap of 1 selects only the newest). The cap is on attempted commits, not successful captures. `--list` clones and lists the chosen history without launching a browser or app.

Cloning reports Git progress in Activity and allows 30 minutes by default for network repositories. Set **Git clone timeout (ms)** in Advanced settings, or `cloneTimeout` in a saved configuration, to change this limit. Cancellation and timeout stop the clone's process tree before cleanup. If Windows still locks this run's temporary folder, cleanup retries and then leaves it in place with a warning; it does not replace the original Git error or turn a successful capture into a failure.

## Append new commits to an existing capture

In the graphical interface, select the same repository and previous output folder, enable **Update existing capture**, and click **Update capture**. Keep the same app type, image size, and app commands. **Inspect commits** lists only the new selection when update is enabled. Load a saved configuration to reuse your settings.

From the command line, add `--update` to your original capture command:

```sh
node bin/animate-commits.js --config capture.config.json --update
```

The Windows console executable accepts the same options. Update works with browser, Electron, and native Python captures, including folders produced by the previous version of this tool. Select the folder containing `manifest.json`, not its `frames` subfolder.

Existing PNGs and logs are preserved. New images continue the numbering, and the preview includes the entire sequence. With no newer commits, the images, manifest, and preview remain unchanged. Before appending, the original manifest is backed up under `history/`.

The tool verifies that the saved commits still belong to the selected first-parent history and that existing images match the recorded sequence and dimensions. Rewritten or incompatible history requires a new output folder. A folder of PNGs without this tool's manifest cannot be updated. Only one capture can write to an output folder at a time; after a crash, remove `.animate-commits.lock` only once the previous capture process has stopped.

Sampling and the frame cap apply to newly selected commits. Update continues after the last processed commit; previously failed commits and earlier sampling gaps are not retried. A cancelled attempt can be retried, and remaining commits after cancellation or fail-fast can be captured, provided the folder already contains at least one successful frame.

## Results

```text
captures/my-app/
  frames/
    frame-000001.png
    frame-000002.png
    ...
  logs/              # install/server output and errors per attempted commit
  manifest.json      # frame-to-commit mapping, timestamps, failures
  preview.html       # local timeline player with scrubbing and speed control
```

Open `preview.html` in a browser. Import `frames/frame-000001.png` as an **image sequence** in your video editor and choose the interpretation frame rate, for example 2 fps for half a second per commit. Files have consistent dimensions and uninterrupted numbering even when a commit fails. `fps` controls the preview and records your intended rate in the manifest; PNG files do not contain a sequence playback rate. This exports individual PNG frames, not a single APNG file.

In the app, **Play sequence** opens the selected output folder's sequence and starts playback immediately. You can select a previous capture folder after restarting the app; no new capture is required. The app builds its player from `manifest.json`, so old or missing `preview.html` files do not prevent playback. Pause, stepping, scrubbing, and playback speed are available inside the player. Opening the standalone `preview.html` directly starts paused; click its Play button.

Optional FFmpeg conversion (requires FFmpeg separately):

```sh
ffmpeg -framerate 2 -i captures/my-app/frames/frame-%06d.png -c:v libx264 -r 30 -pix_fmt yuv420p progress.mp4
```

New captures require a new or empty output folder; enable update to append to a previous capture. Failures are recorded and skipped by default; `--fail-fast` stops after the first. Exit code 1 indicates a failure in the current run. Ctrl+C stops capture, preserves completed frames and the manifest, and cleans up temporary checkouts. Each revision gets a fresh checkout and dependency installation; long histories can take substantial time and disk space. Select a small sample first. Historical dependency or runtime incompatibilities may need different commands or separate runs for different eras of a project.

The input repository's branch and uncommitted changes are preserved. The runner clones it into an isolated temporary repository and removes its own temporary workspace afterward. Before starting an HTTP server, it refuses to proceed if the configured capture port is already occupied.

## Development

Generate a four-commit example and its playable output without supplying your own repository:

```sh
node scripts/demo.js
```

Open `captures/demo/preview.html`. Pass another empty output path as the script's first argument to run it again.

After building the executable, `node scripts/demo-native.js` creates and captures a three-commit Tkinter demo through the `.exe`, saving it to `captures/native-demo`. It requires Python with Tkinter on Windows.

```sh
npm test
```

Tests build real temporary repositories, run captures in Chromium, verify screenshot dimensions and changes, check failure handling and server cleanup, exercise the preview controls, and confirm the source working tree is untouched.

On Windows the native integration test requires `python` with Tkinter. Tests run sequentially because they share the desktop. Set `ANIMATE_TEST_EXE` to the absolute versioned `animate-commits-cli.exe` path to run native/Electron capture through the packaged binary and enable the packaged web smoke test. Set `ANIMATE_GUI_EXE` to the matching `animate-commits.exe` to test the graphical launch. In PowerShell use `(Get-Item <path-to-exe>).FullName` to obtain an absolute path.

The Electron integration test is enabled by setting `ANIMATE_ELECTRON_EXECUTABLE` to an installed Electron binary before running `npm test`. It exercises a splash screen plus main window, a broken historical revision, and consistent output dimensions. Without that variable it is explicitly skipped; Electron is not a required dependency of this tool.

Capture uses [Playwright screenshots](https://playwright.dev/docs/screenshots) and [Node.js child processes](https://nodejs.org/api/child_process.html).
