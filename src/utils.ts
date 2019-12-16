import BN = require("bn.js");
import { utils } from "ethers";
import { bigNumberify } from "ethers/utils";
import { Address } from './types';

export const IERC20_INTERFACE = new utils.Interface(
    require("../abi/IERC20.json").interface
);
export const SYNC_MAIN_CONTRACT_INTERFACE = new utils.Interface(
    require("../abi/SyncMain.json").interface
);
export const SYNC_PRIOR_QUEUE_INTERFACE = new utils.Interface(
    require("../abi/SyncPriorityQueue.json").interface
);

export const SYNC_GOV_CONTRACT_INTERFACE = new utils.Interface(
    require("../abi/SyncGov.json").interface
);

const AMOUNT_EXPONENT_BIT_WIDTH = 5;
const AMOUNT_MANTISSA_BIT_WIDTH = 35;
const FEE_EXPONENT_BIT_WIDTH = 5;
const FEE_MANTISSA_BIT_WIDTH = 11;

export function floatToInteger(
    floatBytes: Buffer,
    expBits: number,
    mantissaBits: number,
    expBaseNumber: number
): BN {
    if (floatBytes.length * 8 != mantissaBits + expBits) {
        throw new Error("Float unpacking, incorrect input length");
    }

    const floatHolder = new BN(floatBytes, 16, "be"); // keep bit order
    const expBase = new BN(expBaseNumber);
    let exponent = new BN(0);
    let expPow2 = new BN(1);
    const two = new BN(2);
    for (let i = 0; i < expBits; i++) {
        if (floatHolder.testn(i)) {
            exponent = exponent.add(expPow2);
        }
        expPow2 = expPow2.mul(two);
    }
    exponent = expBase.pow(exponent);
    let mantissa = new BN(0);
    let mantissaPow2 = new BN(1);
    for (let i = expBits; i < expBits + mantissaBits; i++) {
        if (floatHolder.testn(i)) {
            mantissa = mantissa.add(mantissaPow2);
        }
        mantissaPow2 = mantissaPow2.mul(two);
    }
    return exponent.mul(mantissa);
}

export function bitsIntoBytesInBEOrder(bits: boolean[]): Buffer {
    if (bits.length % 8 != 0) {
        throw new Error("wrong number of bits to pack");
    }
    const nBytes = bits.length / 8;
    const resultBytes = Buffer.alloc(nBytes, 0);

    for (let byte = 0; byte < nBytes; ++byte) {
        let value = 0;
        if (bits[byte * 8]) {
            value |= 0x80;
        }
        if (bits[byte * 8 + 1]) {
            value |= 0x40;
        }
        if (bits[byte * 8 + 2]) {
            value |= 0x20;
        }
        if (bits[byte * 8 + 3]) {
            value |= 0x10;
        }
        if (bits[byte * 8 + 4]) {
            value |= 0x08;
        }
        if (bits[byte * 8 + 5]) {
            value |= 0x04;
        }
        if (bits[byte * 8 + 6]) {
            value |= 0x02;
        }
        if (bits[byte * 8 + 7]) {
            value |= 0x01;
        }

        resultBytes[byte] = value;
    }

    return resultBytes;
}

export function integerToFloat(
    integer: BN,
    exp_bits: number,
    mantissa_bits: number,
    exp_base: number
): Buffer {
    const max_exponent = new BN(10).pow(new BN((1 << exp_bits) - 1));
    const max_mantissa = new BN(2).pow(new BN(mantissa_bits)).subn(1);

    if (integer.gt(max_mantissa.mul(max_exponent))) {
        throw new Error("Integer is too big");
    }

    let exponent = 0;
    let mantissa = integer;
    while (mantissa.gt(max_mantissa)) {
        mantissa = mantissa.divn(exp_base);
        exponent += 1;
    }

    // encode into bits. First bits of mantissa in LE order
    const encoding = [];

    for (let i = 0; i < exp_bits; ++i) {
        if ((exponent & (1 << i)) == 0) {
            encoding.push(false);
        } else {
            encoding.push(true);
        }
    }

    for (let i = 0; i < mantissa_bits; ++i) {
        if (mantissa.testn(i)) {
            encoding.push(true);
        } else {
            encoding.push(false);
        }
    }

    return Buffer.from(bitsIntoBytesInBEOrder(encoding.reverse()).reverse());
}

export function reverseBits(buffer: Buffer): Buffer {
    const reversed = Buffer.from(buffer.reverse());
    reversed.map(b => {
        // reverse bits in byte
        b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
        b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
        b = ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
        return b;
    });
    return reversed;
}

function packAmount(amount: BN): Buffer {
    return reverseBits(
        integerToFloat(
            amount,
            AMOUNT_EXPONENT_BIT_WIDTH,
            AMOUNT_MANTISSA_BIT_WIDTH,
            10
        )
    );
}

function packFee(amount: BN): Buffer {
    return reverseBits(
        integerToFloat(
            amount,
            FEE_EXPONENT_BIT_WIDTH,
            FEE_MANTISSA_BIT_WIDTH,
            10
        )
    );
}

export function packAmountChecked(amount: BN): Buffer {
    if (
        closestPackableTransactionAmount(amount.toString()).toString() !==
        amount.toString()
    ) {
        throw new Error("Transaction Amount is not packable");
    }
    return packAmount(amount);
}

export function packFeeChecked(amount: BN): Buffer {
    if (
        closestPackableTransactionFee(amount.toString()).toString() !==
        amount.toString()
    ) {
        throw new Error("Fee Amount is not packable");
    }
    return packFee(amount);
}

/**
 * packs and unpacks the amount, returning the closest packed value.
 * e.g 1000000003 => 1000000000
 * @param amount
 */
export function closestPackableTransactionAmount(
    amount: utils.BigNumberish
): utils.BigNumber {
    const amountBN = new BN(utils.bigNumberify(amount).toString());
    const packedAmount = packAmount(amountBN);
    return bigNumberify(
        floatToInteger(
            packedAmount,
            AMOUNT_EXPONENT_BIT_WIDTH,
            AMOUNT_MANTISSA_BIT_WIDTH,
            10
        ).toString()
    );
}

/**
 * packs and unpacks the amount, returning the closest packed value.
 * e.g 1000000003 => 1000000000
 * @param fee
 */
export function closestPackableTransactionFee(
    fee: utils.BigNumberish
): utils.BigNumber {
    const feeBN = new BN(utils.bigNumberify(fee).toString());
    const packedFee = packFee(feeBN);
    return bigNumberify(
        floatToInteger(
            packedFee,
            FEE_EXPONENT_BIT_WIDTH,
            FEE_MANTISSA_BIT_WIDTH,
            10
        ).toString()
    );
}

export function buffer2bitsLE(buff) {
    const res = new Array(buff.length * 8);
    for (let i = 0; i < buff.length; i++) {
        const b = buff[i];
        res[i * 8] = (b & 0x01) != 0;
        res[i * 8 + 1] = (b & 0x02) != 0;
        res[i * 8 + 2] = (b & 0x04) != 0;
        res[i * 8 + 3] = (b & 0x08) != 0;
        res[i * 8 + 4] = (b & 0x10) != 0;
        res[i * 8 + 5] = (b & 0x20) != 0;
        res[i * 8 + 6] = (b & 0x40) != 0;
        res[i * 8 + 7] = (b & 0x80) != 0;
    }
    return res;
}

export function buffer2bitsBE(buff) {
    const res = new Array(buff.length * 8);
    for (let i = 0; i < buff.length; i++) {
        const b = buff[i];
        res[i * 8] = (b & 0x80) != 0;
        res[i * 8 + 1] = (b & 0x40) != 0;
        res[i * 8 + 2] = (b & 0x20) != 0;
        res[i * 8 + 3] = (b & 0x10) != 0;
        res[i * 8 + 4] = (b & 0x08) != 0;
        res[i * 8 + 5] = (b & 0x04) != 0;
        res[i * 8 + 6] = (b & 0x02) != 0;
        res[i * 8 + 7] = (b & 0x01) != 0;
    }
    return res;
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function syncToLegacyAddress(address: Address) {
    if (address.startsWith('sync:') == false) {
        throw new Error(`Sync address must start with 'sync:'`);
    }

    return `0x${address.substr(5)}`;
}
