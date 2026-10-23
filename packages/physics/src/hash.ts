// 64-bit FNV-1a (Fowler, Noll, Vo) over the little-endian bytes of float64 values, carried in four
// 16-bit limbs so every intermediate stays an exact integer in a double.

export class Fnv64 {
  private h0 = 0x2325;
  private h1 = 0x8422;
  private h2 = 0x9ce4;
  private h3 = 0xcbf2;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    const h0 = this.h0 ^ b;
    // multiply by the FNV prime 2⁴⁰ + 0x1b3, mod 2⁶⁴
    const t0 = h0 * 0x1b3;
    const t1 = this.h1 * 0x1b3 + (t0 >>> 16);
    const t2 = this.h2 * 0x1b3 + (t1 >>> 16) + h0 * 0x100;
    const t3 = this.h3 * 0x1b3 + (t2 >>> 16) + this.h1 * 0x100;
    this.h0 = t0 & 0xffff;
    this.h1 = t1 & 0xffff;
    this.h2 = t2 & 0xffff;
    this.h3 = t3 & 0xffff;
  }

  float(x: number): void {
    this.view.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
  }

  floats(xs: ArrayLike<number>): void {
    for (let i = 0; i < xs.length; i++) this.float(xs[i]!);
  }

  hex(): string {
    return [this.h3, this.h2, this.h1, this.h0].map((h) => h.toString(16).padStart(4, '0')).join('');
  }
}
