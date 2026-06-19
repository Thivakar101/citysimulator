import { City3DGame } from './game/City3DGame.js';

const startGame = () => {
    const statusEl = document.getElementById('status');
    const showError = (msg) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.display = 'block';
    };

    try {
        const game = new City3DGame({
            containerId: 'game-container',
            gridSize: 5,
            cellSize: 6,
            buildingCost: 50,
            coinIncrement: 50
        });

        game._updateUI();
        game.introCinematic?.();
        window.citySimulator = game;
    } catch (e) {
        console.error(e);
        showError('Oops! Something went wrong: ' + e.message);
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startGame);
} else {
    startGame();
}
