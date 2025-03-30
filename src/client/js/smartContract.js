import { ethers } from 'ethers';
import { io } from 'socket.io-client';

// Base URL for API and Socket.IO (use environment variables in production)
const API_BASE_URL = 'https://rcadya-app-dee7ef0f2cc9.herokuapp.com';
const WS_BASE_URL = 'https://rcadya-app-dee7ef0f2cc9.herokuapp.com';

// Store the token in localStorage with validation
function getToken() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    // Validation: Check if token is JWT (3 parts separated by dots)
    if (token.split('.').length !== 3) {
        console.warn('Invalid token format. Clearing token.');
        localStorage.removeItem('token');
        return null;
    }
    return token;
}

function setToken(newToken) {
    if (newToken && newToken.split('.').length === 3) {
        localStorage.setItem('token', newToken);
        return newToken;
    }
    console.warn('Invalid token format. Not storing token.');
    return null;
}

let token = getToken();

// Token refresh rate limiting state
const MAX_REFRESH_ATTEMPTS = 3;
const REFRESH_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown
let refreshAttempts = 0;
let lastRefreshTime = 0;

// Fetch contract details from RCADYA with authentication
async function getSmartContractDetails() {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to log in.'
            });
        }
        const response = await fetch(`${API_BASE_URL}/api/v1/smart-contract/details`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.status === 401) {
            throw Object.assign(new Error('Authentication token expired or invalid. Please login again.'), {
                userMessage: 'Your session has expired. Please reconnect your wallet.'
            });
        }
        if (!response.ok) {
            throw Object.assign(new Error(`Failed to get contract details from server: ${response.statusText}`), {
                userMessage: 'Unable to fetch contract details. Please try again later.'
            });
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting Smart Contract details:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Initialize contract with ethers.js
let provider, signer, contract, isMockContract = false;
async function initializeContract() {
    try {
        if (!window.ethereum) {
            throw Object.assign(new Error('MetaMask is not installed.'), {
                userMessage: 'Please install MetaMask to use this feature.'
            });
        }
        const { address: contractAddress, abi: contractAbi, isMock } = await getSmartContractDetails();
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        contract = new ethers.Contract(contractAddress, contractAbi, signer);
        isMockContract = isMock; // Store mock status globally
        console.log(`Smart Contract initialized at ${contractAddress}${isMock ? ' (Mock Contract)' : ''}`);
        if (isMock) {
            console.warn('Using mock contract. Transactions will not affect real funds.');
        }
        return contract;
    } catch (error) {
        console.error('Error initializing Smart Contract:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Login function to get authentication token
async function login() {
    try {
        if (!window.ethereum) {
            throw Object.assign(new Error('MetaMask is not installed.'), {
                userMessage: 'Please install MetaMask to log in.'
            });
        }
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const walletAddress = (await signer.getAddress()).toLowerCase();

        // Request nonce
        const nonceResponse = await fetch(`${API_BASE_URL}/api/v1/auth/nonce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress })
        });
        if (!nonceResponse.ok) {
            throw Object.assign(new Error(`Failed to get nonce: ${nonceResponse.statusText}`), {
                userMessage: 'Unable to authenticate. Please try again.'
            });
        }
        const { nonce } = await nonceResponse.json();

        // Sign the nonce
        const signature = await signer.signMessage(nonce);

        // Login to get token
        const loginResponse = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress, signature, message: nonce })
        });
        if (!loginResponse.ok) {
            throw Object.assign(new Error(`Login failed: ${loginResponse.statusText}`), {
                userMessage: 'Login failed. Please check your wallet and try again.'
            });
        }
        const { token: newToken } = await loginResponse.json();
        token = setToken(newToken);
        // Reset refresh attempts on successful login
        refreshAttempts = 0;
        lastRefreshTime = Date.now();
        return token;
    } catch (error) {
        console.error('Login error:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Map contract Game-type enum to string representation (shared with Backend)
function getGameTypeString(gameTypeNumber) {
    const gameTypes = ['MultiPlayer', 'OneVsOne', 'NotOursMultiplayer', 'NotOurs1vs1'];
    return gameTypes[gameTypeNumber] || 'Unknown';
}

// Helper function to handle API calls with token refresh
async function fetchWithTokenRefresh(url, options, retryFn) {
    try {
        const response = await fetch(url, options);
        if (response.status === 401) {
            const now = Date.now();
            if (refreshAttempts >= MAX_REFRESH_ATTEMPTS || (now - lastRefreshTime < REFRESH_COOLDOWN_MS)) {
                throw Object.assign(new Error('Token refresh limit reached or cooldown active.'), {
                    userMessage: 'Too many login attempts. Please wait a minute and try again.'
                });
            }
            console.log('Token expired, attempting to refresh...');
            refreshAttempts++;
            await login(); // Refresh token
            lastRefreshTime = now;
            if (!token) {
                throw Object.assign(new Error('Failed to refresh authentication token.'), {
                    userMessage: 'Unable to refresh your session. Please reconnect your wallet.'
                });
            }
            // Retry with new token
            options.headers['Authorization'] = `Bearer ${token}`;
            const retryResponse = await fetch(url, options);
            if (!retryResponse.ok) {
                throw Object.assign(new Error(`Retry failed: ${retryResponse.statusText}`), {
                userMessage: 'Operation failed after refreshing session. Please try again.'
                });
            }
            return retryResponse;
        }
        if (!response.ok) {
            throw Object.assign(new Error(`Request failed: ${response.statusText}`), {
                userMessage: 'An error occurred. Please try again later.'
            });
        }
        return response;
    } catch (error) {
        console.error(`Error in fetchWithTokenRefresh for ${url}:`, error);
        throw error;
    }
}

// Place a bet on GamePool Smart Contract
async function placeBet(betValue, gameId) {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to place an amount.'
            });
        }
        if (!Number.isInteger(gameId) || gameId < 0) {
            throw Object.assign(new Error('Invalid gameId. Must be a non-negative integer.'), {
                userMessage: 'Invalid game ID. Please select a valid game.'
            });
        }
        // Validate betValue against allowed values (in USDC)
        const allowedBetValues = [0.10, 0.20, 1, 3, 5];
        if (!allowedBetValues.includes(betValue)) {
            throw Object.assign(new Error(`Invalid betValue. Must be one of ${allowedBetValues.join(', ')} USDC.`), {
                userMessage: `Please select a valid amount: ${allowedBetValues.join(', ')} USDC.`
            });
        }

        if (!contract) {
            await initializeContract();
        }

        const gameTypeNumber = await contract.gameTypes(gameId);
        if (gameTypeNumber.toString() === '0' && gameId !== 0) {
            throw Object.assign(new Error(`Game ID ${gameId} is not registered in the Smart Contract.`), {
                userMessage: 'This game is not available for placing an amount.'
            });
        }
        const gameType = getGameTypeString(gameTypeNumber);

        const betValueInMicroUSDC = ethers.utils.parseUnits(betValue.toString(), 6);
        const tx = await contract.placeBet(betValueInMicroUSDC, gameId);
        console.log('Transaction sent:', tx.hash);

        if (isMockContract) {
            console.log('Mock contract: Simulating amount placement without real funds.');
        }

        const receipt = await tx.wait();
        console.log('Transaction confirmed:', tx.hash);

        const betPlacedEvent = receipt.events.find(e => e.event === 'BetPlaced');
        if (!betPlacedEvent) {
            throw Object.assign(new Error('Failed to retrieve matchId from BetPlaced event.'), {
                userMessage: 'Amount placed, but unable to confirm match details. Please try again.'
            });
        }
        const matchId = betPlacedEvent.args.matchId.toString();

        const walletAddress = (await signer.getAddress()).toLowerCase();
        // Fetch updated match summary after the bet is placed to ensure totalPool is correct
        const matchSummary = await contract.getMatchSummary(matchId);
        const totalPool = matchSummary.totalPool.toString(); // micro-USDC

        const matchData = {
            match_id: matchId,
            gameId,
            bet_amount: betValueInMicroUSDC.toString(), // micro-USDC
            totalPool, // Ensure totalPool reflects the updated value after the bet
            gameType,
            players: [walletAddress],
            rankings: [],
            status: 'waiting'
        };

        const response = await fetchWithTokenRefresh(
            `${API_BASE_URL}/api/v1/matches/save-match`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(matchData)
            }
        );

        const result = await response.json();
        console.log('Match saved:', result);

        // Poll the backend to confirm the match is synced
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            const checkResponse = await fetch(`${API_BASE_URL}/api/v1/smart-contract/match-summary/${matchId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (checkResponse.ok) {
                console.log(`Match ${matchId} confirmed synced with backend after ${attempts + 1} attempts`);
                break;
            }
            console.warn(`Match ${matchId} not yet synced, retrying (${attempts + 1}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            attempts++;
        }
        if (attempts >= maxAttempts) {
            console.warn(`Match ${matchId} save not confirmed after ${maxAttempts} attempts; proceeding anyway`);
        }

        return { txHash: tx.hash, matchId };
    } catch (error) {
        console.error('Error placing amount:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Cancel a bet
async function cancelBet() {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to cancel your amount.'
            });
        }
        if (!contract) {
            await initializeContract();
        }

        const tx = await contract.cancelBet();
        console.log('Transaction sent:', tx.hash);

        if (isMockContract) {
            console.log('Mock contract: Simulating amount cancellation without real fund changes.');
        }

        await tx.wait();
        console.log('Amount canceled successfully:', tx.hash);

        return tx.hash;
    } catch (error) {
        console.error('Error canceling amount:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Claim winnings from the Smart Contract
async function claimWinnings(matchId) {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to claim your winnings.'
            });
        }
        if (!/^\d+$/.test(matchId)) {
            throw Object.assign(new Error('Invalid matchId: must be a numeric string'), {
                userMessage: 'Invalid match ID. Please provide a valid match number.'
            });
        }

        if (!contract) {
            await initializeContract();
        }

        // Check if the match exists and winnings are available
        const matchSummaryResponse = await fetchWithTokenRefresh(
            `${API_BASE_URL}/api/v1/smart-contract/match-summary/${matchId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const { data: matchData } = await matchSummaryResponse.json();
        if (!matchData) {
            throw Object.assign(new Error(`Match ${matchId} not found.`), {
                userMessage: 'This match does not exist. Please check the match ID.'
            });
        }

        const walletAddress = (await signer.getAddress()).toLowerCase();
        const winningsResponse = await fetchWithTokenRefresh(
            `${API_BASE_URL}/api/v1/smart-contract/player-winnings/${matchId}/${walletAddress}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const { winnings } = await winningsResponse.json();
        if (parseFloat(winnings) <= 0) {
            throw Object.assign(new Error('No winnings available to claim for this match.'), {
                userMessage: 'No winnings are available for this match.'
            });
        }

        const tx = await contract.claimWinnings(matchId);
        console.log('Transaction sent:', tx.hash);

        if (isMockContract) {
            console.log('Mock contract: Simulating winnings claim without real fund transfer.');
        }

        await tx.wait();
        console.log('Winnings claimed successfully:', tx.hash);

        return tx.hash;
    } catch (error) {
        console.error('Error claiming winnings:', error);
        throw error; // Preserve original error for stack trace
    }
}

// Setup WebSocket for real-time updates with reconnection logic and event handling
function setupWebSocket(callbacks) {
    const socket = io(WS_BASE_URL, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 5000
    });

    socket.on('connect', () => {
        console.log('Socket.IO Connected');
        // Send authentication token if required by the Server
        if (token) {
            socket.emit('AUTH', { token });
        }
    });

    socket.on('message', (message) => {
        console.log('Socket.IO message received:', message);
        // Process all broadcasted events with specific callbacks
        switch (message.type) {
            case 'MATCH_UPDATED':
                if (callbacks.onMatchUpdated) {
                    callbacks.onMatchUpdated({
                        matchId: message.matchId,
                        status: message.status,
                        totalPool: message.totalPool, // USDC
                        players: message.players,
                        gameType: message.gameType
                    });
                }
                break;
            case 'MATCH_STARTED':
                if (callbacks.onMatchStarted) {
                    callbacks.onMatchStarted({
                        matchId: message.matchId,
                        totalPool: message.totalPool, // USDC
                        gameType: message.gameType,
                        players: message.players
                    });
                }
                break;
            case 'MATCH_COMPLETED':
                if (callbacks.onMatchCompleted) {
                    callbacks.onMatchCompleted({
                        matchId: message.matchId,
                        totalPool: message.totalPool, // USDC
                        gameType: message.gameType,
                        players: message.players
                    });
                }
                break;
            case 'WINNINGS_DISTRIBUTED':
                if (callbacks.onWinningsDistributed) {
                    callbacks.onWinningsDistributed({
                        matchId: message.matchId,
                        totalPool: message.totalPool, // USDC
                        winnings: message.winnings, // Object with walletAddress: amount (USDC)
                        platformFee: message.platformFee, // USDC
                        gameOwnerFee: message.gameOwnerFee, // USDC
                        winners: message.winners
                    });
                }
                break;
            case 'TRANSACTION_HISTORY_UPDATED':
                if (callbacks.onTransactionHistoryUpdated) {
                    callbacks.onTransactionHistoryUpdated({
                        walletAddress: message.walletAddress,
                        matches: message.matches // Array of { matchId, won, totalPool, gameType }
                    });
                }
                break;
            case 'MATCH_STATUS_UPDATE':
                if (callbacks.onMatchStatusUpdate) {
                    callbacks.onMatchStatusUpdate({
                        matchId: message.matchId,
                        status: message.status
                    });
                }
                break;
            default:
                console.warn('Unhandled Socket.IO message type:', message.type);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
    });

    socket.on('disconnect', () => {
        console.log('Socket.IO Disconnected');
    });

    return socket;
}

// Export all functions as named exports
export {
    getSmartContractDetails,
    initializeContract,
    login,
    placeBet,
    cancelBet,
    claimWinnings,
    setupWebSocket,
};
