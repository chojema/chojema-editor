/** Text encodings a document can arrive in; everything is written back as UTF-8. */
export type TextEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'EUC-KR'

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

/**
 * Decode file bytes: a UTF-16 byte-order mark wins, then strict UTF-8 (a
 * UTF-8 BOM stays in the text so the envelopes can write it back), and bytes
 * that are not valid UTF-8 are read as legacy Korean (EUC-KR / CP949).
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'EUC-KR' }
  }
}

export function lineEnding(text: string): 'CRLF' | 'LF' {
  return text.includes('\r\n') ? 'CRLF' : 'LF'
}
