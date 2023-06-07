import { CompilerConfig } from '@ton-community/blueprint';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { compile as compileFunc } from '@ton-community/blueprint';

export const compile: CompilerConfig = {
    preCompileHook: async () => {
        const consigliere_address = path.join(__dirname, '..', 'contracts', 'auto', 'consigliere_address.func');
        if (!fs.existsSync(consigliere_address)) {
          throw new Error('Consigliere address not defined in auto/consigliere_address.func, use setConsigliere');
        }
    },
    targets: ['contracts/auto/consigliere_address.func',
              'contracts/jetton-minter.func'],
};
