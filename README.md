# City Simulator

This project is a small 3D city-building prototype built with `three.js`. You place roads, houses, parks, and a few bigger buildings on a grid, and the game updates the city stats as you build.

The codebase is in a pretty nice middle ground right now: it is still small enough to understand in one sitting, but it has already been split into modules so it does not feel like one giant file with everything crammed into it.

## How The Project Is Organized

There are really three layers here:

1. The HTML files that define the page and UI.
2. The JavaScript files in `src/` that run the game.
3. The `.glb` files that hold the 3D models.

If you are trying to understand the project quickly, start with `index.html`, then `src/main.js`, then `src/game/City3DGame.js`, and only after that jump into the `modules/` folder.

## What Each File Does

### Root Files

[`index.html`](/C:/koduu/citysimulator/index.html)

This is the main game page. It holds the layout, HUD, build buttons, and the container where the Three.js scene gets mounted. If the game "looks wrong" from a UI point of view, this is usually the first file worth checking.


### 3D Asset Files

[`house1.glb`](/C:/koduu/citysimulator/house1.glb)

The imported 3D model for the first house type.

[`house2.glb`](/C:/koduu/citysimulator/house2.glb)

The imported 3D model for the second house type.

[`park.glb`](/C:/koduu/citysimulator/park.glb)

The imported 3D model for the park.

Small note here: `src/game/assets.js` references more model files than the three currently visible in this folder. That usually means one of two things: either some assets live somewhere else and are still expected at runtime, or the project is partway through being wired up. If models ever fail to load, `assets.js` is the first place I would compare against the actual files on disk.

### Main App Entry

[`src/main.js`](/C:/koduu/citysimulator/src/main.js)

This is the boot file. Its job is simple: wait for the page to be ready, create a `City3DGame` instance, kick off the first UI update, and start the intro camera move if it exists. It also exposes the game as `window.citySimulator`, which is handy for debugging in the browser console.

## Game Core

[`src/game/City3DGame.js`](/C:/koduu/citysimulator/src/game/City3DGame.js)

This is the heart of the project.

It sets up the main game state, owns the scene-level data, loads assets, builds fallback geometry when assets are missing, manages roads, and ties together the setup, placement, and simulation modules. If you want to know "where the real game lives," the answer is here.

Even though the file is big, it is doing the job of a central coordinator more than a random dump of code. A lot of the project's behavior branches out from this file.

[`src/game/CoCCameraController.js`](/C:/koduu/citysimulator/src/game/CoCCameraController.js)

This is the custom camera controller. The movement style is inspired by a mobile city-builder or Clash-of-Clans-style camera: drag to pan, wheel or pinch to zoom, and keep the view tilted and readable. If the scene feels awkward to navigate, this is the file to inspect.

[`src/game/assets.js`](/C:/koduu/citysimulator/src/game/assets.js)

This file is just the asset lookup table. It maps building or decoration types like `house1`, `park`, or `hospital` to the `.glb` file the game should try to load.

It is small, but important. When a model does not appear, this file is often involved.

[`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js)

This is the project's configuration hub. It defines:

- which buildings unlock at which level
- which DOM element IDs the UI expects
- what store buttons place which building type
- the labels used for buildings in the UI

This file is a good place for the "game rules that should stay easy to edit" kind of logic.

## Behavior Modules

[`src/game/modules/setupMethods.js`](/C:/koduu/citysimulator/src/game/modules/setupMethods.js)

This module handles startup and wiring work. It sets up Three.js, creates the scene, lights, sky, grid, hooks up DOM elements, and binds the button and pointer events.

In plain terms: this file gets the game ready to exist on screen.

[`src/game/modules/placementMethods.js`](/C:/koduu/citysimulator/src/game/modules/placementMethods.js)

This is the building interaction module. It handles ghost previews, clicking to place buildings, moving existing buildings, long-press behavior, and selecting buildings for actions.

If something is wrong with "placing stuff on the map," the bug is probably here or in `City3DGame.js`.

[`src/game/modules/simulationMethods.js`](/C:/koduu/citysimulator/src/game/modules/simulationMethods.js)

This module handles the living side of the city. It updates stats, manages animated building details, handles people and cars, and recalculates city state after changes.

This is the file that makes the city feel less static and more like a system.

## Suggested Reading Order

If someone new joins the project, I would point them through the files in this order:

1. [`index.html`](/C:/koduu/citysimulator/index.html)
2. [`src/main.js`](/C:/koduu/citysimulator/src/main.js)
3. [`src/game/gameConfig.js`](/C:/koduu/citysimulator/src/game/gameConfig.js)
4. [`src/game/City3DGame.js`](/C:/koduu/citysimulator/src/game/City3DGame.js)
5. [`src/game/modules/setupMethods.js`](/C:/koduu/citysimulator/src/game/modules/setupMethods.js)
6. [`src/game/modules/placementMethods.js`](/C:/koduu/citysimulator/src/game/modules/placementMethods.js)
7. [`src/game/modules/simulationMethods.js`](/C:/koduu/citysimulator/src/game/modules/simulationMethods.js)
8. [`src/game/CoCCameraController.js`](/C:/koduu/citysimulator/src/game/CoCCameraController.js)

That order gives the clearest mental model with the least confusion.

## Quick Mental Model

If you only want the short version, here it is:

- `index.html` builds the page.
- `main.js` starts the game.
- `City3DGame.js` owns the main game object.
- `setupMethods.js` prepares the world and UI.
- `placementMethods.js` lets the player build and move things.
- `simulationMethods.js` updates the city after things change.
- `assets.js` tells the game which model file belongs to which building.
- `gameConfig.js` keeps the editable rules and UI mappings in one place.

## Last Note

This README is written for the current state of the project, not for some ideal future architecture. So if the project grows, this file should grow with it. The best kind of README is the one that stays honest.
