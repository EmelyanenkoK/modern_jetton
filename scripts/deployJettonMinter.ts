import { Address, toNano } from 'ton-core';
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

    const consiglierePrompt = `Please specify admin address`;
    let consigliere = await promptAddress(consiglierePrompt, ui, sender.address);
    ui.write(`Consigliere address: ${consigliere}\n`);

    let contentUrl = await promptUrl(urlPrompt, ui);
    ui.write(`Jetton content url: ${contentUrl}`);

    let dataCorrect = false;
    do {
        ui.write("Please verify data:\n")
        ui.write(`Admin: ${admin}\n`);
        ui.write(`Consigliere: ${consigliere}\n\n`);
        ui.write('Metadata url: ' + contentUrl);
        dataCorrect = await promptBool('Is everything ok? (y/n)', ['y','n'], ui);
        if(!dataCorrect) {
            const upd = await ui.choose('What do you want to update?', ['Admin', 'Consigliere', 'Url'], (c) => c);

            if(upd == 'Admin') {
                admin = await promptAddress(adminPrompt, ui, sender.address);
            }
            if(upd == 'Consigliere') {
                consigliere = await promptAddress(consiglierePrompt, ui, sender.address);
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

    const distribution = { active: false, isJetton: false, volume: 0n };
    const deployResult = await minter.sendDeploy(provider.sender(), distribution, toNano('0.05'));
    await provider.waitForDeploy(minter.address);
}
