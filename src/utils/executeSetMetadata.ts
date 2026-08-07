import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { GasPrice } from '@cosmjs/stargate'
import {
  RPC_ENDPOINT,
  TOKEN_METADATA_CONTRACT_ADDRESS,
  buildSetMetadataMsg,
  type SetMetadataInput,
} from '@/config/tokenMetadataContract'

function isUserRejection(err: any): boolean {
  const msg = (err?.message ? err.message : String(err)).toLowerCase()
  return msg.includes('reject') || msg.includes('declin') || msg.includes('cancel')
}

/**
 * Signs and broadcasts a SetMetadata execute tx via the connected wallet's
 * offline signer -- the wallet extension handles signing, this code never
 * sees a private key. Throws a plain Error with a message suitable for
 * direct display; rejection is distinguished from other failures.
 */
export async function executeSetMetadata(
  offlineSigner: any,
  senderAddress: string,
  input: SetMetadataInput
): Promise<{ transactionHash: string }> {
  try {
    const client = await SigningCosmWasmClient.connectWithSigner(RPC_ENDPOINT, offlineSigner, {
      // `as any`: a transitive dependency (@leapwallet/name-matcha) pulls in its
      // own nested copy of @cosmjs/stargate, so TS sees two nominally distinct
      // GasPrice classes even though they're the same package at runtime.
      gasPrice: GasPrice.fromString('0minf') as any,
    })
    const msg = buildSetMetadataMsg(input)
    const result = await client.execute(
      senderAddress,
      TOKEN_METADATA_CONTRACT_ADDRESS,
      msg,
      'auto',
      'Update token metadata via Infinite Ledgers Explorer'
    )
    return { transactionHash: result.transactionHash }
  } catch (err: any) {
    if (isUserRejection(err)) throw new Error('Transaction rejected in wallet.')
    throw new Error(err?.message || 'Transaction failed.')
  }
}
