/**
 * A real, tiny WebM file (EBML container, not ISO-BMFF at all) -- `ffmpeg -f lavfi -i
 * testsrc=size=32x32:duration=0.2:rate=10 -c:v libvpx -f webm tiny.webm`, base64-embedded rather
 * than committed as a binary, per this repo's fixture convention (checked-in `.ts` modules, not
 * binaries -- see `src/heuristics/__fixtures__/`).
 *
 * Exists because WebM is the single most likely real-world non-MP4 input this parser will ever
 * see in production (a webcam recording, depending on browser/codec choice) -- and this spike's
 * review round found the parser's OWN doc comment was WRONG about what happens to it. mp4box's
 * box reader interprets the EBML header's leading bytes as a plausible-looking (but nonsensical)
 * box, throws "Invalid data found while parsing box of type '...'" from inside `onError`, which
 * lands on `parseStatus: 'parse-error'` -- NOT `'unsupported-container'`, despite WebM being, in
 * every meaningful sense, an "unsupported container." See `containerTiming.ts`'s module doc for
 * the corrected mapping and `containerTiming.test.ts` for the regression this fixture backs.
 */
export function buildWebmBytes(): ArrayBuffer {
  const base64 =
    'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAATzEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggTd7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAwV0GNTGF2ZjYyLjEyLjEwMESJiEBpAAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgqHYQyz1fED5yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAX14QDgkLCBILqBIJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAwc3PWY8CLY8WIKh2EMs9XxA9nyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z1QzHngQCjQvyBAACA8BQAnQEqIAAgAAAHCIWFiIWEiAICAnW6JOn+OfgD+sHMM7ndgf0vygnin+A/gxugP8S/AHgA/wH+Mf2z/Ae//0gP6RegD1gP6A+kB+1fwA/qB/gPcP/i38eu7D49+GfOcenf6zZa95j+PX5QaQH8PPyAzAP88/Cf8Zso54KDzufzD8nv7B6DX9y9wT+Qfxb+xfkp+9v0A9RX+jXtaibODfQ3zIajbYzTO486fBzgSsSA/v//FvklTmE1p5WoGrmuBpTusgVwrUo2Zbwd//5zD9aedgQ2JZQwovar8I6J5s4G7n+XJ/Bs/h1PPZOG4vwGPUF+GUHzOSIkiNiYuObq7rp/8u64mGn56dmasvxFZn99GtdYGKS3oCewDGcFVP39If/oUV6obn9mguUGAoJfjMXBs7pGaFfJuw35gw92xFyrSG3Wu4frf3m8//2mHmhSWxMk0ZByUdB3kHfaQKrTVYaFT6Lp7bfprJ+hpnpgKTx5JlQoBmJN9xZRRtmn1HeQf4TK2/yu/jyz4eDxgajoVtndEZg/pHNEUTdc2y6lceuv77YYBnrk9OMkQVU8fwmU/d9m6eYP419pFNZnZWVJbV55LmVSn37zReqcgmzQSEyKFNH0A1I9SslTmDoD+//0WeZK4d6z6K05v4+arPvek//7ZMg8Hav6Mua7vxncSndagds/IkM14rlDgVVWv15nt//x9oYFmX7/2bniJ5dSanjh4A1/3bqVrv2kt+oyOambDStioAkL2D/5FlvtmfeR8v8v41/bQlhjhasYcp8Q3gQJ6nK79N4tYs5Sh/+TDwkHypOnhdOBO0qsAcP9Rp+YwHDjvLT+UWuhMYe7fuV/xI0OD6C3FyTVBO1Y5IAzCaLf/nnR6bkXijApaZN//9SYZ/4lIpC3ZEg38ArdFomnwfEdTsFBTvcNRw6Gz/UUj9UPmWb/XaC4vZE/hWdpwscYAFqDEUSyKgVeue+gclrxZr+Zhv6ur/IoIyIc/E5pkKJQhbFNM+pwAKOtgQBkAPEBAAkQrAAYACRAL/QBbEBRwCRQhI9EAAABYBJo3uuuPwAAEEAEgaAAHFO7a5G7j7OBALeK94EB8YIBpvCBAw=='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
