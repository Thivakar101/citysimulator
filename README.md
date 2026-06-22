# City Simulator

City Simulator is a browser-based 3D city-building prototype built with `three.js`. The project is intentionally lightweight: there is no bundler, no backend, and no framework layer sitting between the page and the game logic. That makes it a good base if you want to plug in new buildings, UI actions, or gameplay rules without spending half your time navigating tooling.

This README is written for the next person who needs to extend the current version, not for an imaginary future rewrite. If you are about to integrate something into the existing code, start here.

## What You Are Working With

At a high level, the app has three moving parts:

1. `index.html` defines the full page, HUD, store buttons, placement controls, and the container where the WebGL canvas is mounted.
2. `src/main.js` boots the game and exposes the running instance as `window.citySimulator` for debugging and manual integration work.
3. `src/game/` contains the actual game logic: scene setup, input handling, placement, progression, simulation, configuration, and asset lookup.

There is no separate API layer yet. The DOM, the config files, and the `City3DGame` instance are the integration surface.

## Quick Start

Because the app uses ES modules in the browser, do not open `index.html` directly from the filesystem. Serve the project through a small local HTTP server instead.

A simple option is:

```powershell
cd C:\koduu\citysimulator
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

If Python is not available, any static server will do. The main requirement is that the browser loads `index.html` over HTTP so the module imports work correctly.

## Boot Flow

The startup path is short and worth understanding:

1. `index.html` loads `src/main.js` as a module.
2. `src/main.js` waits for the DOM to be ready.
3. It creates `new City3DGame({ containerId: 'game-container', gridSize: 5, cellSize: 6, ... })`.
4. It immediately refreshes the UI with `game._updateUI()`.
5. It triggers `game.introCinematic?.()`.
6. It stores the live instance on `window.citySimulator`.

That last step is especially useful during integration work. In the browser console you can inspect the running game with:

```js
window.citySimulator
```

If you need to test behavior quickly, this is the fastest way to poke the live object without wiring a full feature first.

## Project Structure

### Root

[`index.html`](/C:/koduu/citysimulator/index.html)

The full UI shell lives here. The HUD, build buttons, decorate buttons, placement controls, action menu, status area, and hidden feed container are all defined in this file. If you add a new button, panel, or DOM hook for integration, you will almost always touch this file first.

[`README.md`](/C:/koduu/citysimulator/README.md)

This document.

### App Entry

[`src/main.js`](/C:/koduu/citysimulator/src/main.js)

This is the browser entry point. It is intentionally small: create the game, handle boot errors, and expose the instance globally. If you need to replace or wrap the default startup behavior, this is the cleanest place to do it.

### Core Game Files

[`src/game/City3DGame.js`](/C:/koduu/citysimulator/src/game/City3DGame.js)

This is the central game object. It owns the main state for the city, the Three.js scene, asset loading, procedural building fallbacks, road rendering, timing, and cross-module coordination.

A practical way to think about it: this file is the backbone, while the module files below attach the behavior.

[`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js)

This is the main configuration surface. It defines:

- what building types exist
- which level unlocks each building
- which DOM button IDs map to which placement type
- the labels used in the UI
- which store buttons are considered level-based versus decoration-based

If you are integrating a new placeable type, this is one of the first files that needs to change.

[`src/game/assets.js`](/C:/koduu/citysimulator/src/game/assets.js)

This maps logical asset keys such as `house1`, `park`, or `school` to `.glb` file paths.

Important note: the asset map currently references more `.glb` files than are present in the repository root. The game is resilient because it falls back to procedural geometry for many building types, but if you expect a real model to appear and it does not, check this file first and then confirm the matching asset actually exists on disk.

[`src/game/CoCCameraController.js`](/C:/koduu/citysimulator/src/game/CoCCameraController.js)

This is the custom camera controller used for panning, zooming, and rotating the view. If your integration changes scene scale, map size, or camera feel, this file may become part of the work.

### Behavior Modules

[`src/game/modules/setupMethods.js`](/C:/koduu/citysimulator/src/game/modules/setupMethods.js)

This module wires the game into the page. It creates the scene, camera, renderer, lights, ground, grid helper, DOM references, store click handlers, keyboard hooks, and pointer listeners.

If you are connecting a new UI element to the existing game, there is a very good chance the final event hookup belongs here.

[`src/game/modules/placementMethods.js`](/C:/koduu/citysimulator/src/game/modules/placementMethods.js)

This module handles building placement, ghost previews, rotation, selection, long press, moving buildings, removing buildings, stock checks, and placement validation.

If your integration changes how something is placed or selected on the grid, this is the file to inspect.

[`src/game/modules/simulationMethods.js`](/C:/koduu/citysimulator/src/game/modules/simulationMethods.js)

This module updates the HUD, recalculates city stats, expands the grid on level-up, animates live scene details, and drives the main render/update loop.

If the new feature affects progression, happiness, animation, or ongoing city behavior, the logic will usually land here.

## The Existing Integration Surface

Right now the project is integrated through a few concrete contracts rather than one formal plugin system.

### 1. DOM contract

`setupMethods.js` reads a fixed set of element IDs from `gameConfig.js` and `index.html`. If a required button or HUD node is missing, the corresponding behavior will not wire up.

That means when you add UI, you usually need to update both places:

- `index.html` to add the element
- `src/game/gameConfig.js` to register its ID if the game should manage it

### 2. Store contract

The build and decoration buttons are driven by `STORE_ITEMS` in [`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js). During setup, the game loops through `STORE_ITEMS` and calls `_hookStore(id, placement)` for each one.

In other words, adding a placeable item is not just a visual change. The button ID must exist in the DOM and also be registered in `STORE_ITEMS` with a `placement.type`.

### 3. Building registry contract

The unlock system uses `BUILDING_REGISTRY`. If a building type is not declared there, it will not participate cleanly in the level-based progression rules.

### 4. Asset contract

The runtime model lookup uses `ASSETS`. If a type should load a real `.glb`, it needs an entry there. If it does not have one, the code either falls back to procedural geometry or logs a loading failure and keeps going.

### 5. Runtime instance contract

The running game is exposed as `window.citySimulator`. That gives you a simple bridge for:

- quick debugging
- experimenting with new methods
- integrating temporary scripts without changing boot logic first
- testing UI behavior from the browser console

## How To Integrate A New Building

If you want to add a new building or decoration to the existing experience, this is the safest order to do it.

### Step 1: Add the UI button

Create the button in [`index.html`](/C:/koduu/citysimulator/index.html) using the same shape as the existing store buttons.

You will need:

- a unique `id`
- a visible label
- optional stock text or cost text, depending on whether it behaves like a normal building or a decoration

### Step 2: Register the element ID

Add the button ID to `UI_ELEMENT_IDS` in [`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js).

This allows `setupMethods.js` to collect the element into `this.ui` during startup.

### Step 3: Add the store mapping

Add a new entry to `STORE_ITEMS` in [`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js), for example:

```js
{ id: 'buyMuseum', placement: { type: 'museum', cost: 0 } }
```

If it is a decoration item, follow the existing pattern and set `isDecoration: true` where needed.

### Step 4: Add level rules

Add the type to `BUILDING_REGISTRY`, for example:

```js
museum: { level: 3 }
```

This keeps the unlock behavior aligned with the rest of the game.

### Step 5: Add a display label

Register the readable name in `BUILDING_LABELS` so UI messages and placement feedback show the right text.

### Step 6: Add an asset or procedural fallback

If you have a `.glb` model, register it in [`src/game/assets.js`](/C:/koduu/citysimulator/src/game/assets.js).

If you do not have a model yet, add a procedural case in `_buildProceduralFallback()` inside [`src/game/City3DGame.js`](/C:/koduu/citysimulator/src/game/City3DGame.js). That is already how several building types remain playable even when real assets are missing.

### Step 7: Add simulation or stat effects if needed

If the building should change happiness, population, progression, or animated behavior, update the relevant logic in [`src/game/modules/simulationMethods.js`](/C:/koduu/citysimulator/src/game/modules/simulationMethods.js).

### Step 8: Verify placement behavior

Make sure the new type can:

- enter placement mode
- show a ghost preview
- rotate if rotation matters
- place correctly on the grid
- respect level locks and stock limits
- update the HUD correctly afterward

## How To Integrate New UI Without Adding A Building

If the integration is a new control, panel, or overlay rather than a placeable object, the usual path is:

1. Add the markup in [`index.html`](/C:/koduu/citysimulator/index.html).
2. Add the element ID to `UI_ELEMENT_IDS` if the game should keep a reference to it.
3. Bind the event in `_bindUiEvents()` inside [`src/game/modules/setupMethods.js`](/C:/koduu/citysimulator/src/game/modules/setupMethods.js).
4. Add or call the corresponding game method from there.

This is the best place for buttons such as toggles, debug actions, speed controls, alternate camera actions, or small game commands.

## Useful Runtime Hooks

The code does not expose a polished public API yet, but there are still a few practical entry points that are useful during integration:

- `window.citySimulator` gives you the live instance.
- `window.citySimulator.zoomIn()` and `window.citySimulator.zoomOut()` already exist and are safe to call.
- `window.citySimulator.setTimeScale(scale)` exists in the simulation module for speed control.
- `window.citySimulator._updateUI()` is useful after temporary state edits during debugging.
- `window.citySimulator.introCinematic?.()` reapplies the default camera framing.

Methods prefixed with `_` are internal by convention, so they are convenient for development but should be treated carefully if you are building a longer-lived integration.

## Common Gotchas

### Missing assets are easy to misread

If a building does not show its final model, that does not always mean the feature is broken. The code often falls back to procedural geometry. Check whether the `.glb` file actually exists and whether `ASSETS` points to the right filename.

### `main.js` passes extra constructor fields

`src/main.js` currently passes `buildingCost` and `coinIncrement` into the `City3DGame` constructor, but the constructor only destructures `containerId`, `gridSize`, and `cellSize`. That means those extra values are not currently part of the active runtime contract.

If you plan to integrate an economy system, do not assume those fields are already wired up. They are not.

### The codebase mixes config-driven behavior with internal methods

A lot of the flow is nicely config-based, but some feature work still requires touching core methods directly. That is normal for the current size of the project. The cleanest approach is usually:

- use `gameConfig.js` when you are describing a type, label, button, or unlock rule
- use the modules when you are changing behavior
- use `City3DGame.js` when you are extending the core runtime or asset/fallback rendering

## Suggested Reading Order For New Contributors

If someone is joining the project and needs to understand it quickly, this order works well:

1. [`index.html`](/C:/koduu/citysimulator/index.html)
2. [`src/main.js`](/C:/koduu/citysimulator/src/main.js)
3. [`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js)
4. [`src/game/modules/setupMethods.js`](/C:/koduu/citysimulator/src/game/modules/setupMethods.js)
5. [`src/game/City3DGame.js`](/C:/koduu/citysimulator/src/game/City3DGame.js)
6. [`src/game/modules/placementMethods.js`](/C:/koduu/citysimulator/src/game/modules/placementMethods.js)
7. [`src/game/modules/simulationMethods.js`](/C:/koduu/citysimulator/src/game/modules/simulationMethods.js)
8. [`src/game/assets.js`](/C:/koduu/citysimulator/src/game/assets.js)

That order gives you the UI contract first, then the config surface, then the runtime details.

## If You Only Remember One Thing

For most integrations, the work is spread across four places:

- `index.html` for the visible UI
- `src/game/gameConfig.js` for IDs, labels, store wiring, and unlock rules
- `src/game/assets.js` for model mapping
- `src/game/modules/` for actual behavior

If those four stay in sync, the project is easy to extend. When they drift apart, bugs usually show up as missing buttons, dead clicks, wrong labels, locked items, or invisible assets.
