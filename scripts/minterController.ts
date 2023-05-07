import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from 'ton-core';
import { compile, sleep, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction } from '../wrappers/ui-utils';
let minterContract:OpenedContract<JettonMinter>;

const adminActions = ['Mint', 'Change admin', 'Start TON Distribution', 'Start Jetton Distribution'];
const userActions = ['Distribution Data', 'Info', 'Quit'];


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

    do {
        retry = false;
        const fallbackAddr = sender.address ?? await minterContract.getAdminAddress();
        mintAddress = await promptAddress(`Please specify address to mint to`, ui, fallbackAddr);
        mintAmount = await promptAmount('Please provide mint amount in decimal form:', ui);

        ui.write(`Mint ${mintAmount} tokens to ${mintAddress}\n`);
        retry = !(await promptBool('Is it ok? (yes/no)', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Minting ${mintAmount} to ${mintAddress}\n`);
    const nanoMint = toNano(mintAmount);

    const res = await minterContract.sendMint(sender,
                                              mintAddress,
                                              nanoMint,
                                              toNano('0.01'),
                                              toNano('0.13'));
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

const startJettonDistributionAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    let retry:boolean;
    let jettonVolume:string;
    let assetMinterAddr: Address;
    let senderWallet: OpenedContract<JettonWallet>;

    let distribution = await minterContract.getDistribution();

    if(distribution.active || !distribution.myJettonWallet) 
        throw new Error('Distribution is already active or no jetton distribution');

    do {
        retry = false;
        assetMinterAddr = await promptAddress('Please specify asset minter address: ', ui);

        // needed logic is the same as in classic jetton wallet so we use our wrappers
        let assetMinter = provider.open(
            JettonMinter.createFromAddress(assetMinterAddr));

        let distributorAssetWalletAddr = await assetMinter.getWalletAddress(minterContract.address);
        senderWallet = provider.open(JettonWallet.createFromAddress(
                await assetMinter.getWalletAddress(sender.address!)
            ));
        let senderBalance = Number(fromNano(await senderWallet.getJettonBalance()));

        jettonVolume = await promptAmount(`Please provide distribution Jetton Amount in decimal form (max/default: ${senderBalance}): `,
                                          ui, senderBalance);

        ui.write(`Send ${jettonVolume} jettons for distribution\n`);
        retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));

        if (!distributorAssetWalletAddr.equals(distribution.myJettonWallet)) {
            ui.write(`Asset minter address ${assetMinterAddr} is not a valid for this distribution!\n`);
            retry = true;
        }
    } while(retry);

    ui.write(`Starting distribution with volume ${jettonVolume}\n`);
    const nanoVolume = toNano(jettonVolume);

    const res = await senderWallet.sendTransfer(sender, toNano('0.1'),
                                          nanoVolume, minterContract.address,
                                          sender.address!, Cell.EMPTY,
                                          toNano('0.03'), Cell.EMPTY);
    ui.write(`Distribution transaction sent`);
}

const distributionDataAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const distribution = await minterContract.getDistribution();
    ui.write(`\n---- Distribution data: ----\n`);
    ui.write(`Active: ${distribution.active}\n`);
    ui.write(`Volume: ${fromNano(distribution.volume)}\n`);
    ui.write(`Jettons?: ${distribution.isJetton ? 'yes' : 'no'}\n`);
    distribution.isJetton ? ui.write(`Jetton wallet: ${distribution.myJettonWallet}\n\n`) : ui.write(`\n`);
}

export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const sender = provider.sender();
    const hasSender = sender.address !== undefined;
    let done = false;
    let minterAddress: Address;

    if (args.length > 0)
        minterAddress = Address.parse(args[0]);
    else
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
            case 'Start Jetton Distribution':
                await startJettonDistributionAction(provider, ui);
                break;
            case 'Distribution Data':
                await distributionDataAction(provider, ui);
                break;
            case 'Info':
                await infoAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
        }
    } while(!done);
}
