// Phaser 3 City Builder Mini-Game
// Simple, clean structure. Uses colored rectangles for buildings.


const GRID_SIZE = 5;
const CELL_SIZE = 64;
const BUILDING_COST = 50;
const COIN_INCREMENT = 10;

class CityBuilderScene extends Phaser.Scene {
    constructor() {
        super('CityBuilder');
        this.coins = 0;
        this.buildings = [];
    }

    preload() {
        // No assets needed for rectangles
    }

    create() {
        // Coin counter text
        this.coinText = this.add.text(20, 20, 'Coins: 0', {
            fontSize: '24px', color: '#fff', backgroundColor: '#222', padding: { x: 10, y: 5 }
        });

        // Get Coins button
        this.getCoinsBtn = this.add.text(20, 60, 'Get Coins (+10)', {
            fontSize: '20px', color: '#fff', backgroundColor: '#007bff', padding: { x: 10, y: 5 }
        }).setInteractive();
        this.getCoinsBtn.on('pointerdown', () => {
            this.coins += COIN_INCREMENT;
            this.updateUI();
        });

        // Buy Building button
        this.buyBuildingBtn = this.add.text(180, 60, 'Buy Building (-50)', {
            fontSize: '20px', color: '#fff', backgroundColor: '#28a745', padding: { x: 10, y: 5 }
        }).setInteractive();
        this.buyBuildingBtn.on('pointerdown', () => {
            if (this.coins >= BUILDING_COST && this.buildings.length < GRID_SIZE * GRID_SIZE) {
                this.coins -= BUILDING_COST;
                this.addBuilding();
                this.updateUI();
            }
        });

        // Draw city grid
        this.gridOrigin = { x: 20, y: 120 };
        this.drawGrid();
    }

    updateUI() {
        this.coinText.setText(`Coins: ${this.coins}`);
    }

    drawGrid() {
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x888888, 1);
        for (let i = 0; i <= GRID_SIZE; i++) {
            // Vertical lines
            graphics.lineBetween(
                this.gridOrigin.x + i * CELL_SIZE,
                this.gridOrigin.y,
                this.gridOrigin.x + i * CELL_SIZE,
                this.gridOrigin.y + GRID_SIZE * CELL_SIZE
            );
            // Horizontal lines
            graphics.lineBetween(
                this.gridOrigin.x,
                this.gridOrigin.y + i * CELL_SIZE,
                this.gridOrigin.x + GRID_SIZE * CELL_SIZE,
                this.gridOrigin.y + i * CELL_SIZE
            );
        }
    }

    addBuilding() {
        const idx = this.buildings.length;
        const row = Math.floor(idx / GRID_SIZE);
        const col = idx % GRID_SIZE;
        const x = this.gridOrigin.x + col * CELL_SIZE + 8;
        const y = this.gridOrigin.y + row * CELL_SIZE + 8;
        // Draw a colored rectangle as a building
        const building = this.add.rectangle(x, y, CELL_SIZE - 16, CELL_SIZE - 16, 0xffcc00).setOrigin(0);
        this.buildings.push(building);
    }
}

const config = {
    type: Phaser.AUTO,
    width: 400,
    height: 500,
    backgroundColor: '#333',
    parent: 'game-container',
    scene: CityBuilderScene
};

window.addEventListener('DOMContentLoaded', () => {
    new Phaser.Game(config);
});
