/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const SAT = require('sat');

const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");

let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;
// New array to store all players' final positions (including those who died)
let allPlayersPositions = [];

const Vector = SAT.Vector;

app.use(express.static(__dirname + '/../client'));

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }
});

function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data);
}

const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    socket.on('gotit', function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            // Handle duplicate names by appending a discriminator
            let baseName = clientPlayerData.name || 'Player'; // Default to 'Player' if name is empty
            let displayName;
            let discriminator;

            // If the name is empty or falsy, start with "Player#1"
            if (!clientPlayerData.name) {
                discriminator = 1; // Start at 1 for unnamed players
                displayName = `${baseName}#${discriminator}`; // Start with "Player#1"
                const existingNames = map.players.data.map(p => p.displayName || p.name);
                while (existingNames.includes(displayName)) {
                    discriminator++;
                    displayName = `${baseName}#${discriminator}`;
                }
            } else {
                // If the player provided a name, only append a discriminator if there's a conflict
                displayName = baseName;
                const existingNames = map.players.data.map(p => p.displayName || p.name);
                if (existingNames.includes(displayName)) {
                    discriminator = 2; // Start at 2 for named players
                    displayName = `${baseName}#${discriminator}`;
                    while (existingNames.includes(displayName)) {
                        discriminator++;
                        displayName = `${baseName}#${discriminator}`;
                    }
                }
            }

            clientPlayerData.name = displayName; // Update the name with the discriminator
            currentPlayer.clientProvidedData(clientPlayerData);
            currentPlayer.displayName = displayName; // Store the display name separately
            currentPlayer.betValue = clientPlayerData.betValue || 0; // Store betValue

            map.players.pushNew(currentPlayer);
            io.emit('playerJoin', { name: currentPlayer.displayName });
            console.log('Total players: ' + map.players.data.length);
        }
    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', () => {
        map.players.removePlayerByID(currentPlayer.id);
        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
        console.log('[INFO] User ' + currentPlayer.displayName + ' has respawned');
    });

    socket.on('disconnect', () => {
        map.players.removePlayerByID(currentPlayer.id);
        console.log('[INFO] User ' + currentPlayer.displayName + ' has disconnected');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.displayName });
    });

    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: _sender,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.displayName + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.displayName);
            socket.broadcast.emit('serverMSG', currentPlayer.displayName + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.displayName + ' attempted to log in with incorrect password.');
            socket.emit('serverMSG', 'Password incorrect, attempt logged.');
            loggingRepositry.logFailedLoginAttempt(currentPlayer.displayName, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.displayName === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        } else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.displayName + ' kicked successfully by ' + currentPlayer.displayName + ' for reason ' + reason);
                } else {
                    console.log('[ADMIN] User ' + player.displayName + ' kicked successfully by ' + currentPlayer.displayName);
                }
                socket.emit('serverMSG', 'User ' + player.displayName + ' was kicked by ' + currentPlayer.displayName);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Handle match end request from client
    socket.on('matchEndRequest', () => {
        console.log('[INFO] Match end requested by ' + currentPlayer.displayName);

        // Use the stored allPlayersPositions for winners (Top 3, including dead players)
        const winners = allPlayersPositions.slice(0, 3).map(player => ({
            id: player.id,
            name: player.displayName, // Use displayName directly, which is already set to Player#<number> for unnamed players
            mass: player.massTotal || 0 // Default to 0 if massTotal is undefined
        }));

        // Find the requesting player's position in allPlayersPositions
        const playerPosition = allPlayersPositions.findIndex(p => p.id === currentPlayer.id) + 1 || 0;

        // Emit 'matchOver' to all connected clients with results
        io.emit('matchOver', {
            winners: winners,
            position: playerPosition, // Player's position (1-based, based on all players including dead)
            betAmount: currentPlayer.betValue || 0, // Use the stored betValue
            wonAmount: 0, // Placeholder; add winnings logic if applicable
            gasFee: 0 // Placeholder; adjust if applicable
        });

        console.log('[INFO] Match ended. Top winners from allPlayersPositions:', winners);
    });

    // Handle movement updates from the client
    socket.on('0', (target) => {
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer) => {
    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }
        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle);
    }

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];

        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes);
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);

    map.players.handleCollisions(function (gotEaten, eater) {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);

        map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            let playerGotEaten = map.players.data[gotEaten.playerIndex];
            io.emit('playerDied', { name: playerGotEaten.displayName });

            // Calculate the player's position in the leaderboard before removing them
            const playerPosition = leaderboard.findIndex(p => p.id === playerGotEaten.id) + 1 || 0;

            // Send the position in the RIP event
            sockets[playerGotEaten.id].emit('RIP', { position: playerPosition });

            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });
};

const calculateLeaderboard = () => {
    // Calculate positions for all players (including those who died) for the final popup
    const allPlayersSorted = allPlayersPositions.concat(map.players.data).sort((a, b) => {
        // Primary sort: massTotal (descending)
        if (b.massTotal !== a.massTotal) {
            return b.massTotal - a.massTotal;
        }
        // Secondary sort: number of cells (ascending)
        return a.cells.length - b.cells.length;
    });

    // Update allPlayersPositions with the sorted list (but don't add duplicates)
    allPlayersPositions = allPlayersSorted.reduce((acc, player) => {
        if (!acc.some(p => p.id === player.id)) {
            acc.push({
                id: player.id,
                displayName: player.displayName,
                massTotal: player.massTotal,
                cells: player.cells
            });
        }
        return acc;
    }, []);

    // Calculate leaderboard for active players only
    const activePlayers = map.players.data.slice().sort((a, b) => {
        // Primary sort: massTotal (descending)
        if (b.massTotal !== a.massTotal) {
            return b.massTotal - a.massTotal;
        }
        // Secondary sort: number of cells (ascending)
        return a.cells.length - b.cells.length;
    });

    if (leaderboard.length !== activePlayers.length) {
        leaderboard = activePlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== activePlayers[i].id) {
                leaderboard = activePlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

const sendUpdates = () => {
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses);
        if (leaderboardChanged) {
            sendLeaderboard(sockets[playerData.id]);
        }
    });

    leaderboardChanged = false;
};

const sendLeaderboard = (socket) => {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}

const updateSpectator = (socketID) => {
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) {
        sendLeaderboard(sockets[socketID]);
    }
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
