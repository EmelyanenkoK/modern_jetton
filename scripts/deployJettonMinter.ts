import { Address, OpenedContract, toNano } from 'ton-core';
import { JettonMinter, JettonMinterContent, jettonContentToCell, jettonMinterConfigToCell } from '../wrappers/JettonMinter';
import { compile, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { promptAddress, promptBool, promptUrl } from '../wrappers/ui-utils';

const formatUrl = "https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md#jetton-metadata-example-offchain";
const urlPrompt = 'Please specify url pointing to jetton metadata (json):';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    ui.write(`Jetton deployer\nCurrent deployer onli supports off-chain format:${formatUrl}`);

    const adminPrompt = `Please specify admin address`;
    let admin = await promptAddress(adminPrompt, ui, sender.address);
    ui.write(`Admin address: ${admin}\n`);

    const consiglierePrompt = `Please specify consigliere address`;
    let consigliere = await promptAddress(consiglierePrompt, ui, sender.address);
    ui.write(`Consigliere address: ${consigliere}\n`);

    let contentUrl = await promptUrl(urlPrompt, ui);
    ui.write(`Jetton content url: ${contentUrl}`);

    let asset = await ui.choose('What will be distributed?', ['TON', 'Jettons'], (c) => c);
    let isJetton = (asset == 'Jettons');

    let assetMinter  = undefined;

    if (isJetton) {
        let assetMinterAddr = await promptAddress(`Please specify asset jetton minter address`, ui);
        assetMinter = provider.open(JettonMinter.createFromAddress(assetMinterAddr));
        // try call get method to check that minter address is correct
        await assetMinter.getAdminAddress();
    }

    let dataCorrect = false;
    do {
        ui.write("Please verify data:\n")
        ui.write(`Admin: ${admin}\n`);
        ui.write(`Consigliere: ${consigliere}\n\n`);
        ui.write(`Asset: ${asset}\n`);
        if(isJetton) {
            ui.write(`Asset minter: ${assetMinter?.address}\n`);
        }
        ui.write('Metadata url: ' + contentUrl);
        dataCorrect = await promptBool('Is everything ok? (y/n)', ['y','n'], ui);
        if(!dataCorrect) {
            const upd = await ui.choose('What do you want to update?', ['Admin', 'Consigliere',  'Asset', 'Url'], (c) => c);

            if(upd == 'Admin') {
                admin = await promptAddress(adminPrompt, ui, sender.address);
            }
            if(upd == 'Consigliere') {
                consigliere = await promptAddress(consiglierePrompt, ui, sender.address);
            }
            if(upd == 'Asset') {
                asset = await ui.choose('What to distribute?', ['TON', 'Jettons'], (c) => c);
                isJetton = (asset == 'Jettons');
                if (isJetton) {
                    let assetMinterAddr = await promptAddress(`Please specify asset jetton minter address`, ui);
                    assetMinter = provider.open(JettonMinter.createFromAddress(assetMinterAddr));
                    await assetMinter.getAdminAddress();
                }
            }
            else {
                contentUrl = await promptUrl(urlPrompt, ui);
            }
        }

    } while(!dataCorrect);

    const content = jettonContentToCell({type:1,uri:contentUrl});

    const wallet_code = await compile('JettonWallet');

    const minter  = provider.open(
        JettonMinter.createFromConfig({admin,
              consigliere: admin,
              content,
              wallet_code,
          }, await compile('JettonMinter'))
    );

    let assetJettonWalletAddr = undefined;

    if (assetMinter) {
        assetJettonWalletAddr = await assetMinter.getWalletAddress(minter.address);
    }

    const distribution = { active: false, isJetton, volume: 0n, myJettonWallet: assetJettonWalletAddr };
    const deployResult = await minter.sendDeploy(provider.sender(), distribution, toNano('0.05'));
    await provider.waitForDeploy(minter.address);
}
