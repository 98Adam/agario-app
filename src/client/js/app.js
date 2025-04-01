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

// Listen for messages from the game
window.addEventListener("message", function(event) {
    const data = event.data;

    if (data.betConfirmed) {
        const startPopup = document.getElementById("startPopup");

        // Hide the iframe
        startPopup.style.display = "none";

        // Start the game with the selected bet value
        console.log("Selected Amount:", data.betValue);
        startGame('player', data.betValue);  // Pass bet value to startGame
    }
});

function startGame(type, betValue) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    console.log("Starting Game with amount:", betValue); // Use betValue as needed

    // Remaining existing code in startGame...
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

    // Start 20-second timer (20,000 milliseconds) for testing
    const matchDuration = 20000; // 20 seconds in milliseconds
    global.matchStartTime = Date.now(); // Record start time
    console.log("Match started at: " + global.matchStartTime); // Debug start time
    global.matchTimer = setTimeout(() => {
        // Emit event to server to end the match
        socket.emit('matchEndRequest');
        console.log("Match timer expired, requesting match end");
    }, matchDuration);
}

// Check if nickname is valid alphanumerical
function validNick() {
    var regex = /^\w*$/;
    return regex.exec(playerNameInput.value) !== null;
}

// Removed checkMetaMaskConnection and connectMetaMask functions since index.html handles wallet connection

window.onload = function () {
    var btn = document.getElementById('startButton');
    var startPopup = document.getElementById('startPopup'); // Reference to StartPopup iframe

    // Debounce function to prevent rapid clicks
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    btn.onclick = debounce(function () {
        if (validNick()) {
            // Hide error message
            document.querySelector('#startMenu .input-error').style.opacity = 0;

            // Wallet connection is handled by index.html's startButton.onclick handler
            // Simply show the startPopup, which will be triggered after wallet connection
            startPopup.style.display = "block";
        } else {
            document.querySelector('#startMenu .input-error').style.opacity = 1;
        }
    }, 1000);

    // Settings Menu toggle
    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');

    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    // Handle pressing "Enter" key to start the game
    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;

        if (key === global.KEY_ENTER) {
            if (validNick()) {
                document.querySelector('#startMenu .input-error').style.opacity = 0;
                startGame('player');
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

// Event listeners for UI elements
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
    clearTimeout(global.matchTimer); // Stop timer if disconnected
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

// Socket event handling
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle connection and errors.
    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    // On welcome, initialize player
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

    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        window.chat.addSystemLine('{GAME} - <b>' + player + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    // Handle Leaderboard Updates
    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name;
                else
                    status += (i + 1) + '. An unnamed cell';
            }
        }
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle Movement Updates
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

    // Player Death Handling
    socket.on('RIP', function () {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);

        // Retrieve Game Data for finalPopup
        const position = global.finalPosition || 0; // Replace with position from leaderboard
        const betAmount = global.betValue || 0; // Player's selected bet amount at game start
        const wonAmount = global.wonAmount || 0; // Amount won, based on game results
        const gasFee = global.gasFee || 0; // Gas fee, if applicable

        // Show FinalPopup with Match Results
        showFinalPopup(position, betAmount, wonAmount, gasFee);

        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    // Fixed syntax error here: removed dot from '.reason'
    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        clearTimeout(global.matchTimer); // Stop timer if kicked
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        } else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });

    // Handle match end from server
    socket.on('matchOver', function (data) {
        global.gameStart = false; // Stop game loop
        clearTimeout(global.matchTimer); // Clear timer if still active

        // Extract winners from data (assuming server sends top 3)
        const { winners, position, betAmount, wonAmount, gasFee } = data;
        let resultMessage = 'Match Over!\n';
        if (winners.length > 0) resultMessage += `1st: ${winners[0].name} (Mass: ${winners[0].mass})\n`;
        if (winners.length > 1) resultMessage += `2nd: ${winners[1].name} (Mass: ${winners[1].mass})\n`;
        if (winners.length > 2) resultMessage += `3rd: ${winners[2].name} (Mass: ${winners[2].mass})\n`;
        render.drawErrorMessage(resultMessage, graph, global.screen);

        // Show final popup with player-specific results
        showFinalPopup(position, betAmount, wonAmount, gasFee);

        // Reset UI after delay
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
    }
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
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
        }
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
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        // Draw countdown timer on canvas with background for visibility
        if (global.matchStartTime) {
            const matchDuration = 20000; // 20 seconds in milliseconds
            const elapsed = Date.now() - global.matchStartTime;
            const remaining = Math.max(0, matchDuration - elapsed);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const timerText = `Time Left: ${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;

            // Draw a semi-transparent white background for contrast
            graph.fillStyle = 'rgba(255, 255, 255, 0.7)';

            // Draw timer text in black
            graph.font = '20px Arial';
            graph.fillStyle = '#000000'; // Black text
            graph.fillText(timerText, 80, 25); // Positioned slightly to the right
            console.log("Drawing timer: " + timerText); // Debug log
        }

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

// Function to show FinalPopup with all the Match Results
function showFinalPopup(position, betAmount, wonAmount, gasFee = null) {
    const iframe = document.getElementById("finalPopup"); // Reference to FinalPopup iframe
    iframe.style.display = "block";

    // Send Match Results to the iframe
    iframe.contentWindow.postMessage({
        position: position,
        betAmount: betAmount,
        wonAmount: wonAmount,
        gasFee: gasFee
    }, "*");
}

// Hide FinalPopup when "OK" button is pressed
window.addEventListener("message", function(event) {
    if (event.data.action === "hideIframe") {
        document.getElementById("finalPopup").style.display = "none";
    }
}, false);

// Handle Screen Resize
window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}
