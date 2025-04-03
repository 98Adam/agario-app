import { ethers } from 'ethers';
import { io } from 'socket.io-client';

// Base URL for API and Socket.IO
const API_BASE_URL = 'https://rcadya-app-dee7ef0f2cc9.herokuapp.com';
const WS_BASE_URL = 'https://rcadya-app-dee7ef0f2cc9.herokuapp.com';

// Store the token in localStorage with validation
function getToken() {
    const token = localStorage.getItem('token');
    if (!token) return null;
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
const REFRESH_COOLDOWN_MS = 60 * 1000;
let refreshAttempts = 0;
let lastRefreshTime = 0;

// Timeout utility
const withTimeout = (promise, timeoutMs, errorMessage) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
    ]);
};

// Retry utility for wallet requests
const withRetry = async (fn, maxRetries = 3, delayMs = 1000, errorMessage = 'Operation failed') => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (error.message.includes('port closed') || error.code === -32002) {
                console.warn(`${errorMessage} (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying after ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
    throw Object.assign(lastError, { userMessage: `${errorMessage} after ${maxRetries} attempts. Please try again.` });
};

// Debounce utility to prevent rapid wallet requests
const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        return new Promise((resolve, reject) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(async () => {
                try {
                    const result = await fn(...args);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            }, delay);
        });
    };
};

// Check if MetaMask is in a pending state
async function checkMetaMaskState() {
    try {
        await withRetry(
            () => window.ethereum.request({ method: 'eth_chainId' }),
            3,
            1000,
            'MetaMask state check failed'
        );
        return true;
    } catch (error) {
        console.error('MetaMask state check failed:', error);
        if (error.code === -32002) {
            throw Object.assign(new Error('MetaMask request already pending. Please check your MetaMask extension.'), {
                userMessage: 'MetaMask is busy. Please open MetaMask, complete or cancel any pending requests, and try again.'
            });
        }
        return false;
    }
}

// Clear pending MetaMask requests (if possible)
async function clearPendingMetaMaskRequests() {
    try {
        // Attempt to get the current chain ID to ensure MetaMask is responsive
        await window.ethereum.request({ method: 'eth_chainId' });
        console.log('No pending requests detected or cleared.');
    } catch (error) {
        if (error.code === -32002) {
            console.warn('Pending MetaMask request detected. Please resolve it in the MetaMask extension.');
            throw Object.assign(new Error('Pending MetaMask request detected.'), {
                userMessage: 'A pending request was detected in MetaMask. Please open MetaMask, complete or cancel the pending request, and try again.'
            });
        }
        console.error('Error checking for pending requests:', error);
    }
}

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
        console.log('Checking wallet state before initializing contract...');
        await clearPendingMetaMaskRequests();
        await checkMetaMaskState();

        console.log('Initializing smart contract...');
        const { address: contractAddress, abi: contractAbi, isMock } = await getSmartContractDetails();
        provider = new ethers.providers.Web3Provider(window.ethereum);
        setupMetaMaskListeners(provider);
        console.log('Requesting wallet signer...');
        signer = provider.getSigner();
        console.log('Requesting wallet address...');
        const walletAddress = await withRetry(
            () => withTimeout(
                signer.getAddress().catch(err => {
                    console.error('Wallet getAddress error:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected wallet connection');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to connect to wallet');
                }),
                15000,
                'Wallet address request timed out'
            ),
            3,
            1000,
            'Failed to get wallet address'
        );
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

// Login function with debouncing
const debouncedLogin = debounce(async () => {
    try {
        if (!window.ethereum) {
            throw Object.assign(new Error('MetaMask is not installed.'), {
                userMessage: 'Please install MetaMask to log in.'
            });
        }
        console.log('Checking wallet state before login...');
        await clearPendingMetaMaskRequests();
        await checkMetaMaskState();

        console.log('Starting login process...');
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        setupMetaMaskListeners(provider);
        const signer = provider.getSigner();
        console.log('Requesting wallet address for login...');
        const walletAddress = await withRetry(
            () => withTimeout(
                signer.getAddress().catch(err => {
                    console.error('Wallet getAddress error during login:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected wallet connection');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to connect to wallet');
                }),
                15000,
                'Wallet address request timed out during login'
            ),
            3,
            1000,
            'Failed to get wallet address during login'
        );
        console.log('Wallet Address:', walletAddress);

        // Request nonce
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

        // Add a small delay before signing
        await new Promise(resolve => setTimeout(resolve, 500));

        // Sign the nonce
        console.log('Requesting wallet to sign the nonce...');
        const signature = await withRetry(
            () => withTimeout(
                signer.signMessage(nonce).catch(err => {
                    console.error('Wallet signMessage error:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected signature');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to sign message with wallet');
                }),
                30000,
                'Wallet signing timed out'
            ),
            3,
            1000,
            'Failed to sign nonce'
        );
        console.log('Nonce signed successfully:', signature);

        // Add a small delay before the login request
        await new Promise(resolve => setTimeout(resolve, 500));

        // Login to get token
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
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to sign the message to log in.' : error.message.includes('pending') ? error.userMessage : 'Failed to log in. Please try again.'
        });
    }
}, 1000);

// Wrapper for debounced login
async function login() {
    return debouncedLogin();
}

// Map contract Game-type enum to string representation
function getGameTypeString(gameTypeNumber) {
    const gameTypes = ['MultiPlayer', 'OneVsOne', 'NotOursMultiplayer', 'NotOurs1vs1'];
    return gameTypes[gameTypeNumber] || 'Unknown';
}

// Helper function to handle API calls with token refresh and retries
async function fetchWithTokenRefresh(url, options, maxRetries = 2) {
    let attempts = 0;
    let lastError;

    while (attempts <= maxRetries) {
        try {
            console.log(`Fetching ${url} (attempt ${attempts + 1}/${maxRetries + 1})...`);
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
                continue;
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
            lastError = error;
            attempts++;
            if (attempts > maxRetries) {
                console.error(`Failed to fetch ${url} after ${maxRetries + 1} attempts:`, error);
                throw error;
            }
            const delay = Math.pow(2, attempts) * 1000;
            console.warn(`Fetch failed for ${url}, retrying after ${delay}ms...`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Place a bet on GamePool Smart Contract with debouncing
const debouncedPlaceBet = debounce(async (betValue, gameId) => {
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
        const gameTypeNumber = await withRetry(
            () => withTimeout(
                contract.gameTypes(gameId),
                10000,
                'Failed to fetch game type from smart contract: request timed out'
            ),
            3,
            1000,
            'Failed to fetch game type'
        );
        if (gameTypeNumber.toString() === '0' && gameId !== 0) {
            throw Object.assign(new Error(`Game ID ${gameId} is not registered in the Smart Contract.`), {
                userMessage: 'This game is not available for placing an amount.'
            });
        }
        const gameType = getGameTypeString(gameTypeNumber);
        console.log('Game type:', gameType);

        const betValueInMicroUSDC = ethers.utils.parseUnits(betValue.toString(), 6);
        console.log('Placing bet with value (micro-USDC):', betValueInMicroUSDC.toString());

        // Add a small delay before the transaction
        await new Promise(resolve => setTimeout(resolve, 500));

        const tx = await withRetry(
            () => withTimeout(
                contract.placeBet(betValueInMicroUSDC, gameId).catch(err => {
                    console.error('Wallet placeBet error:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected transaction');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to place bet with wallet');
                }),
                60000,
                'Wallet transaction confirmation timed out'
            ),
            3,
            1000,
            'Failed to place bet'
        );
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
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to place your amount.' : error.message.includes('pending') ? error.userMessage : 'Failed to place amount. Please try again.'
        });
    }
}, 1000);

// Wrapper for debounced placeBet
async function placeBet(betValue, gameId) {
    return debouncedPlaceBet(betValue, gameId);
}

// Cancel a bet with debouncing
const debouncedCancelBet = debounce(async () => {
    try {
        if (!token) {
            throw Object.assign(new Error('No authentication token available. Please login first.'), {
                userMessage: 'Please connect your wallet to cancel your amount.'
            });
        }
        if (!contract) {
            await initializeContract();
        }

        console.log('Canceling bet...');
        await new Promise(resolve => setTimeout(resolve, 500));

        const tx = await withRetry(
            () => withTimeout(
                contract.cancelBet().catch(err => {
                    console.error('Wallet cancelBet error:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected transaction');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to cancel bet with wallet');
                }),
                60000,
                'Wallet transaction confirmation for cancelBet timed out'
            ),
            3,
            1000,
            'Failed to cancel bet'
        );
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
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to cancel your amount.' : error.message.includes('pending') ? error.userMessage : 'Failed to cancel amount. Please try again.'
        });
    }
}, 1000);

// Wrapper for debounced cancelBet
async function cancelBet() {
    return debouncedCancelBet();
}

// Claim winnings from the Smart Contract with debouncing
const debouncedClaimWinnings = debounce(async (matchId) => {
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
        await new Promise(resolve => setTimeout(resolve, 500));

        const tx = await withRetry(
            () => withTimeout(
                contract.claimWinnings(matchId).catch(err => {
                    console.error('Wallet claimWinnings error:', err);
                    if (err.code === 4001) {
                        throw new Error('User rejected transaction');
                    }
                    if (err.code === -32002) {
                        throw new Error('Wallet request already pending. Please check your MetaMask extension.');
                    }
                    throw new Error('Failed to claim winnings with wallet');
                }),
                60000,
                'Wallet transaction confirmation for claimWinnings timed out'
            ),
            3,
            1000,
            'Failed to claim winnings'
        );
        console.log('Transaction sent:', tx.hash);

        if (isMockContract) {
            console.log('Mock contract: Simulating winnings claim without real fund changes.');
        }

        await tx.wait();
        console.log('Winnings claimed successfully:', tx.hash);

        return tx.hash;
    } catch (error) {
        console.error('Error claiming winnings:', error);
        throw Object.assign(error, {
            userMessage: error.message.includes('User rejected') ? 'You need to confirm the transaction to claim your winnings.' : error.message.includes('pending') ? error.userMessage : 'Failed to claim winnings. Please try again.'
        });
    }
}, 1000);

// Wrapper for debounced claimWinnings
async function claimWinnings(matchId) {
    return debouncedClaimWinnings(matchId);
}

// Setup WebSocket for real-time updates
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

export { login, initializeContract, placeBet, cancelBet, claimWinnings, getSmartContractDetails, setupWebSocket };
