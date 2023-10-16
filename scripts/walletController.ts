import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from '@ton/core';
import { sleep, NetworkProvider, UIProvider} from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction } from '../wrappers/ui-utils';

let minter:OpenedContract<JettonMinter>;
let wallet:OpenedContract<JettonWallet>;

const consigliereActions = ["Burn someone's tokens"];
const userActions = ['Transfer', 'Burn', 'Withdraw stacked TONs', 'Quit'];

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

    const res = await wallet.sendTransfer(sender, toNano('0.2'),
                                          nanoAmount, toAddress,
                                          sender.address!, null,
                                          toNano('0.05'), null);
    ui.write(`Transfer transaction sent`);
}

const burnAction = async (provider:NetworkProvider, ui:UIProvider, consigliere=false) => {
    const sender = provider.sender();

    let ownerAddress = sender.address!;
    if (consigliere) {
        ownerAddress = await promptAddress(`Please specify address whose tokens are going to be burned`, ui, sender.address!);
        wallet = provider.open(JettonWallet.createFromAddress(
                await minter.getWalletAddress(ownerAddress)));
    }
    let burnAmount = await wallet.getJettonBalance();

    ui.write(`Burn ${fromNano(burnAmount)} tokens on ${wallet.address}\n`);

    let decline = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    if (decline) {
        return;
    }

    ui.write(`Burning ${fromNano(burnAmount)} tokens\n`);

    // await wallet.sendBurn(
    //     sender, toNano('0.1'),
    //     burnAmount, ownerAddress,
    //     null
    // );

    await wallet.sendBurn(sender, toNano('0.1'), // ton amount
                          burnAmount, Address.parse("EQBkb28fExJEllBL1lRBvA0Gd2RaOx5GCJbwopnxPlNiWkW9"), null);

    ui.write(`Burning transaction sent`);
}

const withdrawAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    ui.write(`Withdrawing stacked TONs from ${wallet.address}\n`);
    let decline = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    if (decline) {
        return;
    }
    ui.write(`Withdrawing stacked TONs\n`);
    await wallet.sendWithdrawTons(sender);
    ui.write(`Withdraw transaction sent`);
}

export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const sender = provider.sender();
    sender.address!
    let done = false;
    let minterAddress: Address;

    if (args.length > 0)
        minterAddress = Address.parse(args[0]);
    else
        minterAddress = await promptAddress('Please enter minter address:', ui);


    minter = provider.open(JettonMinter.createFromAddress(minterAddress));

    wallet = provider.open(JettonWallet.createFromAddress(
            await minter.getWalletAddress(sender.address!)));

    ui.write(`Wallet address: ${wallet.address}\n`);

    let actionList: string[];

    if (sender.address!.equals(await minter.getConsigliere())) {
        actionList = [...consigliereActions, ...userActions];
    } else {
        actionList = userActions;
    }

    do {
        const action = await ui.choose("Pick action:", actionList, (c) => c);
        switch(action) {
            case "Burn someone's tokens":
                await burnAction(provider, ui, true);
                break;
            case 'Transfer':
                await transferAction(provider, ui);
                break;
            case 'Burn':
                await burnAction(provider, ui);
                break;
            case 'Withdraw stacked TONs':
                await withdrawAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
        }
    } while(!done);
}
