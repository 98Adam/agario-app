import Web3 from 'web3';

// Fetch contract details from Platform Server
export async function getSmartContractDetails() {
    try {
        const response = await fetch('/api/v1/smart-contract/config');
        if (!response.ok) {
            throw new Error('Failed to fetch contract details from Server.');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching Smart Contract details:', error.message);
        throw new Error('Could not connect to Smart Contract. Please try again.');
    }
}

// Initialize the Web3 contract instance
export async function initializeContract(web3) {
    try {
        // Fetch contract ABI from server
        const { contractAbi } = await getSmartContractDetails();

        // Contract address should come from environment variables
        const contractAddress = process.env.CONTRACT_ADDRESS;

        if (!contractAddress) {
            throw new Error('Contract address not found in environment variables.');
        }

        // Ensure the ABI is correctly accessed from the JSON structure
        const contract = new web3.eth.Contract(contractAbi.abi, contractAddress);

        return contract;
    } catch (error) {
        console.error('Error initializing Smart Contract:', error.message);
        throw new Error('Failed to initialize Smart Contract.');
    }
}

// Place a bet on the Smart Contract
export async function placeBet(contract, betValue, account) {
    try {
        const betValueInWei = Web3.utils.toWei(betValue.toString(), 'mwei'); // Convert USDC to smallest unit

        // Start Transaction
        contract.methods.placeBet(betValueInWei).send({ from: account })
            .on('transactionHash', function(hash) {
                console.log('Transaction sent:', hash);
                document.getElementById('gameStatus').innerText = "Waiting for confirmation...";
            })
            .on('receipt', function(receipt) {
                console.log('Transaction confirmed:', receipt.transactionHash);
                document.getElementById('gameStatus').innerText = "Amount placed! Waiting for other players...";
            })
            .on('error', function(error) {
                console.error('Transaction failed:', error);
                document.getElementById('gameStatus').innerText = "Transaction failed. Please try again.";
            });

    } catch (error) {
        console.error('Error placing amount:', error.message);
        document.getElementById('gameStatus').innerText = "Failed to place amount.";
    }
}

// Cancel a bet
export async function cancelBet(contract, account) {
    try {
        const tx = await contract.methods.cancelBet().send({ from: account });

        console.log('Amount canceled successfully:', tx.transactionHash);
        return tx.transactionHash;
    } catch (error) {
        console.error('Error canceling amount:', error.message);
        throw new Error('Failed to cancel your amount. Please check if the match has not yet started.');
    }
}

// Claim rewards from the Smart Contract
export async function claimReward(contract, matchId, account) {
    try {
        const tx = await contract.methods.claimReward(matchId).send({ from: account });

        console.log('Reward claimed successfully:', tx.transactionHash);
        return tx.transactionHash;
    } catch (error) {
        console.error('Error claiming reward:', error.message);
        throw new Error('Failed to claim reward. Please try again later.');
    }
}
