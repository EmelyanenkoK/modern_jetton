import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot, printTransactionFees } from '@ton-community/sandbox';
import { Cell, toNano, beginCell, Address, fromNano } from 'ton-core';
import { JettonWallet } from '../wrappers/JettonWallet';
import { JettonMinter } from '../wrappers/JettonMinter';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress, getRandomTon } from './utils';

// TODO: 
// 1. tests for share amount on burn
// 2. tests for response on burn

// jetton params
let fwd_fee = 1780014n, gas_consumption = 14000000n, min_tons_for_storage = 100000000n;

describe('JettonWallet', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let blockchain: Blockchain;
    let deployer:SandboxContract<TreasuryContract>;
    let consigliere:SandboxContract<TreasuryContract>;
    let notDeployer:SandboxContract<TreasuryContract>;
    let jettonMinter:SandboxContract<JettonMinter>;
    let userWallet: (a: Address) => Promise<SandboxContract<JettonWallet>>;
    let defaultContent:Cell;

    beforeAll(async () => {
        jwallet_code   = await compile('JettonWallet');
        minter_code    = await compile('JettonMinter');
        blockchain     = await Blockchain.create();
        deployer       = await blockchain.treasury('deployer');
        consigliere    = await blockchain.treasury('consigliere');
        notDeployer    = await blockchain.treasury('notDeployer');
        defaultContent = beginCell().endCell();

        jettonMinter = blockchain.openContract(JettonMinter.createFromConfig({
               admin: deployer.address,
               consigliere: consigliere.address,
               content: defaultContent,
               wallet_code: jwallet_code,
         }, minter_code));

        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await jettonMinter.getWalletAddress(address)
                          )
                     );

        // blockchain.setVerbosityForAddress(jettonMinter.address, { vmLogs: 'vm_logs' });
    });

    let noDistributionSnapshot: BlockchainSnapshot;
    let justStartedDistributionSnapshot: BlockchainSnapshot;

    it('should deploy', async () => {
        const distribution = { active: false, isJetton: false, volume: 0n };
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), distribution, toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true,
        });
    });
    it('minter admin should be able to mint jettons', async () => {
        // can mint from deployer
        let totalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);

        let toMint = toNano('1.23');
        const mintResult = await jettonMinter.sendMint(deployer.getSender(), deployer.address, toMint, toNano('0.05'), toNano('1'));
        totalSupply += toMint;

        expect(mintResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            deploy: true,
            success: true
        });
        expect(mintResult.transactions).toHaveTransaction({ // excesses
            from: deployerJettonWallet.address,
            to: deployer.address,
            success: true
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(toMint);
        expect(await jettonMinter.getTotalSupply()).toEqual(totalSupply);

        // can mint from deployer again
        toMint = toNano('2.31');
        await jettonMinter.sendMint(deployer.getSender(), deployer.address, toMint, toNano('0.05'), toNano('1'));
        totalSupply += toMint;

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(totalSupply);
        expect(await jettonMinter.getTotalSupply()).toEqual(totalSupply);

        // can mint to other addresses
        toMint = toNano('3.12');
        await jettonMinter.sendMint(deployer.getSender(), notDeployer.address, toMint, toNano('0.05'), toNano('1'));
        await jettonMinter.sendMint(deployer.getSender(), consigliere.address, toMint, toNano('0.05'), toNano('1'));
        totalSupply += toMint * 2n;

        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const consigliereJettonWallet = await userWallet(notDeployer.address);

        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(toMint);
        expect(await consigliereJettonWallet.getJettonBalance()).toEqual(toMint);
        expect(await jettonMinter.getTotalSupply()).toEqual(totalSupply);
    });

    it('not a minter admin should not be able to mint jettons', async () => {
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const unAuthMintResult = await jettonMinter.sendMint(notDeployer.getSender(), deployer.address, toNano('777'), toNano('0.05'), toNano('1'));

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 73, // error::unauthorized_mint_request
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);

        noDistributionSnapshot = blockchain.snapshot();
    });

    it('minter admin can change admin', async () => {
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        let changeAdmin = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(notDeployer.address)).toBe(true);
        changeAdmin = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), deployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
    });
    it('not a minter admin can not change admin', async () => {
        let changeAdmin = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), notDeployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 76, // error::unauthorized_change_admin_request
        });
    });

    it('minter admin can change content', async () => {
        let newContent = beginCell().storeUint(1,1).endCell();
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
        let changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), newContent);
        expect((await jettonMinter.getContent()).equals(newContent)).toBe(true);
        changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), defaultContent);
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
    });
    it('not a minter admin can not change content', async () => {
        let newContent = beginCell().storeUint(1,1).endCell();
        let changeContent = await jettonMinter.sendChangeContent(notDeployer.getSender(), newContent);
        expect((await jettonMinter.getContent()).equals(defaultContent)).toBe(true);
        expect(changeContent.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 77, // error::unauthorized_change_content_request
        });
    });

    it('wallet owner should be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);

        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');

        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.2'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);

        expect(sendResult.transactions).toHaveTransaction({ // excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });


    it('not wallet owner should not be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        const sendResult = await deployerJettonWallet.sendTransfer(notDeployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, toNano('0.05'), null);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 705, //error::unauthorized_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('impossible to send too much jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = initialJettonBalance + 1n;
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 706, //error::not_enough_jettons
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
    });

    it('malformed forward payload', async() => {

        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);

        let sentAmount     = toNano('0.5');
        let forwardAmount  = getRandomTon(0.01, 0.05); // toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        let msgPayload     = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                                        .storeCoins(sentAmount).storeAddress(notDeployer.address)
                                        .storeAddress(deployer.address)
                                        .storeMaybeRef(null)
                                        .storeCoins(toNano('0.05')) // No forward payload indication
                            .endCell();
        const res = await blockchain.sendMessage(internal({
                                                    from: deployer.address,
                                                    to: deployerJettonWallet.address,
                                                    body: msgPayload,
                                                    value: toNano('0.2')
                                                    }));


        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 708
        });
    });

    it('correctly sends forward_payload', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.2'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(1, 1)
                              .storeRef(forwardPayload)
                  .endCell()
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('no forward_ton_amount - no forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = 0n;
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.15'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });

        expect(sendResult.transactions).not.toHaveTransaction({ //no notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('check revert on not enough tons for forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let sentAmount = toNano('0.1');
        let forwardAmount = toNano('0.3');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), forwardAmount, // not enough tons, no tons for gas
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 709, // error::not_enough_tons
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    it('works with minimal ton amount', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const someAddress = randomAddress();
        const someJettonWallet = await userWallet(someAddress);
        let initialJettonBalance2 = await someJettonWallet.getJettonBalance();

        await deployer.send({
            value: toNano('1'), bounce: false,
            to: deployerJettonWallet.address
        });

        let forwardAmount = toNano('0.3');

        /*
                     forward_ton_amount +
                     fwd_count * fwd_fee +
                     2 * gas_consumption;
        */
        let minimalFee = 2n * fwd_fee + 2n * gas_consumption + min_tons_for_storage;
        let sentAmount = forwardAmount + minimalFee; // not enough, need >
        let forwardPayload = null;
        const jettonAmount = 1n;

        // blockchain.setVerbosityForAddress(deployerJettonWallet.address, { vmLogs: 'vm_logs' });
        let sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               jettonAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);

        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 709, // error::not_enough_tons
        });

        sentAmount += 1n; // now enough

        sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               jettonAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);

        expect(sendResult.transactions).not.toHaveTransaction({ // no excesses
            from: someJettonWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ // notification
            from: someJettonWallet.address,
            to: someAddress,
            value: forwardAmount,
            body: beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64) //default queryId
                              .storeCoins(jettonAmount)
                              .storeAddress(deployer.address)
                              .storeUint(0, 1)
                  .endCell()
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - jettonAmount);
        expect(await someJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + jettonAmount);

        expect((await blockchain.getContract(someJettonWallet.address)).balance).toBeGreaterThan(min_tons_for_storage - 5000000n);
    });

    it('wallet does not accept internal_transfer not from wallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
/*
  internal_transfer  query_id:uint64 amount:(VarUInteger 16) from:MsgAddress
                     response_address:MsgAddress
                     forward_ton_amount:(VarUInteger 16)
                     forward_payload:(Either Cell ^Cell)
                     = InternalMsgBody;
*/
        let internalTransfer = beginCell().storeUint(0x178d4519, 32).storeUint(0, 64) //default queryId
                              .storeCoins(toNano('0.01'))
                              .storeAddress(deployer.address)
                              .storeAddress(deployer.address)
                              .storeCoins(toNano('0.05'))
                              .storeUint(0, 1)
                  .endCell();
        const sendResult = await blockchain.sendMessage(internal({
                    from: notDeployer.address,
                    to: deployerJettonWallet.address,
                    body: internalTransfer,
                    value:toNano('0.3')
                }));
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 707, // error::unauthorized_incoming_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    it('wallet owner should not be able to burn while no distribution', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                             initialJettonBalance, deployer.address, null); // amount, response address, custom payload

        expect(sendResult.transactions).toHaveTransaction({ // burn notification
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 66
        });

        expect(sendResult.transactions).toHaveTransaction({ // bounced
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            success: true,
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('should not start distribution from not admin', async () => {
        const sendStartResult = await jettonMinter.sendStartDistribution(notDeployer.getSender(), toNano(1000));
        expect(sendStartResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            success: false,
            exitCode: 80  // error::unauthorized_start_request
        });
    });

    it('should start distribution', async () => {
        const sendStartResult = await jettonMinter.sendStartDistribution(deployer.getSender(), toNano(1000));
        expect(sendStartResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true
        });

        justStartedDistributionSnapshot = blockchain.snapshot();
    });

    it('should burn jettons and get his share', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);

        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        let distributionData = await jettonMinter.getDistribution();
        let expectedShareAmount = initialJettonBalance * distributionData.volume / initialTotalSupply;

        const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                initialJettonBalance, notDeployer.address, null); // amount, response address, custom payload
        
        expect(sendResult.transactions).toHaveTransaction({ // burn notification
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            success: true
        });
        expect(sendResult.transactions).toHaveTransaction({ 
            from: jettonMinter.address,
            to: deployer.address,
            op: 0xdb3b8abd, // op::distributed_asset
            value: (x) => x! >= expectedShareAmount - fwd_fee,
        });
        expect(sendResult.transactions).toHaveTransaction({ // excesses
            from: jettonMinter.address,
            to: notDeployer.address,
            op: 0xd53276db,
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(0n);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - initialJettonBalance);
    });

    it('not wallet owner should not be able to burn jettons', async () => {
        await blockchain.loadFrom(justStartedDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const sendResult = await deployerJettonWallet.sendBurn(notDeployer.getSender(), toNano('0.1'), // ton amount
                              initialJettonBalance, deployer.address, null); // amount, response address, custom payload
        expect(sendResult.transactions).toHaveTransaction({
           from: notDeployer.address,
           to: deployerJettonWallet.address,
           aborted: true,
           exitCode: 711, // error::unauthorized_burn_request
          });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('wallet owner can not burn more or less jettons than it has', async () => {
        await blockchain.loadFrom(justStartedDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        let burnAmount1 = initialJettonBalance + 1n;
        let burnAmount2 = initialJettonBalance - 1n;
        const sendResult1 = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                burnAmount1, deployer.address, null); // amount, response address, custom payload
        const sendResult2 = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'),
                                burnAmount2, deployer.address, null);
        for (let sendResult of [sendResult1, sendResult2])
         expect(sendResult.transactions).toHaveTransaction({
             from: deployer.address,
             to: deployerJettonWallet.address,
             aborted: true,
             exitCode: 704, // error::burning_not_all_balance
            });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('consigliere should help user burn tokens', async () => {
        await blockchain.loadFrom(justStartedDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address);
        const initialDeployerWalletBalance = await deployerJettonWallet.getJettonBalance();
        const initialConsgiliereTONBalance = (await blockchain.getContract(consigliere.address)).balance

        const spentTON = toNano('0.1');

        // blockchain.setVerbosityForAddress(jettonMinter.address, { vmLogs: 'vm_logs' });

        const burnResult = await deployerJettonWallet.sendBurn(consigliere.getSender(), spentTON, // ton amount
                             initialDeployerWalletBalance, deployer.address, null); // amount, response address, custom payload

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
        expect(burnResult.transactions).toHaveTransaction({ // share
            from: jettonMinter.address,
            to: deployer.address,
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
            op: 0xd53276db,
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(0n);
        const nowConsigliereTONBalance = (await blockchain.getContract(consigliere.address)).balance
        expect(nowConsigliereTONBalance).toBeGreaterThanOrEqual(initialConsgiliereTONBalance);
    });

    it('minter should only accept burn messages from jetton wallets', async () => {
        await blockchain.loadFrom(justStartedDistributionSnapshot);

        const deployerJettonWallet = await userWallet(deployer.address);
        const burnAmount = await deployerJettonWallet.getJettonBalance();
        const burnNotification = (amount: bigint, addr: Address) => {
        return beginCell()
                .storeUint(0x7bdd97de, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
                .storeCoins(0)
               .endCell();
        }

        let res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, randomAddress(0)),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 74 // Unauthorized burn
        });

        res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, deployer.address),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            success: true
        });
   });

    // TEP-89
    it('report correct discovery address', async () => {
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), deployer.address, true);
        /*
          take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
        */
        const deployerJettonWallet = await userWallet(deployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(deployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(deployer.address).endCell())
                  .endCell()
        });

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, true);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                  .endCell()
        });

        // do not include owner address
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(0, 1)
                  .endCell()
        });

    });

    it('Minimal discovery fee', async () => {
       // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        const fwdFee     = 1464012n;
        const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                                      notDeployer.address,
                                                                      false,
                                                                      minimalFee);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: 75 // discovery_fee_not_matched
        });

        /*
         * Might be helpfull to have logical OR in expect lookup
         * Because here is what is stated in standard:
         * and either throw an exception if amount of incoming value is not enough to calculate wallet address
         * or response with message (sent with mode 64)
         * https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
         * At least something like
         * expect(discoveryResult.hasTransaction({such and such}) ||
         * discoveryResult.hasTransaction({yada yada})).toBeTruethy()
         */
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           notDeployer.address,
                                                           false,
                                                           minimalFee + 1n);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true
        });

    });

    it('Correctly handles not valid address in discovery', async () =>{
        const badAddr       = randomAddress(-1);
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                               badAddr,
                                                               false);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(0, 1)
                  .endCell()

        });

        // Include address should still be available

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           badAddr,
                                                           true); // Include addr

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(0xd1735400, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(1, 1)
                             .storeRef(beginCell().storeAddress(badAddr).endCell())
                  .endCell()

        });
    });

    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    /*it('jettonWallet can process 250 transfer', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = 1n, count = 250n;
        let forwardAmount = toNano('0.05');
        let sendResult: any;
        let payload = beginCell()
                          .storeUint(0x12345678, 32).storeUint(0x87654321, 32)
                          .storeRef(beginCell().storeUint(0x12345678, 32).storeUint(0x87654321, 108).endCell())
                          .storeRef(beginCell().storeUint(0x12345671, 32).storeUint(0x87654321, 240).endCell())
                          .storeRef(beginCell().storeUint(0x12345672, 32).storeUint(0x87654321, 77)
                                               .storeRef(beginCell().endCell())
                                               .storeRef(beginCell().storeUint(0x1245671, 91).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x2245671, 180).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x8245671, 255).storeUint(0x87654321, 32).endCell())
                                    .endCell())
                      .endCell();
        let initialBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let initialBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        for(let i = 0; i < count; i++) {
            sendResult = await deployerJettonWallet.sendTransferMessage(deployer.getSender(), toNano('0.1'), //tons
                   sentAmount, notDeployer.address,
                   deployer.address, null, forwardAmount, payload);
        }
        // last chain was successful
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount*count);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount*count);

        let finalBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let finalBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;

        // if it is not true, it's ok but gas_consumption constant is too high
        // and excesses of TONs will be accrued on wallet
        expect(finalBalance).toBeLessThan(initialBalance + toNano('0.001'));
        expect(finalBalance2).toBeLessThan(initialBalance2 + toNano('0.001'));
        expect(finalBalance).toBeGreaterThan(initialBalance - toNano('0.001'));
        expect(finalBalance2).toBeGreaterThan(initialBalance2 - toNano('0.001'));

    });
    */
    it('can not send to masterchain', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: 333 //error::wrong_workchain
        });
    });

    it('owner can withdraw excesses', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(deployer.getSender());
        expect(withdrawResult.transactions).toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toEqual(min_tons_for_storage);
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano('0.99'));
    });
    it('not owner can not withdraw excesses', async () => {
        notDeployer = await blockchain.treasury('notDeployer');
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(notDeployer.getSender());
        expect(withdrawResult.transactions).not.toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toBeGreaterThan(toNano('1'));
        expect(finalBalance - initialBalance).toBeLessThan(toNano('0.1'));
    });
});
