import {
    AbstractJSONRPCTransport,
    HTTPTransport,
    WSTransport
} from "./transport";
import { utils, ethers, Contract } from "ethers";
import {
    AccountState,
    Address,
    Token,
    TransactionReceipt,
    PriorityOperationReceipt,
    ContractAddress,
    Tokens
} from "./types";
import {
    sleep,
    syncToLegacyAddress,
    SYNC_GOV_CONTRACT_INTERFACE,
    SYNC_MAIN_CONTRACT_INTERFACE
} from "./utils";

export async function getDefaultProvider(
    network: "localhost" | "testnet",
    transport: "WS" | "HTTP" = "WS"
): Promise<Provider> {
    if (network == "localhost") {
        if (transport == "WS") {
            return await Provider.newWebsocketProvider("ws://127.0.0.1:3031");
        } else if (transport == "HTTP") {
            return await Provider.newHttpProvider("http://127.0.0.1:3030");
        }
    } else if (network == "testnet") {
        if (transport == "WS") {
            return await Provider.newWebsocketProvider(
                "wss://testnet.matter-labs.io/jsrpc-ws"
            );
        } else if (transport == "HTTP") {
            return await Provider.newHttpProvider(
                "https://testnet.matter-labs.io/jsrpc"
            );
        }
    }
}

export class Provider {
    contractAddress: ContractAddress;
    private constructor(public transport: AbstractJSONRPCTransport) {}

    static async newWebsocketProvider(address: string): Promise<Provider> {
        const transport = await WSTransport.connect(address);
        const provider = new Provider(transport);
        provider.contractAddress = await provider.getContractAddress();
        return provider;
    }

    static async newHttpProvider(
        address: string = "http://127.0.0.1:3030"
    ): Promise<Provider> {
        const transport = new HTTPTransport(address);
        const provider = new Provider(transport);
        provider.contractAddress = await provider.getContractAddress();
        return provider;
    }

    // return transaction hash (e.g. 0xdead..beef)
    async submitTx(tx: any): Promise<string> {
        return await this.transport.request("tx_submit", [tx]);
    }

    async getContractAddress(): Promise<ContractAddress> {
        return await this.transport.request("contract_address", null);
    }

    async getTokens(): Promise<Tokens> {
        return await this.transport.request("tokens", null);
    }

    async getState(address: Address): Promise<AccountState> {
        const legacyAddress = syncToLegacyAddress(address);
        return await this.transport.request("account_info", [legacyAddress]);
    }

    // get transaction status by its hash (e.g. 0xdead..beef)
    async getTxReceipt(txHash: string): Promise<TransactionReceipt> {
        return await this.transport.request("tx_info", [txHash]);
    }

    async getPriorityOpStatus(
        serialId: number
    ): Promise<PriorityOperationReceipt> {
        return await this.transport.request("ethop_info", [serialId]);
    }

    async notifyPriorityOp(
        serialId: number,
        action: "COMMIT" | "VERIFY"
    ): Promise<PriorityOperationReceipt> {
        if (this.transport.subscriptionsSupported()) {
            return await new Promise(resolve => {
                const sub = this.transport.subscribe(
                    "ethop_subscribe",
                    [serialId, action],
                    "ethop_unsubscribe",
                    resp => {
                        sub.then(sub => sub.unsubscribe());
                        resolve(resp);
                    }
                );
            });
        } else {
            let notifyDone = false;
            while (!notifyDone) {
                const priorOpStatus = await this.getPriorityOpStatus(serialId);
                if (priorOpStatus.block) {
                    if (action == "COMMIT") {
                        notifyDone = priorOpStatus.block.committed;
                    } else {
                        notifyDone = priorOpStatus.block.verified;
                    }
                }
                await sleep(3000);
            }
        }
    }

    async notifyTransaction(
        hash: string,
        action: "COMMIT" | "VERIFY"
    ): Promise<TransactionReceipt> {
        if (this.transport.subscriptionsSupported()) {
            return await new Promise(resolve => {
                const sub = this.transport.subscribe(
                    "tx_subscribe",
                    [hash, action],
                    "tx_unsubscribe",
                    resp => {
                        sub.then(sub => sub.unsubscribe());
                        resolve(resp);
                    }
                );
            });
        } else {
            let notifyDone = false;
            while (!notifyDone) {
                const transactionStatus = await this.getTxReceipt(hash);
                if (transactionStatus.block) {
                    if (action == "COMMIT") {
                        notifyDone = transactionStatus.block.committed;
                    } else {
                        notifyDone = transactionStatus.block.verified;
                    }
                }
                await sleep(3000);
            }
        }
    }

    async disconnect() {
        return await this.transport.disconnect();
    }
}

export class ETHProxy {
    private governanceContract: Contract;
    private mainContract: Contract;

    constructor(
        private ethersProvider: ethers.providers.Provider,
        public contractAddress: ContractAddress
    ) {
        this.governanceContract = new Contract(
            this.contractAddress.govContract,
            SYNC_GOV_CONTRACT_INTERFACE,
            this.ethersProvider
        );

        this.mainContract = new Contract(
            this.contractAddress.mainContract,
            SYNC_MAIN_CONTRACT_INTERFACE,
            this.ethersProvider
        );
    }

    async resolveTokenId(token: Token): Promise<number> {
        if (token == "ETH") {
            return 0;
        } else {
            const tokenId = await this.governanceContract.tokenIds(token);
            if (tokenId == 0) {
                throw new Error(`ERC20 token ${token} is not supported`);
            }
            return tokenId;
        }
    }

    async estimateEmergencyWithdrawFeeInETHToken(): Promise<utils.BigNumber> {
        const gasPrice = await this.ethersProvider.getGasPrice();
        return gasPrice.mul(2 * 170000);
    }
}
