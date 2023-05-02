import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from 'ton-core';
import { compile, sleep, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction } from '../wrappers/ui-utils';
let minterContract:OpenedContract<JettonMinter>;

const adminActions = ['Mint', 'Change admin', 'Start TON Distribution', 'Start Jetton Distribution'];
const userActions = ['Info', 'Burn', 'Quit'];


const infoAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const jettonData = await minterContract.getJettonData();
    ui.write("Jetton info:\n\n");
    ui.write(`Admin:${jettonData.adminAddress}\n`);
    ui.write(`Total supply:${fromNano(jettonData.totalSupply)}\n`);
    ui.write(`Mintable:${jettonData.mintable}\n`);
    const displayContent = await ui.choose('Display content?', ['Yes', 'No'], (c) => c);
    if(displayContent == 'Yes') {
        displayContentCell(jettonData.content, ui);
    }
};
const changeAdminAction = async(provider:NetworkProvider, ui:UIProvider) => {
    let retry:boolean;
    let newAdmin:Address;
    let curAdmin = await minterContract.getAdminAddress();
    do {
        retry = false;
        newAdmin = await promptAddress('Please specify new admin address:', ui);
        if(newAdmin.equals(curAdmin)) {
            retry = true;
            ui.write("Address specified matched current admin address!\nPlease pick another one.\n");
        }
        else {
            ui.write(`New admin address is going to be:${newAdmin}\nKindly double check it!\n`);
            retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
        }
    } while(retry);

    await minterContract.sendChangeAdmin(provider.sender(), newAdmin);

    ui.write(`Change admin transaction sent, sleeping for 10 seconds to wait for transaction to be processed\n`);
    sleep(10000);

    let newAdminAddr = await minterContract.getAdminAddress();

    if(newAdminAddr.equals(newAdmin)) {
        ui.write(`Admin address changed successfully!\n`);
    } else {
        ui.write(`Admin address change failed!\n`);
    }
};

const mintAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    let retry:boolean;
    let mintAddress:Address;
    let mintAmount:string;
    let forwardAmount:string;

    do {
        retry = false;
        const fallbackAddr = sender.address ?? await minterContract.getAdminAddress();
        mintAddress = await promptAddress(`Please specify address to mint to`, ui, fallbackAddr);
        mintAmount = await promptAmount('Please provide mint amount in decimal form:', ui);
        ui.write(`Mint ${mintAmount} tokens to ${mintAddress}\n`);
        retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Minting ${mintAmount} to ${mintAddress}\n`);
    const nanoMint = toNano(mintAmount);

    const res = await minterContract.sendMint(sender,
                                              mintAddress,
                                              nanoMint,
                                              toNano('0.05'),
                                              toNano('0.1'));
    ui.write(`Minting transaction sent`);
}

const startTONDistributionAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    let retry:boolean;
    let tonVolume:string;

    do {
        retry = false;
        tonVolume = await promptAmount('Please provide distribution TON Amount in decimal form:', ui);
        ui.write(`Start distribution with volume ${tonVolume}\n`);
        retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Starting distribution with volume ${tonVolume}\n`);
    const nanoVolume = toNano(tonVolume);

    const res = await minterContract.sendStartDistribution(sender, nanoVolume);
    ui.write(`Distribution transaction sent`);
}

const burnAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();

    let jettonWallet = provider.open(JettonWallet.createFromAddress(
            await minterContract.getWalletAddress(sender.address!)));

    let burnAmount = await jettonWallet.getJettonBalance();

    ui.write(`Burn ${burnAmount} tokens\n`);

    let decline = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    if (decline) {
        return;
    }

    ui.write(`Burning ${fromNano(burnAmount)} tokens\n`);

    await jettonWallet.sendBurn(
        sender, toNano('0.1'),
        burnAmount, sender.address!,
        beginCell().endCell()
    );

    ui.write(`Burning transaction sent`);
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    const hasSender = sender.address !== undefined;
    let done = false;
    let minterAddress: Address;

    minterAddress = await promptAddress('Please enter minter address:', ui);

    minterContract = provider.open(JettonMinter.createFromAddress(minterAddress));
    const isAdmin = hasSender ? (await minterContract.getAdminAddress()).equals(sender.address) : true;
    let actionList: string[];
    if(isAdmin) {
        actionList = [...adminActions, ...userActions];
        ui.write("Current wallet is minter admin!\n");
    }
    else {
        actionList = userActions;
        ui.write("Current wallet is not admin!\nAvaliable actions restricted\n");
    }

    do {
        const action = await ui.choose("Pick action:", actionList, (c) => c);
        switch(action) {
            case 'Mint':
                await mintAction(provider, ui);
                break;
            case 'Change admin':
                await changeAdminAction(provider, ui);
                break;
            case 'Start TON Distribution':
                await startTONDistributionAction(provider, ui);
                break;
            case 'Info':
                await infoAction(provider, ui);
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
