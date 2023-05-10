import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot, printTransactionFees } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, fromNano } from 'ton-core';
import { JettonWallet } from '../wrappers/JettonWallet';
import { JettonMinter } from '../wrappers/JettonMinter';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress, getRandomTon } from './utils';


describe('DistributingJettons', () => {
    let jwallet_code = new Cell();
    let classic_jwallet_code = Cell.fromBoc(Buffer.from('B5EE9C7241021101000323000114FF00F4A413F4BCF2C80B0102016202030202CC0405001BA0F605DA89A1F401F481F481A8610201D40607020120080900C30831C02497C138007434C0C05C6C2544D7C0FC03383E903E900C7E800C5C75C87E800C7E800C1CEA6D0000B4C7E08403E29FA954882EA54C4D167C0278208405E3514654882EA58C511100FC02B80D60841657C1EF2EA4D67C02F817C12103FCBC2000113E910C1C2EBCB853600201200A0B0083D40106B90F6A2687D007D207D206A1802698FC1080BC6A28CA9105D41083DEECBEF09DD0958F97162E99F98FD001809D02811E428027D012C678B00E78B6664F6AA401F1503D33FFA00FA4021F001ED44D0FA00FA40FA40D4305136A1522AC705F2E2C128C2FFF2E2C254344270542013541403C85004FA0258CF1601CF16CCC922C8CB0112F400F400CB00C920F9007074C8CB02CA07CBFFC9D004FA40F40431FA0020D749C200F2E2C4778018C8CB055008CF1670FA0217CB6B13CC80C0201200D0E009E8210178D4519C8CB1F19CB3F5007FA0222CF165006CF1625FA025003CF16C95005CC2391729171E25008A813A08209C9C380A014BCF2E2C504C98040FB001023C85004FA0258CF1601CF16CCC9ED5402F73B51343E803E903E90350C0234CFFE80145468017E903E9014D6F1C1551CDB5C150804D50500F214013E809633C58073C5B33248B232C044BD003D0032C0327E401C1D3232C0B281F2FFF274140371C1472C7CB8B0C2BE80146A2860822625A019AD822860822625A028062849E5C412440E0DD7C138C34975C2C0600F1000D73B51343E803E903E90350C01F4CFFE803E900C145468549271C17CB8B049F0BFFCB8B08160824C4B402805AF3CB8B0E0841EF765F7B232C7C572CFD400FE8088B3C58073C5B25C60063232C14933C59C3E80B2DAB33260103EC01004F214013E809633C58073C5B3327B552000705279A018A182107362D09CC8CB1F5230CB3F58FA025007CF165007CF16C9718010C8CB0524CF165006FA0215CB6A14CCC971FB0010241023007CC30023C200B08E218210D53276DB708010C8CB055008CF165004FA0216CB6A12CB1F12CB3FC972FB0093356C21E203C85004FA0258CF1601CF16CCC9ED5495EAEDD7', 'hex'))[0];
    let minter_code = new Cell();
    let classic_minter_code = Cell.fromBoc(Buffer.from('B5EE9C7241020D0100029C000114FF00F4A413F4BCF2C80B0102016202030202CC040502037A600B0C02F1D906380492F81F000E8698180B8D8492F81F07D207D2018FD0018B8EB90FD0018FD001801698FE99FF6A2687D007D206A6A18400AA9385D47199A9A9B1B289A6382F97024817D207D006A18106840306B90FD001812881A282178050A502819E428027D012C678B666664F6AA7041083DEECBEF29385D7181406070093B5F0508806E0A84026A8280790A009F404B19E2C039E2D99924591960225E801E80196019241F200E0E9919605940F97FF93A0EF003191960AB19E2CA009F4042796D625999992E3F60101C036373701FA00FA40F82854120670542013541403C85004FA0258CF1601CF16CCC922C8CB0112F400F400CB00C9F9007074C8CB02CA07CBFFC9D05006C705F2E04AA1034545C85004FA0258CF16CCCCC9ED5401FA403020D70B01C300915BE30D0801A682102C76B9735270BAE30235373723C0038E1A335035C705F2E04903FA403059C85004FA0258CF16CCCCC9ED54E03502C0048E185124C705F2E049D4304300C85004FA0258CF16CCCCC9ED54E05F05840FF2F009003E8210D53276DB708010C8CB055003CF1622FA0212CB6ACB1FCB3FC98042FB0001FE365F03820898968015A015BCF2E04B02FA40D3003095C821CF16C9916DE28210D1735400708018C8CB055005CF1624FA0214CB6A13CB1F14CB3F23FA443070BA8E33F828440370542013541403C85004FA0258CF1601CF16CCC922C8CB0112F400F400CB00C9F9007074C8CB02CA07CBFFC9D0CF16966C227001CB01E2F4000A000AC98040FB00007DADBCF6A2687D007D206A6A183618FC1400B82A1009AA0A01E428027D012C678B00E78B666491646580897A007A00658064FC80383A6465816503E5FFE4E840001FAF16F6A2687D007D206A6A183FAA9040EF7C997D', 'hex'))[0];
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let consigliere: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;
    let assetJettonMinter: SandboxContract<JettonMinter>;
    let userWallet: (a: Address, m: SandboxContract<JettonMinter>) => Promise<SandboxContract<JettonWallet>>;

    beforeAll(async () => {
        jwallet_code   = await compile('JettonWallet');
        minter_code    = await compile('JettonMinter');
        blockchain     = await Blockchain.create();
        deployer       = await blockchain.treasury('deployer');
        consigliere    = await blockchain.treasury('consigliere');

        jettonMinter = blockchain.openContract(JettonMinter.createFromConfig({
               admin: deployer.address,
               consigliere: consigliere.address,
               content: Cell.EMPTY,
               wallet_code: jwallet_code,
         }, minter_code));

         assetJettonMinter = blockchain.openContract(JettonMinter.createClassicFromConfig({
             admin: deployer.address,
             consigliere: consigliere.address,
             content: Cell.EMPTY,
             wallet_code: classic_jwallet_code,
         }, classic_minter_code));

        userWallet = async (address: Address, minter: SandboxContract<JettonMinter>) =>
                    blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await minter.getWalletAddress(address)
                    ));
    });

    let noDistributionSnapshot: BlockchainSnapshot;
    let justStartedDistributionSnapshot: BlockchainSnapshot;

    it('should deploy asset jetton master and mint these tokens', async () => {
        const distribution = { active: false, isJetton: false, volume: 0n };
        const deployResult = await assetJettonMinter.sendDeploy(deployer.getSender(), distribution, toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: assetJettonMinter.address,
            deploy: true,
        });

        let toMint = toNano('2000');

        let mintResult = await assetJettonMinter.send(
            deployer.getSender(), toNano('0.1'),
            beginCell()
                .storeUint(21, 32)
                .storeUint(0, 64)
                .storeAddress(deployer.address)
                .storeCoins(toNano('0.07'))
                .storeRef(
                    beginCell()
                        .storeUint(0x178d4519, 32)
                        .storeUint(0, 64)
                        .storeCoins(toMint)
                        .storeAddress(null)
                        .storeAddress(null)
                        .storeCoins(toNano('0.02'))
                        .storeUint(0, 1)
                        .endCell()
                )
                .endCell()
        );

        expect(mintResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: assetJettonMinter.address,
            success: true
        });
        expect(await assetJettonMinter.getTotalSupply()).toEqual(toMint);
    });

    it('should deploy distributor jetton master and mint tokens', async () => {
        const distributorWalletAddress = await assetJettonMinter.getWalletAddress(jettonMinter.address);

        const distribution = { active: false, isJetton: true, volume: 0n, myJettonWallet: distributorWalletAddress };
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), distribution, toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true
        });

        const mintResult1 = await jettonMinter.sendMint(deployer.getSender(), deployer.address, toNano('400'), toNano('0.01'), toNano('0.15'));
        const mintResult2 = await jettonMinter.sendMint(deployer.getSender(), consigliere.address, toNano('600'), toNano('0.01'), toNano('0.15'));

        for (let mintResult of [mintResult1, mintResult2])
            expect(mintResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: jettonMinter.address,
                success: true
            });

        expect(await jettonMinter.getTotalSupply()).toEqual(toNano('1000'));
        noDistributionSnapshot = blockchain.snapshot();
    });

    it('should not start distribution of tons', async () => {
        const startResult = await jettonMinter.sendStartDistribution(deployer.getSender(), toNano('2000'));

        expect(startResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 70  // error::cannot_distribute_tons
        });
    });

    it('should not start distribution of other jettons', async () => {
        const transferNotificationBody = beginCell()
            .storeUint(0x7362d09c, 32)
            .storeUint(0, 64)
            .storeCoins(toNano('2000'))
            .storeAddress(deployer.address) // from_address
        .endCell();

        const fakeJettonWalletAddr = randomAddress();
        const res = await blockchain.sendMessage(internal({
                                                    from: fakeJettonWalletAddr,
                                                    to: jettonMinter.address,
                                                    body: transferNotificationBody,
                                                    value: toNano('0.05')
                                                }));
        expect(res.transactions).toHaveTransaction({
            from: fakeJettonWalletAddr,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 71  // error::unknown_jetton_wallet
        })
    });

    it('should not start distribution with asset transfer not from admin', async () => {
        const assetDistributorWallet = await userWallet(jettonMinter.address, assetJettonMinter);

        const transferNotificationBody = beginCell()
            .storeUint(0x7362d09c, 32)
            .storeUint(0, 64)
            .storeCoins(toNano('2000'))
            .storeAddress(randomAddress()) // from_address
        .endCell();

        const res = await blockchain.sendMessage(internal({
            from: assetDistributorWallet.address,
            to: jettonMinter.address,
            body: transferNotificationBody,
            value: toNano('0.05')
        }));

        expect(res.transactions).toHaveTransaction({
            from: assetDistributorWallet.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 79 // error::unauthorized_transfer_source
        });
    });

    it('should start distribution with asset mint', async () => {
        const toMint = toNano('2000');

        let mintResult = await assetJettonMinter.send(
            deployer.getSender(), toNano('0.1'),
            beginCell()
                .storeUint(21, 32)
                .storeUint(0, 64)
                .storeAddress(jettonMinter.address)
                .storeCoins(toNano('0.07'))
                .storeRef(
                    beginCell()
                        .storeUint(0x178d4519, 32)
                        .storeUint(0, 64)
                        .storeCoins(toMint)
                        .storeAddress(null)
                        .storeAddress(null)
                        .storeCoins(toNano('0.02'))
                        .storeUint(0, 1)
                        .endCell()
                )
                .endCell()
        );

        expect(mintResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: assetJettonMinter.address,
            success: true
        });

        const distribution = await jettonMinter.getDistribution();

        expect(distribution.active).toEqual(true);
        expect(distribution.volume).toEqual(toMint);
    });

    it('should start distribution', async () => {
        await blockchain.loadFrom(noDistributionSnapshot);
        const assetDeployerWallet = await userWallet(deployer.address, assetJettonMinter);
        const assetMinterWallet = await userWallet(jettonMinter.address, assetJettonMinter);

        let sentAmount = toNano('2000');
        let forwardAmount = toNano('0.05');
        const transferResult = await assetDeployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, jettonMinter.address,
               deployer.address, Cell.EMPTY, forwardAmount, Cell.EMPTY);

        expect(transferResult.transactions).toHaveTransaction({ // transfer request
            from: deployer.address,
            to: assetDeployerWallet.address,
            success: true
        });

        expect(transferResult.transactions).toHaveTransaction({ // internal transfer
            from: assetDeployerWallet.address,
            to: assetMinterWallet.address,
            success: true
        });
        expect(transferResult.transactions).toHaveTransaction({ // transfer notification and start distribution
            from: assetMinterWallet.address,
            to: jettonMinter.address,
            success: true
        });

        const distribution = await jettonMinter.getDistribution();
        expect(distribution.active).toEqual(true);
        expect(distribution.volume).toEqual(sentAmount);

        justStartedDistributionSnapshot = blockchain.snapshot();
    });

    it('should send assets for burned jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address, jettonMinter);
        const deployerAssetWallet = await userWallet(deployer.address, assetJettonMinter);
        const initialDeployerWalletBalance = await deployerJettonWallet.getJettonBalance();

        const consigliereJettonWallet = await userWallet(consigliere.address, jettonMinter);
        const consigliereAssetWallet = await userWallet(consigliere.address, assetJettonMinter);
        const initialConsigliereWalletBalance = await consigliereJettonWallet.getJettonBalance();

        const burnResult1 = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                             initialDeployerWalletBalance, deployer.address, Cell.EMPTY); // amount, response address, custom payload

        await consigliereJettonWallet.sendBurn(consigliere.getSender(), toNano('0.1'),
                                               initialConsigliereWalletBalance, consigliere.address, Cell.EMPTY);

        const distributorAssetWallet = await userWallet(jettonMinter.address, assetJettonMinter);

        expect(burnResult1.transactions).toHaveTransaction({ // send asset request
            from: jettonMinter.address,
            to: distributorAssetWallet.address,
            success: true
        });

        expect(burnResult1.transactions).not.toHaveTransaction({ success: false });

        // they should get twice more than they burned because supply ratio is 2:1
        expect(await deployerAssetWallet.getJettonBalance()).toEqual(initialDeployerWalletBalance * 2n);
        expect(await consigliereAssetWallet.getJettonBalance()).toEqual(initialConsigliereWalletBalance * 2n);

        const distribution = await jettonMinter.getDistribution();
        expect(distribution.volume).toEqual(0n);
    });

    it('consigliere should help user burn tokens', async () => {
        await blockchain.loadFrom(justStartedDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address, jettonMinter);
        const deployerAssetWallet = await userWallet(deployer.address, assetJettonMinter);
        const initialDeployerWalletBalance = await deployerJettonWallet.getJettonBalance();

        const spentTON = toNano('0.1');

        const burnResult = await deployerJettonWallet.sendBurn(consigliere.getSender(), spentTON, // ton amount
                             initialDeployerWalletBalance, consigliere.address, null); // amount, response address (no matter - will be overwritten), custom payload

        expect(burnResult.transactions).toHaveTransaction({
            from: consigliere.address,
            to: deployerJettonWallet.address,
            success: true
        });
        expect(burnResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            success: true
        });
        expect(burnResult.transactions).toHaveTransaction({ // transfer request
            from: jettonMinter.address,
            to: (await userWallet(jettonMinter.address, assetJettonMinter)).address,
            success: true
        });
        expect(burnResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: consigliere.address,
            value: (x) => x! > spentTON, // consigliere should get all the spent TONs + extra for fees
            success: true,
            op: 0xd53276db
        });
        expect(burnResult.transactions).toHaveTransaction({ // excesses to owner
            from: jettonMinter.address,
            to: deployer.address,
            success: true,
            op: 0xd53276db
        });
        expect(await deployerAssetWallet.getJettonBalance()).toEqual(initialDeployerWalletBalance * 2n);
    });

    let stackedTONsSnapshot: BlockchainSnapshot;
    it('owner can withdraw jettons owned by JettonWallet', async () => {
        await blockchain.loadFrom(noDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address, jettonMinter);
        const deployerAssetWallet = await userWallet(deployer.address, assetJettonMinter);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');

        // transfer asset jettons to JettonWallet
        await deployerAssetWallet.sendTransfer(deployer.getSender(), toNano('0.1'), // tons
               sentAmount, deployerJettonWallet.address,
               deployer.address, null, forwardAmount, null);

        const childJettonWallet = await userWallet(deployerJettonWallet.address, assetJettonMinter);

        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialChildJettonBalance = await childJettonWallet.getJettonBalance();

        expect(initialChildJettonBalance).toEqual(sentAmount);

        stackedTONsSnapshot = blockchain.snapshot();

        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(
                                    deployer.getSender(), childJettonWallet.address, toNano('0.4'));

        expect(withdrawResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: childJettonWallet.address,
            success: true
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.1'));
        // withdraw the rest
        await deployerJettonWallet.sendWithdrawJettons(deployer.getSender(), childJettonWallet.address, toNano('0.1'));
    });

    it('not owner can not withdraw jettons owned by JettonWallet', async () => {
        await blockchain.loadFrom(stackedTONsSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address, jettonMinter);
        const childJettonWallet = await userWallet(deployerJettonWallet.address, assetJettonMinter);

        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(
                                    consigliere.getSender(), childJettonWallet.address, toNano('0.4'));

        expect(withdrawResult.transactions).toHaveTransaction({
            from: consigliere.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 705 // error::unauthorized_transfer
        });

        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.5'));
    });
});
