const fs = require('fs');
let content = fs.readFileSync('c:/koduu/citysimulator/threecity.js', 'utf8');

// 1. assets.js
const assetsCode = `export const ASSETS = {
  house: './building.glb'
};\n`;
fs.writeFileSync('c:/koduu/citysimulator/assets.js', assetsCode);

// 2. camera.js
const cameraStart = content.indexOf('class CoCCameraController {');
const cameraEnd = content.indexOf('class City3DGame {');
let cameraCode = `import * as THREE from 'three';\n\n` + content.substring(cameraStart, cameraEnd).trim() + `\n\nexport { CoCCameraController };\n`;
fs.writeFileSync('c:/koduu/citysimulator/camera.js', cameraCode);

// 3. game.js
let gameCode = content.substring(cameraEnd, content.indexOf('window.City3DGame = City3DGame;')).trim();

gameCode = `import * as THREE from 'three';\nimport { CoCCameraController } from './camera.js';\nimport { ASSETS } from './assets.js';\n\n` + gameCode;

gameCode = gameCode.replace('// Water: no coin cost; acts as decorative tile', '');
gameCode = gameCode.replace(/\bwater:\s*0x[0-9a-fA-F]+,?/g, '');
gameCode = gameCode.replace(/this\.houseAssetUrl\s*=\s*'\.\/building\.glb';/, 'this.houseAssetUrl = ASSETS.house;');
gameCode = gameCode.replace(/\s*if \(this\._waterShader\) \{[\s\S]*?this\._waterShader\.uniforms\.uTime\.value = t;\s*\}/, '');
gameCode = gameCode.replace(/\s*\/\/ Water animation\s*this\._updateWater\(t\);/, '');
gameCode = gameCode.replace(/\s*\/\/ Drive world-space water shader\s*if \(this\._waterWorldUniforms\) \{[\s\S]*?this\._waterWorldUniforms\.uTime\.value = t;\s*\}/, '');
gameCode = gameCode.replace(/\s*if \(this\._realWaterUniforms\) \{[\s\S]*?this\._realWaterUniforms\.uTime\.value = t;\s*\}/, '');
gameCode = gameCode.replace(/\s*if \(this\._waterTexSide\) \{[\s\S]*?this\._waterTexSide\.needsUpdate = true;\s*\}/, '');
gameCode = gameCode.replace(/\s*\/\/ Water: toggleable decorative band with flowing shader/, '');

const waterMethods = ['_isWaterCell', '_computeWaterMask', '_getWaterTexture', '_applyWaterTexture', '_refreshWaterAtAndNeighbors', '_placeWaterTile', '_refreshAllWater', '_generateDefaultPonds', '_toggleWater', '_createWater', '_destroyWater', '_rebuildWaterGeometry', '_updateWater'];
waterMethods.forEach(name => {
    let methodStart = gameCode.indexOf(name + '(');
    if (methodStart !== -1) {
        methodStart = gameCode.lastIndexOf('\n', methodStart);
        let braceCount = 0;
        let methodEnd = -1;
        let started = false;
        for (let i = methodStart; i < gameCode.length; i++) {
            if (gameCode[i] === '{') { braceCount++; started = true; }
            if (gameCode[i] === '}') { 
                braceCount--; 
                if (started && braceCount === 0) { methodEnd = i + 1; break; }
            }
        }
        if (methodEnd !== -1) {
            gameCode = gameCode.substring(0, methodStart) + gameCode.substring(methodEnd);
        }
    }
});
// do it again for safety
waterMethods.forEach(name => {
    let methodStart = gameCode.indexOf(name + '(');
    if (methodStart !== -1) {
        methodStart = gameCode.lastIndexOf('\n', methodStart);
        let braceCount = 0;
        let methodEnd = -1;
        let started = false;
        for (let i = methodStart; i < gameCode.length; i++) {
            if (gameCode[i] === '{') { braceCount++; started = true; }
            if (gameCode[i] === '}') { 
                braceCount--; 
                if (started && braceCount === 0) { methodEnd = i + 1; break; }
            }
        }
        if (methodEnd !== -1) {
            gameCode = gameCode.substring(0, methodStart) + gameCode.substring(methodEnd);
        }
    }
});

gameCode += '\n\nexport { City3DGame };\n';
fs.writeFileSync('c:/koduu/citysimulator/game.js', gameCode);

// 4. main.js (Extract initialization code)
let indexHtml = fs.readFileSync('c:/koduu/citysimulator/index.html', 'utf8');
const scriptStart = indexHtml.indexOf('<script>\n        window.addEventListener(\'DOMContentLoaded\', () => {');
const scriptEnd = indexHtml.indexOf('</script>\n</body>');
if (scriptStart !== -1 && scriptEnd !== -1) {
    let mainScript = indexHtml.substring(scriptStart + 8, scriptEnd).trim();
    mainScript = `import { City3DGame } from './game.js';\n\n` + mainScript;
    fs.writeFileSync('c:/koduu/citysimulator/main.js', mainScript);
}
