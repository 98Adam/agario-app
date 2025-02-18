// Import required modules
import { initializeContract, placeBet, claimReward, validateAddress } from './smartcontract.js';
import io from 'socket.io-client';
import render from './render';
import ChatClient from './chat-client';
import Canvas from './canvas';
import global from './global';

const playerNameInput = document.getElementById('playerNameInput');
let socket;
let web3; // Web3 instance
let contract; // Smart contract instance

const debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

// Check if user is on mobile device
if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

// Listen for messages from the game
window.addEventListener("message", async function (event) {
    const data = event.data;

    if (data.betConfirmed) {
        const startPopup = document.getElementById("startPopup");

        // Hide the iframe
        startPopup.style.display = "none";

        // Start the game with the selected bet value
        console.log("Selected Amount:", data.betValue);
        await startGame('player', data.betValue); // Pass bet value to startGame
    }
});

async function startGame(type, betValue) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    console.log("Starting Game with amount:", betValue);

    // Initialize Web3 and contract
    if (!web3 && window.ethereum) {
        web3 = new Web3(window.ethereum);
        try {
            contract = await initializeContract(web3);
            console.log("Smart contract initialized:", contract);
        } catch (error) {
            console.error("Failed to initialize contract:", error);
            alert("Failed to connect to the smart contract. Please try again.");
            return;
        }
    }

    // Place the bet on the smart contract
    try {
        const account = (await web3.eth.getAccounts())[0];
        validateAddress(account); // Ensure the account address is valid
        const txHash = await placeBet(contract, betValue, account);
        console.log("Bet placed successfully. Transaction hash:", txHash);
        global.currentMatchId = 1; // Placeholder; update with actual match ID logic
        global.matchType = "MultiPlayer"; // Placeholder; update with actual match type logic
        global.betValue = betValue; // Store bet value globally
    } catch (error) {
        console.error("Failed to place bet:", error);
        alert("Failed to place your bet. Please try again.");
        return;
    }

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
}

// Check if nickname is valid alphanumerical
function validNick() {
    const regex = /^\w*$/;
    return regex.exec(playerNameInput.value) !== null;
}

// Function to check MetaMask Connection
async function checkMetaMaskConnection() {
    const dAppURL = "https://agario-app-f1a9418e9c2c.herokuapp.com";
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
    const isMetaMaskBrowser = window.ethereum && window.ethereum.isMetaMask;

    if (isMobileDevice && !isMetaMaskBrowser) {
        alert(`Please copy this link and open it inside MetaMask's browser for connection:\n\n${dAppURL}`);
        return false;
    }

    if (isMetaMaskBrowser) {
        try {
            const accounts = await ethereum.request({ method: 'eth_accounts' });
            if (accounts && accounts.length > 0) {
                return true;
            } else {
                await ethereum.request({ method: 'eth_requestAccounts' });
                return true;
            }
        } catch (error) {
            console.error("Error checking MetaMask connection:", error);
            return false;
        }
    }

    if (!isMetaMaskBrowser && !isMobileDevice) {
        const confirmation = confirm("MetaMask is not installed. Do you want to download it?");
        if (confirmation) {
            window.open("https://metamask.io/download/", "_blank");
        }
        return false;
    }

    return false;
}

// Function to request MetaMask
async function connectMetaMask() {
    try {
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        return accounts.length > 0;
    } catch (error) {
        console.error("MetaMask connection failed:", error);
        return false;
    }
}

window.onload = function () {
    const btn = document.getElementById('startButton');
    const startPopup = document.getElementById('startPopup');

    btn.onclick = async function () {
        if (validNick()) {
            document.querySelector('#startMenu .input-error').style.opacity = 0;

            let isConnected = await checkMetaMaskConnection();

            if (!isConnected) {
                isConnected = await connectMetaMask();
            }

            if (isConnected) {
                startPopup.style.display = "block";
            }
        } else {
            document.querySelector('#startMenu .input-error').style.opacity = 1;
        }
    };

    const settingsMenu = document.getElementById('settingsButton');
    const settings = document.getElementById('settings');

    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    playerNameInput.addEventListener('keypress', function (e) {
        const key = e.which || e.keyCode;

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

const playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

const player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

let foods = [];
let viruses = [];
let fireFood = [];
let users = [];
let leaderboard = [];
const target = { x: player.x, y: player.y };
global.target = target;

window.canvas = new Canvas();
window.chat = new ChatClient();

const visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = settings.toggleBorder;

const showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = settings.toggleMass;

const continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = settings.toggleContinuity;

const roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = settings.toggleRoundFood;

const c = window.canvas.cv;
const graph = c.getContext('2d');

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
        const latency = Date.now() - global.startPingTime;
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
        let status = '<span class="title">Leaderboard</span>';
        for (let i = 0; i < leaderboard.length; i++) {
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

    socket.on('RIP', async function () {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);

        const position = leaderboard.findIndex(entry => entry.id === player.id) + 1 || 0;
        const betAmount = global.betValue || 0;
        const matchId = global.currentMatchId || 1; // Ensure this is tracked
        const matchType = global.matchType || "MultiPlayer"; // Ensure this is tracked

        try {
            const account = (await web3.eth.getAccounts())[0];
            const txHash = await claimReward(contract, matchId, account); // Use matchId, not position
            console.log("Reward claimed successfully. Transaction hash:", txHash);
        } catch (error) {
            console.error("Failed to claim reward:", error);
            alert("Failed to claim your reward. Please try again.");
        }

        const iframe = document.getElementById("finalPopup");
        iframe.style.display = "block";

        iframe.contentWindow.postMessage({
            position: position,
            betAmount: betAmount,
            matchId: matchId,
            matchType: matchType,
            playerId: account // Use wallet address as playerId
        }, "*");

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
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        } else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });

    socket.on('matchStarted', function() {
        document.getElementById('gameStatus').innerText = "Match started!";
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

        let cellsToDraw = [];
        for (let i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (let j = 0; j < users[i].cells.length; j++) {
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

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

// Function to show FinalPopup with all the Match Results
function showFinalPopup(position, betAmount, matchId, matchType, playerId) {
    const iframe = document.getElementById("finalPopup");
    iframe.style.display = "block";

    iframe.contentWindow.postMessage({
        position: position,
        betAmount: betAmount,
        matchId: matchId,
        matchType: matchType,
        playerId: playerId
    }, "*");
}

// Hide FinalPopup when "OK" button is pressed
window.addEventListener("message", function (event) {
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
