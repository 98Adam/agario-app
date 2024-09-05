var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
}

// Betting Popup Function
function createBettingPopup(options, callback) {
    var modal = document.getElementById("betModal");
    var span = document.getElementsByClassName("close")[0];
    var betOptionsDiv = document.getElementById("betOptions");
    var submitBtn = document.getElementById("submitBet");

    // Clear previous options
    betOptionsDiv.innerHTML = "";

    // Add new betting options
    options.forEach(function(option) {
        var label = document.createElement('label');
        label.innerHTML = '<input type="radio" name="betAmount" value="' + option + '"> ' + option + ' USDC';
        betOptionsDiv.appendChild(label);
    });

    // Show the popup
    modal.style.display = "block";

    // Close the popup
    span.onclick = function() {
        modal.style.display = "none";
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }

    // Handle bet submission
    submitBtn.onclick = function() {
        var selectedBet = document.querySelector('input[name="betAmount"]:checked');
        if (selectedBet) {
            var betValue = selectedBet.value;
            modal.style.display = "none";
            callback(betValue);
        } else {
            alert("Please select a bet amount!");
        }
    }
}

window.onload = function () {
    var playButton = document.getElementById('startButton');
    var spectateButton = document.getElementById('spectateButton');

    // Correct: Play button should show the betting popup and start the game
    playButton.onclick = function(event) {
        event.preventDefault();
        // Show the betting popup first
        createBettingPopup([0.10, 0.20, 1, 3, 5], function(bet) {
            console.log("You placed a bet of " + bet + " USDC!");
            processBetAndStartGame(bet, 'player'); // Start the game as player after bet
        });
    };

    // Spectate button should directly start the game in spectate mode
    spectateButton.onclick = function(event) {
        event.preventDefault();
        startGame('spectator'); // No popup, just start spectating
    };
};

function processBetAndStartGame(bet) {
    console.log("Processing bet of " + bet + " USDC...");

    var btn = document.getElementById('startButton'),
        btnS = document.getElementById('spectateButton'),
        nickErrorText = document.querySelector('#startMenu .input-error');

    btnS.onclick = function () {
        startGame('spectator');
    };

    btn.onclick = function () {
        if (validNick()) {
            nickErrorText.style.opacity = 0;
            startGame('player');
        } else {
            nickErrorText.style.opacity = 1;
        }
    };

    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');

    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;
        if (key === global.KEY_ENTER) {
            if (validNick()) {
                nickErrorText.style.opacity = 0;
                startGame('player');
            } else {
                nickErrorText.style.opacity = 1;
            }
        }
    });
}

// Game settings and logic
var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = { x: player.x, y: player.y };
global.target = target;

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = settings.toggleBorder;

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = settings.toggleMass;

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = settings.toggleContinuity;

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = settings.toggleRoundFood;

var c = window.canvas.cv;
var graph = c.getContext('2d');

$("#feed").click(function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

$("#split").click(function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    socket.close();
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

function setupSocket(socket) {
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        global.player = player;
        window.chat.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
    });

    socket.on('playerDied', function (data) {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', function (data) {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', function (data) {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', function (data) {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id === player.id) {
                status += leaderboard[i].name.length !== 0 ?
                          `<span class="me">${i + 1}. ${leaderboard[i].name}</span>` :
                          `<span class="me">${i + 1}. An unnamed cell</span>`;
            } else {
                status += leaderboard[i].name.length !== 0 ?
                          `${i + 1}. ${leaderboard[i].name}` :
                          `${i + 1}. An unnamed cell`;
            }
        }
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList) {
        if (global.playerType === 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    socket.on('RIP', function () {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);

        // Get the player's position in the leaderboard
        const position = leaderboard.findIndex(entry => entry.id === player.id) + 1;
        const betAmount = 1; // Example: Replace with the actual bet amount for this match
        const matchId = global.matchId || 'unknown'; // Replace with actual match ID if available

        // Trigger the match over pop-up
        showMatchOverPopup(position, betAmount, matchId);

        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        render.drawErrorMessage(reason !== '' ? `You were kicked for: ${reason}` : 'You were kicked!', graph, global.screen);
        socket.close();
    });
}

const isUnnamedCell = (name) => name.length < 1;

const getPosition = (entity, player, screen) => {
    return {
        x: entity.x - player.x + screen.width / 2,
        y: entity.y - player.y + screen.height / 2
    };
};

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
           window.webkitRequestAnimationFrame ||
           window.mozRequestAnimationFrame ||
           window.msRequestAnimationFrame ||
           function (callback) {
               window.setTimeout(callback, 1000 / 60);
           };
})();

window.cancelAnimFrame = (function () {
    return window.cancelAnimationFrame || window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);

        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });

        fireFood.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFireFood(position, food, playerConfig, graph);
        });

        viruses.forEach(virus => {
            let position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });

        let borders = {
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        };

        if (global.borderDraw) {
            render.drawBorder(borders, graph);
        }

        let cellsToDraw = users.flatMap(user => {
            let color = `hsl(${user.hue}, 100%, 50%)`;
            let borderColor = `hsl(${user.hue}, 100%, 45%)`;
            return user.cells.map(cell => ({
                color,
                borderColor,
                mass: cell.mass,
                name: user.name,
                radius: cell.radius,
                x: cell.x - player.x + global.screen.width / 2,
                y: cell.y - player.y + global.screen.height / 2
            }));
        });

        cellsToDraw.sort((obj1, obj2) => obj1.mass - obj2.mass);
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = global.playerType === 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType === 'player' ? window.innerHeight : global.game.height;

    if (global.playerType === 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}

/** Pop-up Functions **/

function showMatchOverPopup(position, betAmount, matchId) {
    const popup = document.getElementById('matchOverPopup');
    document.getElementById('leaderboardPosition').innerText = `Your Position: ${position}`;
    document.getElementById('betAmount').innerText = `Bet Amount: ${betAmount} USDC`;
    document.getElementById('wonAmount').innerText = `You Won: ${calculateWinnings(position, betAmount)} USDC`;

    // Display the popup
    popup.style.visibility = 'visible';
    popup.style.opacity = '1';
}

function closePopup() {
    const popup = document.getElementById('matchOverPopup');
    popup.style.visibility = 'hidden';
    popup.style.opacity = '0';
}

function calculateWinnings(position, betAmount) {
    if (position === 1) return betAmount * 2;
    if (position === 2) return betAmount * 1.5;
    if (position === 3) return betAmount;
    return 0;
}
