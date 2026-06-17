import { City3DGame } from './game/City3DGame.js';

const startGame = () => {
    const statusEl = document.getElementById('status');
    const showError = (msg) => { statusEl.textContent = msg; statusEl.style.display = 'block'; };

    try {
        const game = new City3DGame({
            containerId: 'game-container',
            gridSize: 5,
            cellSize: 6,
            buildingCost: 50,
            coinIncrement: 50
        });

        // Automatically start the game without splash
        game._updateUI();
        game.introCinematic?.();

        // Show/hide cancel button when placement active
        const cancelBtn = document.getElementById('cancelPlacement');
        const origCancelPlacement = game._cancelPlacement.bind(game);
        game._cancelPlacement = () => {
            origCancelPlacement();
            cancelBtn.classList.remove('visible');
        };
        // Monkey-patch to show cancel on selection
        const btnIds = [
            'buyRoad', 'buyHouse1', 'buyFactory', 'buyTower', 'buyShop',
            'buyHouse2', 'buyApartment', 'buyClockTower',
            'buySkyscraper', 'buyHospital', 'buyFireStation',
            'buySchool', 'buyLibrary', 'buyBakery',
            'buyTreeA', 'buyTreeB', 'buyFlowerGarden', 'buyPark'
        ];
        btnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => cancelBtn.classList.add('visible'));
        });
        cancelBtn.addEventListener('click', () => {
            game._cancelPlacement();
            cancelBtn.classList.remove('visible');
        });

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
