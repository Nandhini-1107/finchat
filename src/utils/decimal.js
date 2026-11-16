/**
 * Pure JavaScript arbitrary-precision decimal arithmetic module.
 * Eliminates IEEE 754 floating-point drift (e.g. 0.1 + 0.2 === 0.30000000000000004).
 * Implements strict half-up rounding and zero-dependency financial math.
 */

const SCALE = 8n;
const MULTIPLIER = 10n ** SCALE; // 10^8

function expandExponential(str) {
    if (!/[eE]/.test(str)) return str;
    const [coeff, expStr] = str.split(/[eE]/);
    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) return str;
    const isNeg = coeff.startsWith('-');
    const cleanCoeff = isNeg ? coeff.slice(1) : coeff;
    const [intPart, fracPart = ''] = cleanCoeff.split('.');
    let result = '';
    if (exp > 0) {
        if (exp >= fracPart.length) {
            result = intPart + fracPart + '0'.repeat(exp - fracPart.length);
        } else {
            result = intPart + fracPart.slice(0, exp) + '.' + fracPart.slice(exp);
        }
    } else {
        const absExp = Math.abs(exp);
        result = '0.' + '0'.repeat(absExp - 1) + intPart + fracPart;
    }
    return isNeg ? '-' + result : result;
}

class Decimal {
    constructor(val) {
        if (val instanceof Decimal) {
            this.scaled = val.scaled;
            return;
        }

        if (val === null || val === undefined || val === '') {
            this.scaled = 0n;
            return;
        }

        let str = String(val).trim().replace(/,/g, '');
        str = expandExponential(str);
        if (!/^-?\d+(\.\d+)?$/.test(str)) {
            throw new Error(`Invalid decimal value: "${val}"`);
        }

        const isNeg = str.startsWith('-');
        const unsigned = isNeg ? str.slice(1) : str;
        const [intPart, fracPart = ''] = unsigned.split('.');

        const paddedFrac = fracPart.padEnd(Number(SCALE), '0').slice(0, Number(SCALE));
        let bi = BigInt(intPart) * MULTIPLIER + BigInt(paddedFrac);
        if (isNeg) bi = -bi;
        this.scaled = bi;
    }

    plus(other) {
        const o = new Decimal(other);
        const res = new Decimal(0);
        res.scaled = this.scaled + o.scaled;
        return res;
    }

    minus(other) {
        const o = new Decimal(other);
        const res = new Decimal(0);
        res.scaled = this.scaled - o.scaled;
        return res;
    }

    times(other) {
        const o = new Decimal(other);
        const res = new Decimal(0);
        res.scaled = (this.scaled * o.scaled) / MULTIPLIER;
        return res;
    }

    dividedBy(other) {
        const o = new Decimal(other);
        if (o.scaled === 0n) {
            throw new Error('Division by zero');
        }
        const res = new Decimal(0);
        res.scaled = (this.scaled * MULTIPLIER) / o.scaled;
        return res;
    }

    abs() {
        const res = new Decimal(0);
        res.scaled = this.scaled < 0n ? -this.scaled : this.scaled;
        return res;
    }

    isZero() {
        return this.scaled === 0n;
    }

    isNegative() {
        return this.scaled < 0n;
    }

    /**
     * Rounds half-up to specified decimal places.
     */
    toFixed(dp = 2) {
        const isNeg = this.scaled < 0n;
        let absScaled = isNeg ? -this.scaled : this.scaled;

        const shift = Number(SCALE) - dp;
        if (shift > 0) {
            const factor = 10n ** BigInt(shift);
            const remainder = absScaled % factor;
            const half = factor / 2n;

            absScaled = absScaled / factor;
            if (remainder >= half) {
                absScaled += 1n;
            }
        } else if (shift < 0) {
            absScaled = absScaled * (10n ** BigInt(-shift));
        }

        const div = 10n ** BigInt(dp);
        const intP = absScaled / div;
        const fracP = absScaled % div;
        const fracStr = dp > 0 ? '.' + fracP.toString().padStart(dp, '0') : '';
        const sign = (isNeg && absScaled > 0n) ? '-' : '';
        return sign + intP.toString() + fracStr;
    }

    toNumber(dp = 4) {
        return parseFloat(this.toFixed(dp));
    }
}

module.exports = {
    Decimal
};

