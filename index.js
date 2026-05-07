const gameOptions = {
    playerSpeed: 500,
    collisionCooldown: 60,
    initialHearts: 5,
    mapWidth: 800,
    mapHeight: 800,
    restartTimer: 3000,
    spawnTimer: 1500,
    answerTimer: 2500,
}

window.onload = () => {
    let config = {
        type: Phaser.AUTO,
        width: gameOptions.mapWidth,
        height: gameOptions.mapHeight,
        backgroundColor: '#5af',
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: {
                debug: false
            }
        },
        scene: Game
    }
    new Phaser.Game(config)
}

/**
 * Represents a collectible item (gift) in the game
 * Emits a player collide event based on internal cooldown
 * Cooldown was initially used for preventing sound overlap, now it's useless
 */
class GameObject extends Phaser.Physics.Arcade.Image {
    constructor(scene, x, y, texture, name) {
        super(scene, x, y, texture)
        scene.add.existing(this)

        this.name = name
        this.cooldown = gameOptions.collisionCooldown
    }

    onPlayerCollision() {
        if (this.cooldown > 0) return
        this.emit('collision', this.name)
        this.destroy()
    }
}

/**
 * Implements a single scene full game loop
 */
class Game extends Phaser.Scene {

    constructor() {
        super('Game')
        window.ref = this
    }

    init() {
        this.score = 0
    }

    preload() {
        this.load.pack('main', 'assets/assets.json')
        this.load.json('gameData', 'assets/game_data.json')
    }

    create(sx, sy) {
        const setUpWorld = () => {
            this.cameras.main.fadeIn(2000)
            this.cursors = this.input.keyboard.createCursorKeys()
            this.add.image(0, 0, 'background').setOrigin(0).setScale(0.7)
            this.gameData = this.cache.json.get('gameData')
            this.objectOrder = []
            this.cooldown = 0
        }

        const setUpPlayer = () => {
            this.player = this.physics.add.sprite(400, 400, 'playerIcon')
            this.player.setScale(0.3)
            this.player.body.setCircle(175, this.player.width / 2 - 175, this.player.height / 2 - 175)
            this.player.setCollideWorldBounds(true)
            this.player.rotateAngle = 0.5
        }

        const setUpScore = () => {
            this.scoreText = this.add.text(90, 25, this.score, {fontSize: '60px', fill: '#000'})
            this.scoreIcon = this.add.image(50, 50, 'starIcon')
            this.scoreIcon.setScale(0.3)
        }

        const setUpHearts = () => {
            this.hearts = []
            for (let i = 0; i < gameOptions.initialHearts; i++) {
                const heart = this.add.image(gameOptions.mapWidth - i * 60 - 50, 50, 'heartIcon')
                heart.setScale(0.1)
                this.hearts.push(heart)
            }
            this.events.on('heartLost', () => {
                const lostHeart = this.hearts.pop()
                lostHeart.destroy()
                this.sound.play('heartLost')
                if (this.hearts.length === 0) this.setGameOverOverlay()
            }, this)
        }

        const setUpObjects = () => {
            this.objects = this.physics.add.staticGroup()
            for (let i = 0; i < 3; i++) {
                this.spawnObject()
            }

            this.objects.spawnTimer = this.time.addEvent({
                callback: this.spawnObject,
                callbackScope: this,
                delay: gameOptions.spawnTimer,
                loop: true
            })

            this.objects.overlapCheck = this.physics.add.overlap(
                this.player, this.objects, (player, object) => {object.onPlayerCollision()}
            )
        }

        setUpWorld()
        setUpPlayer()
        setUpScore()
        setUpHearts()
        setUpObjects()
    }

    update() {
        const playerMovemenet = () => {
            this.player.setVelocity(0)
            if (this.cursors.left.isDown) {
                this.player.setVelocityX(-gameOptions.playerSpeed)
            } else if (this.cursors.right.isDown) {
                this.player.setVelocityX(gameOptions.playerSpeed)
            }
            if (this.cursors.up.isDown) {
                this.player.setVelocityY(-gameOptions.playerSpeed)
            } else if (this.cursors.down.isDown) {
                this.player.setVelocityY(gameOptions.playerSpeed)
            }
        }

        playerMovemenet()
        this.objects.children.iterate(obj => {obj.cooldown--})
        this.cooldown--
        this.player.angle += this.player.rotateAngle

    }

    /**
     * Creates and adds a new GameObject to the scene
     */
    spawnObject() {
        if (this.objectOrder.length === 0) {
            this.objectOrder = Phaser.Utils.Array.Shuffle(Object.keys(this.gameData.gameObjects))
        }
        const objectName = this.objectOrder.pop()
        // non-deterministic way to avoid spawning on the player
        let x, y
        do {x = Phaser.Math.Between(40, gameOptions.mapWidth - 40)
            y = Phaser.Math.Between(120, gameOptions.mapHeight - 30)
        } while (Math.abs(x - this.player.x) < 120 && Math.abs(y - this.player.y) < 120)

        const newObject = new GameObject(this, x, y, 'giftIcon', objectName)
        this.objects.add(newObject)
        newObject.setSize(75, 60)
        newObject.setScale(0.3)
        newObject.on('collision', this.handleCollision, this)
    }

    /**
     * Handles the collision event emitted by GameObject
     *      - pauses interactions
     *      - calls the question overlay
     *      - resumes interactions on the answerResolved event
     */
    handleCollision(objectName) {
        if (this.cooldown > 0) return
        this.cooldown = gameOptions.collisionCooldown
        this.objects.overlapCheck.active = false
        this.objects.spawnTimer.paused = true

        this.sound.play(objectName + 'Sound')
        this.player.rotateAngle *= -1

        this.setQuestionOverlay(objectName)
        this.events.once('answerResolved', () => {
            if (this.hearts.length > 0) {
                this.scoreText.setText(this.score)
                this.objects.spawnTimer.paused = false
                this.time.addEvent({delay: 500, callback: () => {this.objects.overlapCheck.active = true} , callbackScope: this})
            }
        })

    }

    /**
     * Prepares an interactive question overlay with answer zones
     *      - prepares answer zones
     *      - creates the evaluate answer event
     *      - cleans up overlay objects
     */
    setQuestionOverlay(objectName) {
        const pickedQuestionSet = this.gameData.questionSets[this.gameData.gameObjects[objectName].questionSet]

        // prepare answer zones
        const optionAreaA = this.add.rectangle(
            gameOptions.mapWidth / 4, gameOptions.mapHeight / 2,
            gameOptions.mapWidth / 2, gameOptions.mapHeight, '0xff004d', 0.7
        )
        this.physics.add.existing(optionAreaA, true)
        const optionIconA = this.add.image(gameOptions.mapWidth / 4, 75, pickedQuestionSet[0] + 'Icon')
        optionIconA.setScale(0.12)

        const optionAreaB = this.add.rectangle(
            gameOptions.mapWidth * 3 / 4, gameOptions.mapHeight / 2,
            gameOptions.mapWidth / 2, gameOptions.mapHeight, '0x00e436', 0.7
        )
        this.physics.add.existing(optionAreaB, true)
        const optionIconB = this.add.image(gameOptions.mapWidth * 3 / 4, 75, pickedQuestionSet[1] + 'Icon')
        optionIconB.setScale(0.12)

        // prepare evaluate answer event
        const evaluateAnswer = () => {
            const isInA = this.physics.world.overlap(this.player, optionAreaA)
            const isInB = this.physics.world.overlap(this.player, optionAreaB)
            if (isInA !== isInB) { // only one is true
                const expectedAnswer = isInA ? 0 : 1
                if (expectedAnswer === this.gameData.gameObjects[objectName].answer) {
                    this.score++
                    this.sound.play('pointGain')
                }
                else this.events.emit('heartLost')
            }
            this.events.emit('answerResolved')
        }
        this.time.addEvent({delay: gameOptions.answerTimer, callback: evaluateAnswer, callbackScope: this})

        // clean up
        this.events.once('answerResolved', () => {
            optionAreaA.destroy()
            optionAreaB.destroy()
            optionIconA.destroy()
            optionIconB.destroy()
        })
    }

    /**
     * Sets the game over overlay and restarts the game
     */
    setGameOverOverlay() {
        // prepare ending screen UI
        this.add.rectangle(
            gameOptions.mapWidth / 2, gameOptions.mapHeight / 2,
            gameOptions.mapWidth / 1.5, gameOptions.mapHeight / 4.5, '0x000000', 0.7
        )
        this.add.text(
            gameOptions.mapWidth / 2,
            gameOptions.mapHeight / 2 - 20,
            'GAME OVER',
            { fontSize: '64px', color: '#ffffff', fontStyle: 'bold' }
        ).setOrigin(0.5)

        this.add.text(
            gameOptions.mapWidth / 2,
            gameOptions.mapHeight / 2 + 35,
            `Final Score: ${this.score}`,
            { fontSize: '32px', color: '#ffcc00' }
        ).setOrigin(0.5)

        // clear other objects
        this.objects.clear(true, true)
        this.scoreText.destroy()
        this.scoreIcon.destroy()
        this.events.removeAllListeners('heartLost')

        // restart
        this.time.delayedCall(gameOptions.restartTimer, () => {
            this.scene.start('Game')
        })
    }
}
