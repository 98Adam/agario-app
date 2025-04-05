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

// Timeout utility (retained for server requests)
const withTimeout = (promise, timeoutMs, errorMessage) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
    ]);
};

// Set up MetaMask event listeners to handle disconnects
function setupMetaMaskListeners(provider) {
    provider.on('disconnect', (error) => {
        console.warn('MetaMask disconnected:', error);
        provider = null;
        signer = null;
        contract = null;
        token = null;
        localStorage.removeItem('token');
        console.log('User disconnected, token cleared.');
    });

    provider.on('accountsChanged', (accounts) => {
        console.log('MetaMask accounts changed:', accounts);
        if (accounts.length === 0) {
            provider = null;
            signer = null;
            contract = null;
            token = null;
            localStorage.removeItem('token');
            console.log('No accounts connected, token cleared.');
        }
    });

    provider.on('chainChanged', (chainId) => {
        console.log('MetaMask chain changed:', chainId);
        window.location.reload();
    });
}

// Fetch contract details from RCADYA with authentication
async function getSmartContractDetails() {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to log in.'
            });
        }
        console.log('Fetching smart contract details...');
        const response = await withTimeout(
            fetch(`${API_BASE_URL}/api/v1/smart-contract/details`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }),
            10000,
            'Request to get smart contract details timed out'
        );
        if (response.status === 401) {
            throw Object.assign(new Error('Authentication token expired or invalid. Please login again.'), {
                userMessage: 'Your session has expired. Please reconnect your wallet.'
            });
        }
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to get contract details:', response.status, errorText);
            throw Object.assign(new Error(`Failed to get contract details from server: ${response.statusText}`), {
                userMessage: 'Unable to fetch contract details. Please try again later.'
            });
        }
        const data = await response.json();
        console.log('Smart contract details fetched successfully:', data);
        return data;
    } catch (error) {
        console.error('Error getting Smart Contract details:', error);
        throw error;
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
        console.log('Initializing smart contract...');
        const { address: contractAddress, abi: contractAbi, isMock } = await getSmartContractDetails();
        provider = new ethers.providers.Web3Provider(window.ethereum);
        setupMetaMaskListeners(provider);
        signer = provider.getSigner();
        const walletAddress = await signer.getAddress();
        console.log('Connected Wallet Address:', walletAddress);
        contract = new ethers.Contract(contractAddress, contractAbi, signer);
        isMockContract = isMock;
        console.log(`Smart Contract initialized at ${contractAddress}${isMock ? ' (Mock Contract)' : ''}`);
        if (isMock) {
            console.warn('Using mock contract. Transactions will not affect real funds.');
        }
        return contract;
    } catch (error) {
        console.error('Error initializing Smart Contract:', error);
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to connect your wallet to proceed.' : 'Failed to initialize contract. Please try again.'
        });
    }
}

// Login function (simplified, with detailed logging)
async function login() {
    try {
        if (!window.ethereum) {
            throw Object.assign(new Error('MetaMask is not installed.'), {
                userMessage: 'Please install MetaMask to log in.'
            });
        }
        console.log('Starting login process...');
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        setupMetaMaskListeners(provider);
        const signer = provider.getSigner();
        console.log('Requesting wallet address...');
        const walletAddress = await signer.getAddress();
        console.log('Wallet Address:', walletAddress);

        console.log('Requesting nonce from backend...');
        const nonceResponse = await withTimeout(
            fetch(`${API_BASE_URL}/api/v1/auth/nonce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress })
            }),
            10000,
            'Nonce request timed out'
        );
        if (!nonceResponse.ok) {
            const errorText = await nonceResponse.text();
            console.error('Nonce request failed:', nonceResponse.status, errorText);
            throw Object.assign(new Error(`Failed to get nonce: ${nonceResponse.statusText}`), {
                userMessage: 'Unable to authenticate. Please try again.'
            });
        }
        const { nonce } = await nonceResponse.json();
        console.log('Nonce received:', nonce);

        console.log('Requesting wallet to sign the nonce...');
        const signature = await signer.signMessage(nonce);
        console.log('Nonce signed successfully:', signature);

        console.log('Sending login request to backend...');
        const loginResponse = await withTimeout(
            fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress, signature, message: nonce })
            }),
            10000,
            'Login request timed out'
        );
        if (!loginResponse.ok) {
            const errorText = await loginResponse.text();
            console.error('Login request failed:', loginResponse.status, errorText);
            throw Object.assign(new Error(`Login failed: ${loginResponse.statusText}`), {
                userMessage: 'Login failed. Please check your wallet and try again.'
            });
        }
        const { token: newToken } = await loginResponse.json();
        console.log('Login successful, token received:', newToken);
        token = setToken(newToken);
        refreshAttempts = 0;
        lastRefreshTime = Date.now();
        return token;
    } catch (error) {
        console.error('Login error:', error);
        // Handle MetaMask-specific errors
        if (error.code === 4001) {
            throw Object.assign(error, {
                userMessage: 'You need to connect your wallet and sign the message to log in.'
            });
        }
        if (error.code === -32002) {
            throw Object.assign(error, {
                userMessage: 'A wallet request is already pending. Please check your MetaMask extension and complete or cancel the request.'
            });
        }
        throw Object.assign(error, {
            userMessage: 'Failed to log in. Please try again.'
        });
    }
}

// Map contract Game-type enum to string representation (shared with Backend)
function getGameTypeString(gameTypeNumber) {
    const gameTypes = ['MultiPlayer', 'OneVsOne', 'NotOursMultiplayer', 'NotOurs1vs1'];
    return gameTypes[gameTypeNumber] || 'Unknown';
}

// Helper function to handle API calls with token refresh 
async function fetchWithTokenRefresh(url, options) {
    try {
        console.log(`Fetching ${url}...`);
        const response = await withTimeout(
            fetch(url, options),
            10000,
            `Request to ${url} timed out`
        );
        if (response.status === 401) {
            const now = Date.now();
            if (refreshAttempts >= MAX_REFRESH_ATTEMPTS || (now - lastRefreshTime < REFRESH_COOLDOWN_MS)) {
                throw Object.assign(new Error('Token refresh limit reached or cooldown active.'), {
                    userMessage: 'Too many login attempts. Please wait a minute and try again.'
                });
            }
            console.log('Token expired, attempting to refresh...');
            refreshAttempts++;
            await login();
            lastRefreshTime = now;
            if (!token) {
                throw Object.assign(new Error('Failed to refresh authentication token.'), {
                    userMessage: 'Unable to refresh your session. Please reconnect your wallet.'
                });
            }
            options.headers['Authorization'] = `Bearer ${token}`;
            const retryResponse = await withTimeout(
                fetch(url, options),
                10000,
                `Retry request to ${url} timed out`
            );
            if (!retryResponse.ok) {
                const errorText = await retryResponse.text();
                console.error(`Retry failed for ${url}:`, retryResponse.status, errorText);
                throw Object.assign(new Error(`Retry failed: ${retryResponse.statusText}`), {
                    userMessage: 'Operation failed after refreshing session. Please try again.'
                });
            }
            console.log(`Successfully fetched ${url} after token refresh`);
            return retryResponse;
        }
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Request failed for ${url}:`, response.status, errorText);
            throw Object.assign(new Error(`Request failed: ${response.statusText}`), {
                userMessage: 'An error occurred. Please try again later.'
            });
        }
        console.log(`Successfully fetched ${url}`);
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
        const allowedBetValues = [0.10, 0.20, 1, 3, 5];
        if (!allowedBetValues.includes(betValue)) {
            throw Object.assign(new Error(`Invalid betValue. Must be one of ${allowedBetValues.join(', ')} USDC.`), {
                userMessage: `Please select a valid amount: ${allowedBetValues.join(', ')} USDC.`
            });
        }

        if (!contract) {
            await initializeContract();
        }

        console.log('Checking game type for gameId:', gameId);
        const gameTypeNumber = await contract.gameTypes(gameId);
        if (gameTypeNumber.toString() === '0' && gameId !== 0) {
            throw Object.assign(new Error(`Game ID ${gameId} is not registered in the Smart Contract.`), {
                userMessage: 'This game is not available for placing an amount.'
            });
        }
        const gameType = getGameTypeString(gameTypeNumber);
        console.log('Game type:', gameType);

        const betValueInMicroUSDC = ethers.utils.parseUnits(betValue.toString(), 6);
        console.log('Placing amount with value (micro-USDC):', betValueInMicroUSDC.toString());
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
        console.log('Match ID from BetPlaced event:', matchId);

        const walletAddress = await signer.getAddress();
        const matchSummary = await contract.getMatchSummary(matchId);
        const totalPool = matchSummary.totalPool.toString();
        console.log('Match summary totalPool (micro-USDC):', totalPool);

        const matchData = {
            match_id: matchId,
            gameId,
            bet_amount: betValueInMicroUSDC.toString(),
            totalPool,
            gameType,
            players: [walletAddress.toLowerCase()],
            rankings: [],
            status: 'waiting'
        };

        console.log('Saving match to backend:', matchData);
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

        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            console.log(`Checking match sync with backend (attempt ${attempts + 1}/${maxAttempts})...`);
            const checkResponse = await fetchWithTokenRefresh(
                `${API_BASE_URL}/api/v1/smart-contract/match-summary/${matchId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            if (checkResponse.ok) {
                console.log(`Match ${matchId} confirmed synced with backend after ${attempts + 1} attempts`);
                break;
            }
            console.warn(`Match ${matchId} not yet synced, retrying (${attempts + 1}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        if (attempts >= maxAttempts) {
            console.warn(`Match ${matchId} save not confirmed after ${maxAttempts} attempts; proceeding anyway`);
        }

        return { txHash: tx.hash, matchId };
    } catch (error) {
        console.error('Error placing amount:', error);
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to place your amount.' : error.message.includes('pending') ? 'A wallet request is already pending. Please check your MetaMask extension.' : 'Failed to place amount. Please try again.'
        });
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

        console.log('Canceling amount..');
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
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to cancel your amount.' : error.message.includes('pending') ? 'A wallet request is already pending. Please check your MetaMask extension.' : 'Failed to cancel amount. Please try again.'
        });
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

        console.log('Checking match summary for matchId:', matchId);
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
        console.log('Checking winnings for wallet:', walletAddress);
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

        console.log('Claiming winnings for matchId:', matchId);
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
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to claim your winnings.' : error.message.includes('pending') ? 'A wallet request is already pending. Please check your MetaMask extension.' : 'Failed to claim winnings. Please try again.'
        });
    }
}

// Setup WebSocket for real-time updates with reconnection logic and event handling
function setupWebSocket(callbacks) {
    console.log('Setting up WebSocket connection...');
    const socket = io(WS_BASE_URL, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 5000
    });

    socket.on('connect', () => {
        console.log('Socket.IO Connected');
        if (token) {
            socket.emit('AUTH', { token });
        }
    });

    socket.on('message', (message) => {
        console.log('Socket.IO message received:', message);
        switch (message.type) {
            case 'MATCH_UPDATED':
                if (callbacks.onMatchUpdated) {
                    callbacks.onMatchUpdated({
                        matchId: message.matchId,
                        status: message.status,
                        totalPool: message.totalPool,
                        players: message.players,
                        gameType: message.gameType
                    });
                }
                break;
            case 'MATCH_STARTED':
                if (callbacks.onMatchStarted) {
                    callbacks.onMatchStarted({
                        matchId: message.matchId,
                        totalPool: message.totalPool,
                        gameType: message.gameType,
                        players: message.players
                    });
                }
                break;
            case 'MATCH_COMPLETED':
                if (callbacks.onMatchCompleted) {
                    callbacks.onMatchCompleted({
                        matchId: message.matchId,
                        totalPool: message.totalPool,
                        gameType: message.gameType,
                        players: message.players
                    });
                }
                break;
            case 'WINNINGS_DISTRIBUTED':
                if (callbacks.onWinningsDistributed) {
                    callbacks.onWinningsDistributed({
                        matchId: message.matchId,
                        totalPool: message.totalPool,
                        winnings: message.winnings,
                        platformFee: message.platformFee,
                        gameOwnerFee: message.gameOwnerFee,
                        winners: message.winners
                    });
                }
                break;
            case 'TRANSACTION_HISTORY_UPDATED':
                if (callbacks.onTransactionHistoryUpdated) {
                    callbacks.onTransactionHistoryUpdated({
                        walletAddress: message.walletAddress,
                        matches: message.matches
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

// Export all functions
export { login, initializeContract, placeBet, cancelBet, claimWinnings, getSmartContractDetails, setupWebSocket };
