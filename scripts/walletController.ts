import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from 'ton-core';
import { sleep, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction } from '../wrappers/ui-utils';

let wallet:OpenedContract<JettonWallet>;

const adminActions = ['Transfer', 'Burn'];
const userActions = ['Quit'];

const transferAction = async (provider: NetworkProvider, ui: UIProvider) => {
    const sender = provider.sender();
    let retry: boolean;
    let toAddress: Address;
    let jettonAmount: string;

    do {
        retry = false;
        toAddress = await promptAddress(`Please specify address to transfer to`, ui);
        jettonAmount = await promptAmount('Please provide transfer amount in decimal form:', ui);
        ui.write(`Mint ${jettonAmount} tokens to ${toAddress}\n`);
        retry = !(await promptBool('Is it ok? (yes/no)', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Sending ${jettonAmount} tokens to ${toAddress}\n`);
    const nanoAmount = toNano(jettonAmount);

    const res = await wallet.sendTransfer(sender, toNano('0.05'),
                                          nanoAmount, toAddress,
                                          sender.address!, Cell.EMPTY,
                                          0n, Cell.EMPTY);
    ui.write(`Transfer transaction sent`);
}

const burnAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();

    let burnAmount = await wallet.getJettonBalance();

    ui.write(`Burn ${burnAmount} tokens\n`);

    let decline = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    if (decline) {
        return;
    }

    ui.write(`Burning ${fromNano(burnAmount)} tokens\n`);

    await wallet.sendBurn(
        sender, toNano('0.1'),
        burnAmount, sender.address!,
        Cell.EMPTY
    );

    ui.write(`Burning transaction sent`);
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    sender.address!
    let done = false;
    let minterAddress: Address;

    minterAddress = await promptAddress('Please enter minter address:', ui);

    let minter = provider.open(JettonMinter.createFromAddress(minterAddress));

    wallet = provider.open(JettonWallet.createFromAddress(
            await minter.getWalletAddress(sender.address!)));

    ui.write(`Wallet address: ${wallet.address}\n`);

    let actionList: string[];
    actionList = [...adminActions, ...userActions];

    do {
        const action = await ui.choose("Pick action:", actionList, (c) => c);
        switch(action) {
            case 'Transfer':
                await transferAction(provider, ui);
                break;
            case 'Burn':
                await burnAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
        }
    } while(!done);
}