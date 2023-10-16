import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export type JettonMinterContent = {
    type:0|1,
    uri:string
};
export type JettonMinterConfig = {
    admin: Address
    content: Cell
    wallet_code?: Cell
};

export type Distribution = {
    active: boolean
    isJetton: boolean
    volume: bigint
    myJettonWallet?: Address
}

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
                      .storeCoins(0)
                      .storeAddress(config.admin)
                      .storeMaybeRef(null) // no dsitribution data on init
                      .storeRef(config.content)
           .endCell();
}

export function jettonClassicMinterConfigToCell(config: JettonMinterConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeRef(config.content)
        .storeRef(config.wallet_code!)
    .endCell();
}

export function jettonContentToCell(content:JettonMinterContent) {
    return beginCell()
                      .storeUint(content.type, 8)
                      .storeStringTail(content.uri) // Snake logic under the hood
           .endCell();
}

export function packDistribution(distribution: Distribution) {
    const c = beginCell()
        .storeBit(distribution.active)
        .storeBit(distribution.isJetton)
        .storeCoins(distribution.volume)
    if (distribution.isJetton) {
        c.storeAddress(distribution.myJettonWallet!)
    }
    return c.endCell();
}

export async function setConsigliere(consigliere_address: Address) {
    const auto = path.join(__dirname, '..', 'contracts', 'auto'); //'consigliere_address.func'
    await mkdir(auto, { recursive: true });
    await writeFile(path.join(auto, 'consigliere_address.func'), `const slice consigliere_address = "${consigliere_address.toString()}"a;`);

}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinter(contractAddress(workchain, init), init);
    }
    static createClassicFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonClassicMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, distribution: Distribution, value: bigint) {
        if (distribution.active) {
            throw new Error('Distribution should be not active');
        }
        const distributionCell = packDistribution(distribution);
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                    .storeUint(0xf5aa8943, 32).storeUint(0, 64) // op init
                    .storeRef(distributionCell)
                  .endCell(),
        });
    }

    static mintMessage(to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint,) {
        return beginCell().storeUint(0x1674b0a0, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(to).storeCoins(jetton_amount)
                          .storeCoins(forward_ton_amount).storeCoins(total_ton_amount)
               .endCell();
    }
    async sendMint(provider: ContractProvider, via: Sender, to: Address, jetton_amount: bigint, forward_ton_amount: bigint, total_ton_amount: bigint,) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.mintMessage(to, jetton_amount, forward_ton_amount, total_ton_amount),
            value: total_ton_amount + toNano("0.02"),
        });
    }

    async send(provider: ContractProvider, via: Sender, value: bigint, body: Cell) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body,
        });
    }

    /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
    */
    static discoveryMessage(owner: Address, include_address: boolean) {
        return beginCell().storeUint(0x2c76b973, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(owner).storeBit(include_address)
               .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.discoveryMessage(owner, include_address),
            value: value,
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(0x4840664f, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(newOwner)
               .endCell();
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeAdminMessage(newOwner),
            value: toNano("0.1"),
        });
    }
    static changeContentMessage(content: Cell) {
        return beginCell().storeUint(0x5773d1f5, 32).storeUint(0, 64) // op, queryId
                          .storeRef(content)
               .endCell();
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeContentMessage(content),
            value: toNano("0.1"),
        });
    }

    async sendStartDistribution(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x1140a64f, 32).storeUint(0, 64) // op, queryId
                                .endCell()
        });
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }])
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode
        };
    }

    async getTotalSupply(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.totalSupply;
    }
    async getAdminAddress(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.adminAddress;
    }
    async getContent(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.content;
    }

    // distrib_data$_ started: (## 1)
    //   distributing_jettons: (## 1)
    //   volume: Coins
    //   my_jetton_wallet: distributing_jettons? MsgAddress
    //   = Distribution;
    async getDistribution(provider: ContractProvider): Promise<Distribution> {
        let res = await provider.get('get_distribution_data', []);
        let distribution = res.stack.readCell().beginParse();
        let active = distribution.loadBit();
        let isJetton = distribution.loadBit();
        return {
            active,
            isJetton,
            volume: distribution.loadCoins(),
            myJettonWallet: isJetton ? distribution.loadAddress() : undefined,
        }
    }

    async getConsigliere(provider: ContractProvider): Promise<Address> {
        let res = await provider.get('get_consigliere_address', []);
        return res.stack.readAddress();
    }
}
