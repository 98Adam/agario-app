// Import required modules
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

// Check if user is on mobile device
if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

// Initialize flag to track if the player has seen the Final Popup
global.hasSeenFinalPopup = false;

// Listen for messages from the game (StartPopup)
window.addEventListener("message", function(event) {
    const data = event.data;

    if (data.betConfirmed) {
        const startPopup = document.getElementById("startPopup");
        startPopup.style.display = "none";
        console.log("Selected Amount:", data.betValue);
        window.startGame('player', data.betValue);
    } else if (data.action === "closePopup") {
        console.log("Received closePopup message from finalPopup");
        const iframe = document.getElementById("finalPopup");
        iframe.style.display = "none";
        document.getElementById('gameAreaWrapper').style.opacity = 0;
        window.location.href = "https://agario-app-f1a9418e9c2c.herokuapp.com/";
    }
});

// Define startGame and expose it globally
window.startGame = function(type, betValue = 0) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    console.log("Starting Game with amount:", betValue);

    global.betValue = betValue;
    global.hasSeenFinalPopup = false;

    // Reset game state
    leaderboard = [];
    users = [];
    foods = [];
    viruses = [];
    fireFood = [];
    global.matchStartTime = Date.now();

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;

    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }
    if (!global.animLoopHandle) {
        animloop();
    }
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;

    const matchDuration = 20000;
    global.matchStartTime = Date.now();
    console.log("Match started at: " + global.matchStartTime);
    global.matchTimer = setTimeout(() => {
        socket.emit('matchEndRequest');
        console.log("Match timer expired, requesting match end");
    }, matchDuration);
};

// Check if nickname is valid alphanumerical
function validNick() {
    var regex = /^\w*$/;
    return regex.exec(playerNameInput.value) !== null;
}

window.onload = function () {
    var btn = document.getElementById('startButton');
    var startPopup = document.getElementById('startPopup');

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    btn.onclick = debounce(function () {
        if (validNick()) {
            document.querySelector('#startMenu .input-error').style.opacity = 0;
            startPopup.style.display = "block";
        } else {
            document.querySelector('#startMenu .input-error').style.opacity = 1;
        }
    }, 1000);

    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;
        if (key === global.KEY_ENTER) {
            if (validNick()) {
                document.querySelector('#startMenu .input-error').style.opacity = 0;
                startPopup.style.display = "block"; // Show popup instead of starting directly
            } else {
                document.querySelector('#startMenu .input-error').style.opacity = 1;
            }
        }
    });
};

// Player configuration
var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

// Initialize player object
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

var c = window.canvas.cv;
var graph = c.getContext('2d');

// Event handlers for split and feed actions
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
    clearTimeout(global.matchTimer);
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

// Socket event handling
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
        socket.emit('gotit', { name: player.name, betValue: global.betValue });
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

    socket.on('playerDied', (data) => {
        const playerName = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        window.chat.addSystemLine('{GAME} - <b>' + playerName + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                status += '<span class="me">' + (i + 1) + '. ' + (leaderboard[i].name || 'An unnamed cell') + "</span>";
            } else {
                status += (i + 1) + '. ' + (leaderboard[i].name || 'An unnamed cell');
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
        if (global.playerType == 'player') {
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

    socket.on('RIP', function (data) {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);
        const currentPosition = leaderboard.findIndex(p => p.id === player.id) + 1 || data.position || 0;
        const betAmount = global.betValue || 0;
        const wonAmount = global.wonAmount || 0;
        const gasFee = global.gasFee || 0;
        showFinalPopup(currentPosition, betAmount, wonAmount, gasFee);
        global.hasSeenFinalPopup = true;
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
        clearTimeout(global.matchTimer);
        render.drawErrorMessage(reason ? 'You were kicked for: ' + reason : 'You were kicked!', graph, global.screen);
        socket.close();
    });

    socket.on('matchOver', function (data) {
        global.gameStart = false;
        clearTimeout(global.matchTimer);
        if (!global.hasSeenFinalPopup) {
            const { winners, position, betAmount, wonAmount, gasFee } = data;
            let resultMessage = 'Match Over!\n';
            if (winners.length > 0) resultMessage += `1st: ${winners[0].name} (Mass: ${winners[0].mass})\n`;
            if (winners.length > 1) resultMessage += `2nd: ${winners[1].name} (Mass: ${winners[1].mass})\n`;
            if (winners.length > 2) resultMessage += `3rd: ${winners[2].name} (Mass: ${winners[2].mass})\n`;
            render.drawErrorMessage(resultMessage, graph, global.screen);
            const currentPosition = leaderboard.findIndex(p => p.id === player.id) + 1 || position;
            showFinalPopup(currentPosition, betAmount, wonAmount, gasFee);
            global.hasSeenFinalPopup = true;
        }
        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
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
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function () {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor || '#f2fbff';
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            let position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
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

        var cellsToDraw = [];
        for (var i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (var j = 0; j < users[i].cells.length; j++) {
                cellsToDraw.push({
                    color: color,
                    borderColor: borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2
                });
            }
        }
        cellsToDraw.sort((obj1, obj2) => obj1.mass - obj2.mass);
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState || 0, borders, graph);

        if (global.matchStartTime) {
            const matchDuration = 20000;
            const elapsed = Date.now() - global.matchStartTime;
            const remaining = Math.max(0, matchDuration - elapsed);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const timerText = `Time Left: ${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
            graph.font = '20px Arial';
            graph.fillStyle = '#000000';
            graph.fillText(timerText, 80, 25);
            console.log("Drawing timer: " + timerText);
        }

        socket.emit('0', window.canvas.target);
    }
}

function showFinalPopup(position, betAmount, wonAmount, gasFee = null) {
    const iframe = document.getElementById("finalPopup");
    iframe.style.display = "block";
    iframe.contentWindow.postMessage({
        position: position,
        betAmount: betAmount,
        wonAmount: wonAmount,
        gasFee: gasFee
    }, "*");
}

window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;
    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;
    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}
