import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot, printTransactionFees } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, fromNano } from 'ton-core';
import { JettonWallet } from '../wrappers/JettonWallet';
import { JettonMinter } from '../wrappers/JettonMinter';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress, getRandomTon } from './utils';


describe('DistributingJettons', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
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
               content: beginCell().endCell(),
               wallet_code: jwallet_code,
         }, minter_code));

         // here we are using same code because jetton logic we need is the same
         assetJettonMinter = blockchain.openContract(JettonMinter.createFromConfig({
             admin: deployer.address,
             consigliere: consigliere.address,
             content: beginCell().storeUint(0, 1).endCell(),
             wallet_code: jwallet_code,
         }, minter_code));

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
        const deployResult = await assetJettonMinter.sendDeploy(deployer.getSender(), distribution, toNano('0.5'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: assetJettonMinter.address,
            deploy: true,
            success: true,
        });

        let toMint = toNano('2000')
        const mintResult = await assetJettonMinter.sendMint(deployer.getSender(), deployer.address, toMint, toNano('0.05'), toNano('1'));

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
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), distribution, toNano('0.5'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true
        });

        const mintResult1 = await jettonMinter.sendMint(deployer.getSender(), deployer.address, toNano('400'), toNano('0.05'), toNano('1'));
        const mintResult2 = await jettonMinter.sendMint(deployer.getSender(), consigliere.address, toNano('600'), toNano('0.05'), toNano('1'));

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

    it('should start distribution', async () => {
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
    });

//     it('should start distribution with asset mint', async () => {
//         await blockchain.loadFrom(noDistributionSnapshot);
//         deployer = await blockchain.treasury('deployer');

//         const toMint = toNano('2000');
//         const mintResult = await assetJettonMinter.sendMint(deployer.getSender(), jettonMinter.address, toMint, toNano('0.05'), toNano('1'));

//         expect(mintResult.transactions).toHaveTransaction({
//             from: deployer.address,
//             to: assetJettonMinter.address,
//             success: true
//         });

//         const distribution = await jettonMinter.getDistribution();

//         expect(distribution.active).toEqual(true);
//         expect(distribution.volume).toEqual(toMint);
//     });

    it('should send assets for burned jettons', async () => {
        consigliere = await blockchain.treasury('consigliere');

        const deployerJettonWallet = await userWallet(deployer.address, jettonMinter);
        const deployerAssetWallet = await userWallet(deployer.address, assetJettonMinter);
        const initialDeployerWalletBalance = await deployerJettonWallet.getJettonBalance();

        const consigliereJettonWallet = await userWallet(consigliere.address, jettonMinter);
        const consigliereAssetWallet = await userWallet(consigliere.address, assetJettonMinter);
        const initialConsigliereWalletBalance = await consigliereJettonWallet.getJettonBalance();

        console.log(initialDeployerWalletBalance);
        blockchain.setVerbosityForAddress(deployerJettonWallet.address, { vmLogs: 'vm_logs' });

        const burnResult1 = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                             initialDeployerWalletBalance, deployer.address, Cell.EMPTY); // amount, response address, custom payload

        const burnResult2 = await consigliereJettonWallet.sendBurn(consigliere.getSender(), toNano('0.1'),
                                initialConsigliereWalletBalance, consigliere.address, Cell.EMPTY);

        const distributorAssetWallet = await userWallet(jettonMinter.address, assetJettonMinter);

        expect(burnResult1.transactions).toHaveTransaction({ // send asset request
            from: jettonMinter.address,
            to: distributorAssetWallet.address,
            success: true
        });

        // they should get twice more than they burned because supply ratio is 2:1
        expect(await deployerAssetWallet.getJettonBalance()).toEqual(initialDeployerWalletBalance * 2n);
        expect(await consigliereAssetWallet.getJettonBalance()).toEqual(initialConsigliereWalletBalance * 2n);

        const distribution = await jettonMinter.getDistribution();
        expect(distribution.volume).toEqual(0n);
    });
});
