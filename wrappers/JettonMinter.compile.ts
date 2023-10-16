import { CompilerConfig } from '@ton/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { compile as compileFunc } from '@ton/blueprint';

export const compile: CompilerConfig = {
    preCompileHook: async () => {
        const consigliere_address = path.join(__dirname, '..', 'contracts', 'auto', 'consigliere_address.func');
        if (!fs.existsSync(consigliere_address)) {
          throw new Error('Consigliere address not defined in auto/consigliere_address.func, use setConsigliere');
        }
        await compileFunc('JettonWallet');
    },
    targets: ['contracts/auto/consigliere_address.func',
              'contracts/auto/jetton-wallet-code.func',
              'contracts/jetton-minter.func'],
};
